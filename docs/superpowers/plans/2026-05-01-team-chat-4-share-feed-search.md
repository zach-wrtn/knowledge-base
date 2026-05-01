# Team Chat — Plan 4: Share + Feed + Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the "share to team" mechanic, the team feed, and embedding-based search. After this plan, a user can click "Share" on a conversation, the system snapshots it with an AI summary + Vertex AI embedding to `shared-conversations`, and the snapshot becomes discoverable via `/feed` and semantic search at `/search`. Wires `list_related_shared_conversations` from Plan 3 to the real Vertex search.

**Architecture:** `shareConversation` HTTPS callable: takes conversation, runs a one-shot AI summarization (uses `getProvider()`), embeds via Vertex AI `text-embedding-005`, writes to `shared-conversations`, marks conversation `shared=true`. `searchShared` callable: embeds the query, Firestore `findNearest` (COSINE) over `shared-conversations.embedding`, returns hits. UI: share modal with editable title/summary preview; `/feed` lists by recency; `/feed/[sid]` shows snapshot read-only; `/search` runs semantic search.

**Tech Stack:** + `@google-cloud/aiplatform` for Vertex AI embeddings. Firebase Admin SDK `findNearest` (firestore v7.10+).

**Spec:** `docs/superpowers/specs/2026-05-01-team-chat-design.md` §3 (share flow), §6 (share details), §7 (feed/search).

**Prerequisites:** Plans 1, 2, 3 merged. Anthropic provider works locally (or Mock provider — share flow's AI call uses whatever provider is active).

---

## File Structure

**Create:**
- `functions/src/lib/embeddings.ts` — Vertex AI client + `embed()`
- `functions/src/lib/embedding-source.ts` — text composer for embedding input
- `functions/src/share/shareConversation.ts` — HTTPS callable
- `functions/src/search/searchShared.ts` — HTTPS callable
- `functions/src/lib/__tests__/embedding-source.test.ts`
- `src/lib/firebase/share-callables.ts` — typed wrappers
- `src/components/chat/share-button.tsx`
- `src/components/feed/feed-card.tsx`
- `src/app/feed/[sid]/page.tsx`

**Modify:**
- `src/app/c/[cid]/page.tsx` — add Share button + modal
- `src/app/feed/page.tsx` — replace placeholder with real list
- `src/app/search/page.tsx` — replace placeholder with embedding search
- `src/app/page.tsx` — show "5 most recent team-shared" preview
- `firestore.rules` — add `/shared-conversations/*` read=isWrtn, write=false
- `firestore.indexes.json` — add vector index on `shared-conversations.embedding`
- `functions/src/lib/tools.ts` — wire `list_related_shared_conversations` to real Vertex search
- `functions/src/lib/secrets.ts` — add `VERTEX_LOCATION`
- `functions/src/index.ts` — export `shareConversation`, `searchShared`

---

### Task 1: Vertex AI embedding helper

**Files:**
- Modify: `functions/package.json` (add `@google-cloud/aiplatform`)
- Create: `functions/src/lib/embeddings.ts`
- Create: `functions/src/lib/embedding-source.ts`
- Create: `functions/src/lib/__tests__/embedding-source.test.ts`
- Modify: `functions/src/lib/secrets.ts`

- [ ] **Step 1: Branch + install dep**

```bash
cd ~/dev/work/zzem-wiki
git checkout main && git pull
git checkout -b plan/team-chat-4-share-feed-search
cd functions
npm install @google-cloud/aiplatform
cd ..
```

- [ ] **Step 2: Add VERTEX_LOCATION secret**

In `functions/src/lib/secrets.ts`, append:

```ts
export const VERTEX_LOCATION = defineSecret("VERTEX_LOCATION");
```

- [ ] **Step 3: Write embeddings helper**

`functions/src/lib/embeddings.ts`:

```ts
import { PredictionServiceClient, helpers } from "@google-cloud/aiplatform";
import { VERTEX_LOCATION } from "./secrets";

export const EMBEDDING_DIM = 768;
const MODEL = "text-embedding-005";

let _client: PredictionServiceClient | null = null;
function client(): PredictionServiceClient {
  if (!_client) {
    const location = VERTEX_LOCATION.value();
    _client = new PredictionServiceClient({ apiEndpoint: `${location}-aiplatform.googleapis.com` });
  }
  return _client;
}

export async function embed(text: string): Promise<number[]> {
  if (!text.trim()) throw new Error("embed: empty text");
  const project = process.env.GCLOUD_PROJECT ?? process.env.GCP_PROJECT;
  if (!project) throw new Error("embed: GCLOUD_PROJECT not set");
  const location = VERTEX_LOCATION.value();
  const endpoint = `projects/${project}/locations/${location}/publishers/google/models/${MODEL}`;

  const instances = [helpers.toValue({ content: text }) as never];
  const [response] = await client().predict({ endpoint, instances });
  const root = response.predictions?.[0] as
    | { structValue?: { fields?: { embeddings?: { structValue?: { fields?: { values?: { listValue?: { values?: { numberValue?: number }[] } } } } } } } }
    | undefined;
  const values = root?.structValue?.fields?.embeddings?.structValue?.fields?.values?.listValue?.values
    ?.map((v) => v.numberValue ?? 0);

  if (!values || values.length !== EMBEDDING_DIM) {
    throw new Error(`embed: unexpected response shape (got ${values?.length} dims)`);
  }
  return values;
}
```

- [ ] **Step 4: Embedding source composer**

`functions/src/lib/embedding-source.ts`:

```ts
const MAX_CHARS = 8000;

export function composeForEmbedding(input: {
  title: string;
  summary: string;
  body: string;
  tags?: string[];
}): string {
  const parts: string[] = [];
  parts.push(`Title: ${input.title.trim()}`);
  parts.push(`Summary: ${input.summary.trim()}`);
  if (input.tags && input.tags.length > 0) {
    parts.push(`Tags: ${input.tags.map((t) => t.trim()).filter(Boolean).join(", ")}`);
  }
  parts.push(`Body: ${input.body.trim()}`);
  const joined = parts.join("\n\n");
  if (joined.length <= MAX_CHARS) return joined;
  // Truncate body first
  const head = parts.slice(0, -1).join("\n\n");
  const remaining = MAX_CHARS - head.length - "\n\nBody: ".length - 4;
  if (remaining < 100) return joined.slice(0, MAX_CHARS);
  return head + "\n\nBody: " + input.body.trim().slice(0, remaining) + " ...";
}
```

- [ ] **Step 5: Composer tests**

`functions/src/lib/__tests__/embedding-source.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { composeForEmbedding } from "../embedding-source";

describe("composeForEmbedding", () => {
  it("orders sections title, summary, tags, body", () => {
    const out = composeForEmbedding({
      title: "T",
      summary: "S",
      body: "B",
      tags: ["a", "b"],
    });
    expect(out.indexOf("Title:")).toBeLessThan(out.indexOf("Summary:"));
    expect(out.indexOf("Summary:")).toBeLessThan(out.indexOf("Tags:"));
    expect(out.indexOf("Tags:")).toBeLessThan(out.indexOf("Body:"));
  });

  it("omits Tags when empty", () => {
    const out = composeForEmbedding({ title: "T", summary: "S", body: "B", tags: [] });
    expect(out).not.toContain("Tags:");
  });

  it("truncates body when oversized, keeps title/summary intact", () => {
    const out = composeForEmbedding({ title: "T", summary: "S", body: "x".repeat(10000) });
    expect(out.length).toBeLessThanOrEqual(8000);
    expect(out).toContain("Title: T");
    expect(out).toContain("Summary: S");
    expect(out).toMatch(/Body: x+ \.\.\.$/);
  });
});
```

- [ ] **Step 6: Build + test**

```bash
cd functions && npm run build && npm test 2>&1 | tail -8 && cd ..
```

Expected: 3 new tests pass; total grows by 3.

- [ ] **Step 7: Commit**

```bash
git add functions/package.json functions/package-lock.json functions/src/lib/embeddings.ts functions/src/lib/embedding-source.ts functions/src/lib/__tests__/embedding-source.test.ts functions/src/lib/secrets.ts
git commit -m "functions: Vertex AI text-embedding-005 + embedding source composer"
```

---

### Task 2: shareConversation HTTPS callable

**Files:**
- Create: `functions/src/share/shareConversation.ts`
- Modify: `functions/src/index.ts`

- [ ] **Step 1: Write shareConversation**

`functions/src/share/shareConversation.ts`:

```ts
import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import { getProvider } from "../lib/ai";
import { embed } from "../lib/embeddings";
import { composeForEmbedding } from "../lib/embedding-source";
import { tokenize } from "./tokenize";
import {
  ANTHROPIC_API_KEY, VERTEX_LOCATION,
  WRTN_AI_API_KEY, WRTN_AI_ENDPOINT,
} from "../lib/secrets";

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

export const shareConversation = onCall(
  {
    region: "asia-northeast3",
    timeoutSeconds: 60,
    memory: "512MiB",
    secrets: [ANTHROPIC_API_KEY, VERTEX_LOCATION, WRTN_AI_API_KEY, WRTN_AI_ENDPOINT],
  },
  async (req) => {
    const email = req.auth?.token.email;
    if (!email?.endsWith("@wrtn.io")) throw new HttpsError("permission-denied", "@wrtn.io only");
    const uid = req.auth!.uid;

    const data = req.data as { cid?: string; title?: string; summary?: string; tags?: string[]; scope?: string };
    if (!data?.cid) throw new HttpsError("invalid-argument", "cid required");

    const cref = db.doc(`conversations/${data.cid}`);
    const csnap = await cref.get();
    if (!csnap.exists) throw new HttpsError("not-found", "conversation not found");
    const conv = csnap.data()!;
    if (conv.ownerUid !== uid) throw new HttpsError("permission-denied", "not owner");

    // Read all messages (no limit — full body)
    const msgsSnap = await cref.collection("messages").orderBy("createdAt", "asc").get();
    const body = msgsSnap.docs.map((d) => {
      const m = d.data();
      const role = m.role === "human" ? `Human ${m.authorEmail ?? "?"}` : m.role;
      return `**${role}**: ${m.content}`;
    }).join("\n\n");

    // 1. Generate AI summary (one-shot — not streaming)
    const provider = getProvider();
    const summaryPrompt = `Summarize this conversation:\n\n${body}\n\n` +
      `Output STRICT JSON with keys: title (≤60 chars), summary (≤300 chars, single paragraph), tags (3 short keywords).\n` +
      `Example: {"title":"...","summary":"...","tags":["a","b","c"]}`;

    let aiSummary = "";
    for await (const event of provider.streamMessage({
      system: "You generate concise, factual summaries of conversations.",
      messages: [{ role: "user", content: summaryPrompt }],
      tools: [],
      maxTokens: 500,
    })) {
      if (event.type === "text_delta") aiSummary += event.text;
    }

    let title = data.title ?? "(untitled)";
    let summary = data.summary ?? "";
    let tags: string[] = data.tags ?? [];

    // If user didn't pre-fill, parse AI summary JSON
    if (!data.title || !data.summary || !data.tags) {
      try {
        const match = aiSummary.match(/\{[\s\S]*\}/);
        const parsed = match ? JSON.parse(match[0]) as { title?: string; summary?: string; tags?: string[] } : {};
        if (!data.title && parsed.title) title = parsed.title;
        if (!data.summary && parsed.summary) summary = parsed.summary;
        if (!data.tags && Array.isArray(parsed.tags)) tags = parsed.tags;
      } catch {
        // fall back to defaults
        if (!data.summary) summary = body.slice(0, 280);
        if (!data.title) title = (conv.title as string) || "(shared)";
      }
    }

    // 2. Embedding
    const embedText = composeForEmbedding({ title, summary, body, tags });
    let embedding: number[];
    try {
      embedding = await embed(embedText);
    } catch (e) {
      throw new HttpsError("unavailable", `embed failed: ${(e as Error).message}`);
    }

    // 3. Firestore batch
    const sid = db.collection("shared-conversations").doc().id;
    const sref = db.doc(`shared-conversations/${sid}`);
    const tokens = tokenize(`${title} ${summary} ${body}`);

    const batch = db.batch();
    batch.set(sref, {
      fromCid: data.cid,
      ownerUid: uid,
      ownerEmail: email,
      title,
      summary,
      body: body.slice(0, 50_000),
      ...(data.scope ? { scope: data.scope } : conv.scope ? { scope: conv.scope } : {}),
      tags,
      embedding,
      embeddingModel: "text-embedding-005",
      tokens,
      sharedAt: admin.firestore.FieldValue.serverTimestamp(),
      voteCount: 0,
      lastVerifiedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    batch.update(cref, {
      shared: true,
      sharedConvId: sid,
      status: "shared",
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    await batch.commit();

    return { sid, title, summary };
  },
);
```

- [ ] **Step 2: Add tokenize helper**

`functions/src/share/tokenize.ts`:

```ts
const STOP = new Set([
  "the","a","an","of","to","in","for","on","is","it","this","that","with","and","or","does",
  "do","did","how","what","when","where","why","i","we","our","you","your","at","by","be","as",
]);

export function tokenize(s: string): string[] {
  return Array.from(new Set(s
    .toLowerCase()
    .replace(/[^a-z0-9가-힣\s\-_]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 2 && !STOP.has(t))
    .slice(0, 80)));
}
```

- [ ] **Step 3: Wire export**

In `functions/src/index.ts`:

```ts
export { mirrorUserProfile } from "./auth/mirrorUserProfile";
export { streamMessage } from "./chat/streamMessage";
export { shareConversation } from "./share/shareConversation";
```

- [ ] **Step 4: Build**

```bash
cd functions && npm run build && cd ..
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add functions/src/share functions/src/index.ts
git commit -m "functions: shareConversation — AI summary + Vertex embedding + Firestore batch"
```

---

### Task 3: searchShared HTTPS callable

**Files:**
- Create: `functions/src/search/searchShared.ts`
- Modify: `functions/src/index.ts`

- [ ] **Step 1: Write searchShared**

`functions/src/search/searchShared.ts`:

```ts
import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import { embed } from "../lib/embeddings";
import { VERTEX_LOCATION } from "../lib/secrets";

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

export const searchShared = onCall(
  {
    region: "asia-northeast3",
    timeoutSeconds: 30,
    memory: "256MiB",
    secrets: [VERTEX_LOCATION],
  },
  async (req) => {
    if (!req.auth?.token.email?.endsWith("@wrtn.io")) {
      throw new HttpsError("permission-denied", "@wrtn.io only");
    }
    const data = req.data as { text?: string; scope?: string; limit?: number };
    const text = data?.text?.trim();
    if (!text || text.length < 3) return { hits: [] };
    const limit = Math.min(20, data?.limit ?? 10);

    let queryEmbedding: number[];
    try { queryEmbedding = await embed(text); }
    catch (e) {
      console.error("searchShared: embed failed", e);
      throw new HttpsError("unavailable", "embedding service unavailable");
    }

    let q: FirebaseFirestore.Query = db.collection("shared-conversations");
    if (data?.scope) q = q.where("scope", "==", data.scope);

    const snap = await q
      .findNearest({
        vectorField: "embedding",
        queryVector: queryEmbedding,
        limit,
        distanceMeasure: "COSINE",
      })
      .get();

    return {
      hits: snap.docs.map((d) => {
        const x = d.data() as { title: string; summary: string; ownerEmail: string; scope?: string; sharedAt: FirebaseFirestore.Timestamp };
        return {
          sid: d.id,
          title: x.title,
          summary: x.summary,
          scope: x.scope ?? null,
          ownerEmail: x.ownerEmail,
          sharedAt: x.sharedAt?.toMillis?.() ?? null,
        };
      }),
    };
  },
);
```

- [ ] **Step 2: Wire export**

```ts
export { searchShared } from "./search/searchShared";
```

- [ ] **Step 3: Build + commit**

```bash
cd functions && npm run build && cd ..
git add functions/src/search functions/src/index.ts
git commit -m "functions: searchShared HTTPS callable — embed query + Firestore findNearest (COSINE)"
```

---

### Task 4: Wire list_related_shared_conversations to real Vertex search

**Files:**
- Modify: `functions/src/lib/tools.ts`

- [ ] **Step 1: Update the tool body**

In `functions/src/lib/tools.ts`, replace the stub `list_related_shared_conversations` body:

```ts
import { embed } from "./embeddings";

async function list_related_shared_conversations(i: Record<string, unknown>): Promise<unknown[]> {
  if (typeof i.scope !== "string") return [];
  if (!Array.isArray(i.keywords) || i.keywords.length === 0) return [];
  const keywords = (i.keywords as unknown[]).filter((k): k is string => typeof k === "string");
  if (keywords.length === 0) return [];

  let queryEmbedding: number[];
  try {
    queryEmbedding = await embed(keywords.join(" "));
  } catch {
    return [];  // graceful: tool returns empty if embedding service is down
  }

  const admin = await import("firebase-admin");
  if (!admin.apps.length) admin.initializeApp();
  const db = admin.firestore();

  const snap = await db.collection("shared-conversations")
    .where("scope", "==", i.scope)
    .findNearest({
      vectorField: "embedding",
      queryVector: queryEmbedding,
      limit: 5,
      distanceMeasure: "COSINE",
    })
    .get();

  return snap.docs.map((d) => {
    const x = d.data() as { title: string; summary: string };
    return { sid: d.id, title: x.title, summary: x.summary };
  });
}
```

- [ ] **Step 2: Build + commit**

```bash
cd functions && npm run build && cd ..
git add functions/src/lib/tools.ts
git commit -m "tools: list_related_shared_conversations uses Vertex embedding + findNearest"
```

---

### Task 5: Update Firestore rules + indexes

**Files:**
- Modify: `firestore.rules`
- Modify: `firestore.indexes.json`

- [ ] **Step 1: Update rules — already has shared-conversations stub, expand:**

In `firestore.rules`, the `match /shared-conversations/{sid}` already says `allow read: if isWrtn(); allow write: if false;`. That's correct — Cloud Function uses Admin SDK to bypass.

No change needed unless you want explicit rule. Skip.

- [ ] **Step 2: Add vector index for shared-conversations**

In `firestore.indexes.json`, append:

```json
,
{
  "collectionGroup": "shared-conversations",
  "queryScope": "COLLECTION",
  "fields": [
    {
      "fieldPath": "embedding",
      "vectorConfig": {
        "dimension": 768,
        "flat": {}
      }
    }
  ]
},
{
  "collectionGroup": "shared-conversations",
  "queryScope": "COLLECTION",
  "fields": [
    { "fieldPath": "scope", "order": "ASCENDING" },
    {
      "fieldPath": "embedding",
      "vectorConfig": {
        "dimension": 768,
        "flat": {}
      }
    }
  ]
},
{
  "collectionGroup": "shared-conversations",
  "queryScope": "COLLECTION",
  "fields": [
    { "fieldPath": "sharedAt", "order": "DESCENDING" }
  ]
}
```

- [ ] **Step 3: Commit**

```bash
git add firestore.rules firestore.indexes.json
git commit -m "indexes: vector indexes on shared-conversations.embedding (with and without scope filter) + sharedAt"
```

---

### Task 6: Client-side share UI + callables

**Files:**
- Create: `src/lib/firebase/share-callables.ts`
- Create: `src/components/chat/share-button.tsx`
- Modify: `src/app/c/[cid]/page.tsx`

- [ ] **Step 1: Callables wrapper**

`src/lib/firebase/share-callables.ts`:

```ts
"use client";
import { getFunctions, httpsCallable } from "firebase/functions";
import { getFirebase } from "./client";

const REGION = "asia-northeast3";
function fns() {
  const { app } = getFirebase();
  return getFunctions(app, REGION);
}

export async function callShareConversation(input: {
  cid: string;
  title?: string;
  summary?: string;
  tags?: string[];
  scope?: string;
}) {
  const fn = httpsCallable<typeof input, { sid: string; title: string; summary: string }>(
    fns(), "shareConversation",
  );
  return (await fn(input)).data;
}

export async function callSearchShared(text: string, scope?: string) {
  const fn = httpsCallable<
    { text: string; scope?: string; limit?: number },
    { hits: Array<{ sid: string; title: string; summary: string; scope: string | null; ownerEmail: string; sharedAt: number | null }> }
  >(fns(), "searchShared");
  return (await fn({ text, scope, limit: 10 })).data.hits;
}
```

- [ ] **Step 2: Share button + modal**

`src/components/chat/share-button.tsx`:

```tsx
"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { callShareConversation } from "@/lib/firebase/share-callables";

export function ShareButton({ cid, defaultTitle, onShared }: {
  cid: string;
  defaultTitle: string;
  onShared: (sid: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(defaultTitle);
  const [summary, setSummary] = useState("");
  const [tagsRaw, setTagsRaw] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function share() {
    setErr(null);
    setBusy(true);
    try {
      const tags = tagsRaw.split(",").map((t) => t.trim()).filter(Boolean);
      const r = await callShareConversation({
        cid,
        title: title || undefined,
        summary: summary || undefined,
        tags: tags.length > 0 ? tags : undefined,
      });
      onShared(r.sid);
      setOpen(false);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return <Button variant="outline" onClick={() => setOpen(true)}>Share to team</Button>;
  }
  return (
    <div className="space-y-2 rounded-lg border bg-amber-50/30 p-4 text-sm">
      <div className="font-medium">Share preview</div>
      <p className="text-xs text-muted-foreground">
        AI will fill in title/summary if you leave them blank. Body of the conversation is included automatically.
      </p>
      <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title (≤60 chars)" maxLength={60} />
      <Textarea value={summary} onChange={(e) => setSummary(e.target.value)} placeholder="Summary (1 paragraph; AI fills if blank)" rows={3} />
      <Input value={tagsRaw} onChange={(e) => setTagsRaw(e.target.value)} placeholder="tags (comma-separated, optional)" />
      {err && <p role="alert" className="text-destructive">{err}</p>}
      <div className="flex gap-2">
        <Button onClick={share} disabled={busy}>{busy ? "Sharing..." : "Share"}</Button>
        <Button variant="ghost" onClick={() => setOpen(false)} disabled={busy}>Cancel</Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Wire ShareButton into /c/[cid]**

In `src/app/c/[cid]/page.tsx`, after the `<header>` block, add:

```tsx
import { ShareButton } from "@/components/chat/share-button";
// ... inside the component body, alongside other state:
const [sharedNotice, setSharedNotice] = useState<string | null>(null);

// In JSX, between <section> (messages) and <footer> (composer):
{isOwner && conv.status !== "shared" && conv.status !== "ended" && messages.length >= 2 && (
  <ShareButton
    cid={cid}
    defaultTitle={conv.title}
    onShared={(sid) => setSharedNotice(`Shared: /feed/${sid}`)}
  />
)}
{sharedNotice && (
  <p className="text-sm text-emerald-700">{sharedNotice}</p>
)}
{conv.status === "shared" && (
  <p className="text-xs text-muted-foreground">
    Shared to team. View at <a className="underline" href={`/feed/${conv.sharedConvId}`}>/feed/{conv.sharedConvId}</a>.
  </p>
)}
```

- [ ] **Step 4: Build + commit**

```bash
npm run build
git add src/lib/firebase/share-callables.ts src/components/chat/share-button.tsx src/app/c
git commit -m "ui: share button + modal on conversation detail; emits sid link on success"
```

---

### Task 7: Feed list + detail pages

**Files:**
- Create: `src/components/feed/feed-card.tsx`
- Create: `src/app/feed/[sid]/page.tsx`
- Modify: `src/app/feed/page.tsx`
- Modify: `src/app/page.tsx` (home preview)

- [ ] **Step 1: Feed card**

`src/components/feed/feed-card.tsx`:

```tsx
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";

export function FeedCard({ hit }: {
  hit: {
    sid: string;
    title: string;
    summary: string;
    scope?: string | null;
    ownerEmail?: string;
    sharedAt?: number | null | { toMillis: () => number };
  };
}) {
  const ts = typeof hit.sharedAt === "number" ? hit.sharedAt
            : (hit.sharedAt && typeof (hit.sharedAt as { toMillis?: () => number }).toMillis === "function" ? (hit.sharedAt as { toMillis: () => number }).toMillis() : null);
  return (
    <Link href={`/feed/${hit.sid}`}>
      <Card className="hover:bg-accent">
        <CardContent className="space-y-1 py-3 text-sm">
          <div className="font-medium">{hit.title}</div>
          <div className="text-muted-foreground">{hit.summary}</div>
          <div className="flex gap-3 text-xs text-muted-foreground">
            {hit.scope && <span>scope: <span className="font-mono">{hit.scope}</span></span>}
            {hit.ownerEmail && <span>by <span className="font-mono">{hit.ownerEmail}</span></span>}
            {ts && <span>{new Date(ts).toLocaleString()}</span>}
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
```

- [ ] **Step 2: Feed list page**

`src/app/feed/page.tsx`:

```tsx
"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { collection, getDocs, limit, orderBy, query } from "firebase/firestore";
import { useAuth } from "@/lib/firebase/auth-provider";
import { getFirebase } from "@/lib/firebase/client";
import { FeedCard } from "@/components/feed/feed-card";

interface Item {
  sid: string;
  title: string;
  summary: string;
  scope?: string;
  ownerEmail: string;
  sharedAt: { toMillis: () => number };
}

export default function FeedPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [items, setItems] = useState<Item[]>([]);

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [loading, user, router]);

  useEffect(() => {
    if (!user) return;
    const { db } = getFirebase();
    const q = query(
      collection(db, "shared-conversations"),
      orderBy("sharedAt", "desc"),
      limit(50),
    );
    getDocs(q).then((snap) => {
      setItems(snap.docs.map((d) => ({ sid: d.id, ...(d.data() as Omit<Item, "sid">) })));
    });
  }, [user]);

  if (loading || !user) return null;

  return (
    <main className="mx-auto max-w-3xl space-y-3 p-6">
      <h1 className="text-2xl font-semibold">Team feed</h1>
      {items.length === 0 && <p className="text-sm text-muted-foreground">Nothing shared yet.</p>}
      {items.map((h) => <FeedCard key={h.sid} hit={h} />)}
    </main>
  );
}
```

- [ ] **Step 3: Feed detail page**

`src/app/feed/[sid]/page.tsx`:

```tsx
"use client";
import { use, useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { doc, getDoc } from "firebase/firestore";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/firebase/auth-provider";
import { getFirebase } from "@/lib/firebase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function SharedDetailPage({ params }: { params: Promise<{ sid: string }> }) {
  const { sid } = use(params);
  const { user, loading } = useAuth();
  const router = useRouter();
  const [item, setItem] = useState<{ title: string; summary: string; body: string; ownerEmail: string; scope?: string } | null>(null);

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [loading, user, router]);

  useEffect(() => {
    if (!user) return;
    const { db } = getFirebase();
    getDoc(doc(db, "shared-conversations", sid)).then((s) => {
      setItem(s.exists() ? (s.data() as typeof item) : null);
    });
  }, [user, sid]);

  if (loading || !user) return null;
  if (!item) return <main className="p-6">Loading…</main>;

  return (
    <main className="mx-auto max-w-3xl space-y-4 p-6">
      <Card>
        <CardHeader>
          <CardTitle>{item.title}</CardTitle>
          <div className="mt-1 text-xs text-muted-foreground">
            {item.scope && <>scope: <span className="font-mono">{item.scope}</span> · </>}
            shared by <span className="font-mono">{item.ownerEmail}</span>
          </div>
        </CardHeader>
        <CardContent>
          <p className="text-sm">{item.summary}</p>
        </CardContent>
      </Card>
      <article className="rounded-lg border bg-accent/30 p-5">
        <h2 className="mb-3 text-sm font-medium text-muted-foreground">Full conversation</h2>
        <div className="prose prose-sm max-w-none">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{item.body}</ReactMarkdown>
        </div>
      </article>
    </main>
  );
}
```

- [ ] **Step 4: Home preview of feed**

In `src/app/page.tsx`, add after the recent-conversations section:

```tsx
import { collection, getDocs, limit, orderBy, query } from "firebase/firestore";
// add to existing useEffect that loads recent, OR a new effect:
const [feedPreview, setFeedPreview] = useState<{ sid: string; title: string }[]>([]);
useEffect(() => {
  if (!user) return;
  const { db } = getFirebase();
  const q = query(collection(db, "shared-conversations"), orderBy("sharedAt", "desc"), limit(5));
  getDocs(q).then((snap) => setFeedPreview(snap.docs.map((d) => ({ sid: d.id, title: (d.data() as { title: string }).title }))));
}, [user]);

// Render block:
{feedPreview.length > 0 && (
  <section className="space-y-2">
    <h2 className="text-sm font-medium text-muted-foreground">Recently shared by team</h2>
    {feedPreview.map((f) => (
      <Link key={f.sid} href={`/feed/${f.sid}`} className="block rounded border px-3 py-2 text-sm hover:bg-accent">
        {f.title}
      </Link>
    ))}
  </section>
)}
```

(Add the imports `getFirebase` from `@/lib/firebase/client`, `collection/orderBy/limit/getDocs/query` from `firebase/firestore` to the home page if not already imported.)

- [ ] **Step 5: Build + commit**

```bash
npm run build
git add src/components/feed src/app/feed src/app/page.tsx
git commit -m "ui: /feed list + /feed/[sid] detail + home recent-shared preview"
```

---

### Task 8: Search page

**Files:**
- Modify: `src/app/search/page.tsx`

- [ ] **Step 1: Implement semantic search**

```tsx
"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/firebase/auth-provider";
import { Input } from "@/components/ui/input";
import { FeedCard } from "@/components/feed/feed-card";
import { callSearchShared } from "@/lib/firebase/share-callables";

interface Hit {
  sid: string;
  title: string;
  summary: string;
  scope: string | null;
  ownerEmail: string;
  sharedAt: number | null;
}

export default function SearchPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [text, setText] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [busy, setBusy] = useState(false);
  const [searched, setSearched] = useState(false);

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [loading, user, router]);

  async function search(e: React.FormEvent) {
    e.preventDefault();
    if (text.trim().length < 3) return;
    setBusy(true);
    setSearched(true);
    try {
      const result = await callSearchShared(text);
      setHits(result);
    } finally {
      setBusy(false);
    }
  }

  if (loading || !user) return null;

  return (
    <main className="mx-auto max-w-3xl space-y-3 p-6">
      <h1 className="text-2xl font-semibold">Search</h1>
      <form onSubmit={search} className="flex gap-2">
        <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="Find shared answers..." />
      </form>
      {busy && <p className="text-sm text-muted-foreground">Searching…</p>}
      {!busy && searched && hits.length === 0 && <p className="text-sm text-muted-foreground">No matches. Ask in chat to start a new conversation.</p>}
      {hits.map((h) => (
        <FeedCard
          key={h.sid}
          hit={{
            sid: h.sid,
            title: h.title,
            summary: h.summary,
            scope: h.scope,
            ownerEmail: h.ownerEmail,
            sharedAt: h.sharedAt,
          }}
        />
      ))}
    </main>
  );
}
```

- [ ] **Step 2: Build + commit**

```bash
npm run build
git add src/app/search
git commit -m "ui: /search uses searchShared callable for embedding-backed semantic search"
```

---

### Task 9: LOCAL CHECKPOINT — share + feed + search

Vertex AI is the new external dep. **For local emulator**, Vertex calls hit Google Cloud (real billing) — there's no local Vertex stub. Options:
- **A.** Skip share/search testing locally; deploy to staging Firebase project with real Vertex API enabled.
- **B.** Stub Vertex by setting `VERTEX_LOCATION` to a fake value and patching `embed()` to return a deterministic 768-d vector when running against emulator.

For Phase 1 simplicity, pick **A** (real Vertex against a staging project) OR temporarily wire a local stub:

- [ ] **Step 1: Optional local Vertex stub for emulator-only testing**

In `functions/src/lib/embeddings.ts`, add at top of `embed()`:

```ts
if (process.env.FUNCTIONS_EMULATOR === "true" && process.env.VERTEX_STUB === "1") {
  // Deterministic stub: return a 768-d vector seeded from text hash.
  const seed = text.split("").reduce((s, c) => (s * 31 + c.charCodeAt(0)) >>> 0, 7);
  const out = new Array(768);
  let r = seed;
  for (let i = 0; i < 768; i++) {
    r = (r * 1103515245 + 12345) >>> 0;
    out[i] = ((r % 200000) - 100000) / 100000;
  }
  return out;
}
```

Then in `functions/.env.local` (or before launching emulator):

```
VERTEX_STUB=1
```

Restart the emulator. Now `embed()` returns a fake 768-d vector and Firestore vector search works against the local emulator's data (Firestore emulator supports `findNearest` since recent firebase-tools versions).

- [ ] **Step 2: Verify locally**

```bash
# emulator + seed + dev (3 terminals as before)
```

In the browser:

1. Sign in as alice → open her sample conversation → send a few messages so it has at least 2 messages
2. Click "Share to team" → fill in title (or leave blank for AI fill — but AI fill via Mock will produce non-JSON; the fallback in shareConversation handles this)
3. After share: see the success notice with sid
4. Visit `/feed` → see your shared conversation
5. Visit `/feed/{sid}` → see full snapshot
6. Visit `/search` → type a keyword from your shared content → should return the hit

- [ ] **Step 3: Push + PR**

```bash
git push -u origin plan/team-chat-4-share-feed-search
gh pr create --base main --head plan/team-chat-4-share-feed-search \
  --title "feat: share + feed + search (Plan 4)" \
  --body "Plan 4. shareConversation (AI summary + Vertex embedding), searchShared (vector findNearest), /feed list + detail, /search semantic, list_related_shared_conversations wired to real search. Local checkpoint requires Vertex (real or stubbed via VERTEX_STUB=1)."
```

---

## Self-review notes

- **Spec coverage:** §3 share flow ✓, §6 share details (AI summary, embedding, snapshot, re-share supported via duplicate sid creation) ✓, §7 feed/search ✓, §4 list_related_shared_conversations real impl ✓.
- **VERTEX_STUB env var:** intentional — lets the local emulator exercise the share flow without a real GCP project. Clearly named so it's not accidentally enabled in production. Consider removing the gate in Phase 2 if VERTEX_STUB=1 in prod is impossible.
- **AI summary parsing:** the prompt asks for strict JSON; we attempt `JSON.parse(match)`. If it fails (e.g., Mock provider doesn't emit JSON), we fall back to the conversation title + body slice. User can also pre-fill the form fields, in which case AI summary is skipped for those fields.
- **Embedding cost:** ~$0.00001 per share + per search. Negligible.
- **Re-share semantics:** sharing twice creates two `shared-conversations` docs. The original `conversation.sharedConvId` is overwritten by the second share. UI could show "shared 2 times" by querying `where("fromCid","==",cid)` — Phase 2 polish.
- **Search privacy:** searches the entire `shared-conversations` collection (visible to any `@wrtn.io`). This matches the spec — once you share, it's discoverable team-wide.
- **Empty conversations:** the share button is hidden until `messages.length >= 2` (at least one user msg + one assistant msg). Prevents sharing of new/empty chats.
