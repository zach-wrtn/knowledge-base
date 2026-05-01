# Team Q&A Wiki — Phase 2 Plan A: Embedding-Based Similarity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the brittle token-intersection search and the keyword-overlap `list_related_qa` tool with semantic similarity backed by Vertex AI text embeddings + Firestore vector search. Drives both the in-UI search (`/search`, ask-page suggestions) and the AI agent's KB retrieval to higher precision/recall as the corpus grows.

**Architecture:** Each approved Q&A gets a 768-dim embedding written to its `qa-records/{qaId}.embedding` field at `approveAndCommit` time. Question text + answer body + tags are concatenated into the embedding source. Firestore vector search (`COSINE` distance, 768 dim) replaces array-contains for `/search` and the duplicate-suggestion query on the ask page. The AI agent's `list_related_qa` tool switches to embedding similarity (computed via the same Vertex AI model) instead of keyword scoring. A backfill script computes embeddings for any pre-Phase-2 records.

**Tech Stack:** Vertex AI `text-embedding-005` (768 dim), `@google-cloud/aiplatform` SDK in Cloud Functions, Firestore composite index with `vector` field config, Next.js callable for query embedding, Genkit-style chunking helper.

**Spec:** `docs/superpowers/specs/2026-04-30-team-qa-wiki-design.md` §5 Phase 2 ("embedding-based similarity").

**Prerequisites:** Phase 1 deployed and validated. At least one approved Q&A in `learning/qa/` (so embedding writes have something to attach to). Vertex AI API enabled on the `zzem-qa-wiki` GCP project.

**Repo context:** All paths are relative to `zzem-qa-wiki` unless prefixed with `zzem-knowledge-base/`.

---

## File Structure

**Create — Cloud Functions:**
- `functions/src/lib/embeddings.ts` — Vertex AI client + `embed(text: string): Promise<number[]>`
- `functions/src/lib/embedding-source.ts` — text composer (question + answer + tags → single string, length-bounded)
- `functions/src/maintenance/backfillEmbeddings.ts` — HTTPS callable, admin-only, scans `qa-records` and fills missing embeddings (idempotent)
- `functions/src/lib/__tests__/embedding-source.test.ts`

**Modify — Cloud Functions:**
- `functions/src/review/approveAndCommit.ts` — compute and store embedding alongside other qa-records fields
- `functions/src/lib/tools.ts` — `list_related_qa` switches from keyword scoring to embedding similarity
- `functions/src/lib/secrets.ts` — add `VERTEX_LOCATION` (defaults to `asia-northeast3`)
- `functions/src/index.ts` — export `backfillEmbeddings`
- `functions/package.json` — add `@google-cloud/aiplatform`

**Create — App:**
- `src/lib/firebase/embed-callables.ts` — typed wrapper for the new embedding-search callable

**Modify — App:**
- `src/components/qa/search-bar.tsx` — switch to embedding search via callable
- `src/app/ask/page.tsx` — switch duplicate-suggestion to embedding search

**Modify — Firestore:**
- `firestore.indexes.json` — add vector index on `qa-records.embedding`
- `firestore.rules` — qa-records vector queries are still gated to `isWrtn()` (no rule change needed; vector search respects existing read rules)

---

## §1 — Embedding source composition

The same text shape must be used at write time AND query time. Drift here ruins recall.

**Decision: question + answer + tags, concatenated with newlines, truncated to 8000 characters.**

Justification:
- Question carries the most signal per token. Always included in full.
- Answer body provides context that disambiguates similar questions (e.g. "filter rollout" in `free-tab` vs `ai-webtoon`).
- Tags add weak topical signal. Always included if present.
- Vertex `text-embedding-005` accepts up to 2,048 tokens (~8K chars); we cap at 8K characters to stay safely under.

For QUERY-TIME embedding (when a user types in /search or /ask), we embed only the query string — typically <100 chars. The asymmetry is fine: the query string is shorter but the embedding model is the same, so cosine similarity remains meaningful.

---

### Task 1: Add Vertex AI client + embedding function

**Files:**
- Modify: `functions/package.json`
- Create: `functions/src/lib/embeddings.ts`

- [ ] **Step 1: Install dep**

```bash
cd functions
npm install @google-cloud/aiplatform
cd ..
```

- [ ] **Step 2: Add VERTEX_LOCATION secret reference**

In `functions/src/lib/secrets.ts`, append:
```ts
export const VERTEX_LOCATION = defineSecret("VERTEX_LOCATION");
```

(Set via `firebase functions:secrets:set VERTEX_LOCATION` to e.g. `asia-northeast3` — see runbook.)

- [ ] **Step 3: Write the embedding helper**

`functions/src/lib/embeddings.ts`:
```ts
import { PredictionServiceClient, helpers } from "@google-cloud/aiplatform";
import { VERTEX_LOCATION } from "./secrets";

const MODEL = "text-embedding-005";
const DIM = 768;

let client: PredictionServiceClient | null = null;
function getClient(): PredictionServiceClient {
  if (!client) {
    const location = VERTEX_LOCATION.value();
    client = new PredictionServiceClient({ apiEndpoint: `${location}-aiplatform.googleapis.com` });
  }
  return client;
}

export async function embed(text: string): Promise<number[]> {
  if (!text.trim()) throw new Error("embed: empty text");
  const project = process.env.GCLOUD_PROJECT ?? process.env.GCP_PROJECT;
  if (!project) throw new Error("embed: GCLOUD_PROJECT not set");
  const location = VERTEX_LOCATION.value();
  const endpoint = `projects/${project}/locations/${location}/publishers/google/models/${MODEL}`;

  const instances = [helpers.toValue({ content: text }) as never];
  const [response] = await getClient().predict({ endpoint, instances });
  const embedding = (response.predictions?.[0] as { structValue?: { fields?: { embeddings?: { structValue?: { fields?: { values?: { listValue?: { values?: { numberValue?: number }[] } } } } } } } })
    ?.structValue?.fields?.embeddings?.structValue?.fields?.values?.listValue?.values
    ?.map((v) => v.numberValue ?? 0);

  if (!embedding || embedding.length !== DIM) {
    throw new Error(`embed: unexpected response shape (got ${embedding?.length} dims)`);
  }
  return embedding;
}

export const EMBEDDING_DIM = DIM;
```

- [ ] **Step 4: Build**

```bash
cd functions && npm run build && cd ..
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add functions/package.json functions/src/lib/secrets.ts functions/src/lib/embeddings.ts
git commit -m "functions: vertex ai text-embedding-005 client (768 dim)"
```

---

### Task 2: Embedding source composer

**Files:**
- Create: `functions/src/lib/embedding-source.ts`
- Create: `functions/src/lib/__tests__/embedding-source.test.ts`

- [ ] **Step 1: Write composer**

`functions/src/lib/embedding-source.ts`:
```ts
const MAX_CHARS = 8000;

export function composeForEmbedding(input: {
  question: string;
  answer: string;
  tags?: string[];
}): string {
  const parts: string[] = [];
  parts.push(`Q: ${input.question.trim()}`);
  if (input.tags && input.tags.length > 0) {
    parts.push(`Tags: ${input.tags.map((t) => t.trim()).filter(Boolean).join(", ")}`);
  }
  parts.push(`A: ${input.answer.trim()}`);
  const joined = parts.join("\n\n");
  if (joined.length <= MAX_CHARS) return joined;
  // Truncate the answer first (longest, most fungible content), keep question + tags whole.
  const head = parts.slice(0, -1).join("\n\n");
  const remaining = MAX_CHARS - head.length - "\n\nA: ".length - 4; // 4 chars headroom for "..."
  if (remaining < 100) return joined.slice(0, MAX_CHARS); // pathological — just hard-truncate
  return head + "\n\nA: " + input.answer.trim().slice(0, remaining) + " ...";
}
```

- [ ] **Step 2: Write tests**

`functions/src/lib/__tests__/embedding-source.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { composeForEmbedding } from "../embedding-source";

describe("composeForEmbedding", () => {
  it("includes question, answer, and tags in order", () => {
    const out = composeForEmbedding({
      question: "When does free-tab end?",
      answer: "Q3 2026.",
      tags: ["rollout", "experiment"],
    });
    expect(out).toMatch(/^Q: When does free-tab end\?/);
    expect(out).toContain("Tags: rollout, experiment");
    expect(out).toContain("A: Q3 2026.");
    expect(out.indexOf("Q: ")).toBeLessThan(out.indexOf("Tags:"));
    expect(out.indexOf("Tags:")).toBeLessThan(out.indexOf("A: "));
  });

  it("omits Tags line when empty", () => {
    const out = composeForEmbedding({ question: "Q", answer: "A", tags: [] });
    expect(out).not.toContain("Tags:");
  });

  it("omits Tags line when undefined", () => {
    const out = composeForEmbedding({ question: "Q", answer: "A" });
    expect(out).not.toContain("Tags:");
  });

  it("truncates the answer (not question) when oversized", () => {
    const out = composeForEmbedding({
      question: "short question",
      answer: "x".repeat(10_000),
    });
    expect(out.length).toBeLessThanOrEqual(8000);
    expect(out).toContain("Q: short question");
    expect(out).toMatch(/A: x+ \.\.\.$/);
  });

  it("trims input fields", () => {
    const out = composeForEmbedding({
      question: "  spaced question  ",
      answer: "\n\nspaced answer\n\n",
    });
    expect(out).toContain("Q: spaced question\n");
    expect(out).toContain("A: spaced answer");
  });
});
```

- [ ] **Step 3: Run tests**

```bash
cd functions && npm test && cd ..
```

Expected: 5 new tests pass; total = 34 (was 29).

- [ ] **Step 4: Commit**

```bash
git add functions/src/lib/embedding-source.ts functions/src/lib/__tests__/embedding-source.test.ts
git commit -m "functions: deterministic embedding source composer"
```

---

### Task 3: Wire embedding into approveAndCommit

**Files:**
- Modify: `functions/src/review/approveAndCommit.ts`

- [ ] **Step 1: Import embed helper**

At the top of `functions/src/review/approveAndCommit.ts`, add:
```ts
import { embed } from "../lib/embeddings";
import { composeForEmbedding } from "../lib/embedding-source";
import { VERTEX_LOCATION } from "../lib/secrets";
```

- [ ] **Step 2: Add VERTEX_LOCATION to secrets list**

In the `onCall` options, replace `secrets: [...]` with:
```ts
secrets: [GITHUB_OWNER, GITHUB_REPO, GITHUB_TOKEN, SLACK_WEBHOOK_URL, ANTHROPIC_API_KEY, VERTEX_LOCATION],
```

- [ ] **Step 3: Compute embedding before the qa-records write**

In the body of `approveAndCommit`, after the commit succeeds and BEFORE the batch write:

```ts
let embedding: number[] | null;
try {
  const text = composeForEmbedding({
    question: q.text,
    answer: draft.body as string,
    tags: [],
  });
  embedding = await embed(text);
} catch (e) {
  // Embedding failure must NOT block approval — log and proceed without it.
  console.error("embed failed for", committed.qaId, e);
  embedding = null;
}
```

- [ ] **Step 4: Add embedding to the qa-records doc**

Modify the `batch.set(db.doc(\`qa-records/${committed.qaId}\`), { ... })` block to add:
```ts
batch.set(db.doc(`qa-records/${committed.qaId}`), {
  qid,
  scope: q.scope,
  // ... existing fields ...
  tokens,
  embedding,           // null if embedding call failed; backfill later
  embeddingModel: embedding ? "text-embedding-005" : null,
});
```

- [ ] **Step 5: Build**

```bash
cd functions && npm run build && cd ..
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add functions/src/review/approveAndCommit.ts
git commit -m "approveAndCommit: store 768-dim embedding alongside qa-records (non-blocking)"
```

---

### Task 4: Switch list_related_qa to embedding similarity

**Files:**
- Modify: `functions/src/lib/tools.ts`

- [ ] **Step 1: Add imports**

At the top of `functions/src/lib/tools.ts`:
```ts
import * as admin from "firebase-admin";
import { embed } from "./embeddings";

if (!admin.apps.length) admin.initializeApp();
```

- [ ] **Step 2: Replace `list_related_qa` body**

Replace the existing implementation with:

```ts
async function list_related_qa(i: Record<string, unknown>) {
  if (typeof i.scope !== "string") throw new Error("scope required");
  if (!Array.isArray(i.keywords)) throw new Error("keywords required");
  const scope = i.scope;
  const keywords = (i.keywords as unknown[])
    .filter((k): k is string => typeof k === "string");
  if (keywords.length === 0) return [];

  // Embed the keywords as a single query, then run a Firestore vector search
  // restricted to qa-records in the same scope.
  let queryEmbedding: number[];
  try {
    queryEmbedding = await embed(keywords.join(" "));
  } catch {
    // Fall back to keyword overlap if embedding service is down.
    return keywordFallback(scope, keywords);
  }

  const db = admin.firestore();
  const snap = await db.collection("qa-records")
    .where("scope", "==", scope)
    .findNearest({
      vectorField: "embedding",
      queryVector: queryEmbedding,
      limit: 5,
      distanceMeasure: "COSINE",
    })
    .get();

  return snap.docs.map((d) => {
    const data = d.data() as { questionText: string };
    return {
      qa_id: d.id,
      question: data.questionText,
    };
  });
}

async function keywordFallback(scope: string, keywords: string[]): Promise<{ qa_id: string; question: string }[]> {
  const db = admin.firestore();
  const lowerKws = keywords.map((k) => k.toLowerCase());
  const snap = await db.collection("qa-records")
    .where("scope", "==", scope)
    .limit(50)
    .get();
  return snap.docs
    .map((d) => {
      const data = d.data() as { questionText: string; tokens?: string[] };
      const tokens = data.tokens ?? [];
      const score = lowerKws.reduce((s, kw) => s + (tokens.includes(kw) ? 1 : 0), 0);
      return { qa_id: d.id, question: data.questionText, score };
    })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map(({ qa_id, question }) => ({ qa_id, question }));
}
```

- [ ] **Step 3: Build**

```bash
cd functions && npm run build && cd ..
```

Expected: PASS. Note: `findNearest` is available in `@google-cloud/firestore` ≥ 7.10 — pinned via firebase-admin v12+.

- [ ] **Step 4: Commit**

```bash
git add functions/src/lib/tools.ts
git commit -m "tools: list_related_qa uses embedding similarity (keyword fallback on embed error)"
```

---

### Task 5: Add Firestore vector index

**Files:**
- Modify: `firestore.indexes.json`

- [ ] **Step 1: Add the vector index**

Append to the `indexes` array:

```json
{
  "collectionGroup": "qa-records",
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
}
```

- [ ] **Step 2: Deploy indexes**

```bash
npx firebase deploy --only firestore:indexes
```

Vector index build typically takes 5–30 minutes for a small dataset; check progress in Firebase Console → Firestore → Indexes.

- [ ] **Step 3: Commit**

```bash
git add firestore.indexes.json
git commit -m "indexes: vector index on qa-records.embedding (768 dim, COSINE-ready)"
```

---

### Task 6: HTTPS callable for query-side embedding search

**Files:**
- Create: `functions/src/search/searchByEmbedding.ts`
- Modify: `functions/src/index.ts`

- [ ] **Step 1: Write the callable**

`functions/src/search/searchByEmbedding.ts`:
```ts
import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import { embed } from "../lib/embeddings";
import { ANTHROPIC_API_KEY, VERTEX_LOCATION } from "../lib/secrets";

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

export const searchByEmbedding = onCall(
  {
    secrets: [ANTHROPIC_API_KEY, VERTEX_LOCATION],
    region: "asia-northeast3",
    timeoutSeconds: 30,
    memory: "256MiB",
  },
  async (req) => {
    if (!req.auth?.token.email?.endsWith("@wrtn.io")) {
      throw new HttpsError("permission-denied", "@wrtn.io only.");
    }
    const text = (req.data as { text?: string; scope?: string; limit?: number })?.text?.trim();
    const scope = (req.data as { scope?: string })?.scope;
    const limit = Math.min(20, (req.data as { limit?: number })?.limit ?? 10);
    if (!text || text.length < 3) return { hits: [] };

    let queryEmbedding: number[];
    try {
      queryEmbedding = await embed(text);
    } catch (e) {
      console.error("searchByEmbedding: embed failed", e);
      throw new HttpsError("unavailable", "Embedding service unavailable.");
    }

    let q = db.collection("qa-records") as FirebaseFirestore.Query;
    if (scope) q = q.where("scope", "==", scope);

    const snap = await q
      .findNearest({
        vectorField: "embedding",
        queryVector: queryEmbedding,
        limit,
        distanceMeasure: "COSINE",
      })
      .get();

    const hits = snap.docs.map((d) => {
      const data = d.data() as { questionText: string; scope: string; githubUrl: string };
      return {
        qaId: d.id,
        questionText: data.questionText,
        scope: data.scope,
        githubUrl: data.githubUrl,
      };
    });
    return { hits };
  },
);
```

- [ ] **Step 2: Wire export**

In `functions/src/index.ts`:
```ts
export { searchByEmbedding } from "./search/searchByEmbedding";
```

- [ ] **Step 3: Build + deploy**

```bash
cd functions && npm run build && cd ..
npx firebase deploy --only functions:searchByEmbedding
```

- [ ] **Step 4: Commit**

```bash
git add functions/src/search/searchByEmbedding.ts functions/src/index.ts
git commit -m "functions: searchByEmbedding HTTPS callable (vector search, scope-optional)"
```

---

### Task 7: Switch UI search to the embedding callable

**Files:**
- Create: `src/lib/firebase/search-callables.ts`
- Modify: `src/components/qa/search-bar.tsx`
- Modify: `src/app/ask/page.tsx`

- [ ] **Step 1: Wrapper**

`src/lib/firebase/search-callables.ts`:
```ts
"use client";
import { getFunctions, httpsCallable } from "firebase/functions";
import { getFirebase } from "./client";

interface Hit {
  qaId: string;
  questionText: string;
  scope: string;
  githubUrl: string;
}

export async function callSearchByEmbedding(
  text: string,
  scope?: string,
  limit = 10,
): Promise<Hit[]> {
  const { app } = getFirebase();
  const fns = getFunctions(app, "asia-northeast3");
  const fn = httpsCallable<{ text: string; scope?: string; limit?: number }, { hits: Hit[] }>(
    fns,
    "searchByEmbedding",
  );
  const res = await fn({ text, ...(scope ? { scope } : {}), limit });
  return res.data.hits;
}
```

- [ ] **Step 2: Update SearchBar**

Replace the `search()` function in `src/components/qa/search-bar.tsx` with:

```ts
async function search() {
  if (text.trim().length < 3) { setHits([]); return; }
  setBusy(true);
  try {
    const hits = await callSearchByEmbedding(text, undefined, 10);
    setHits(hits);
  } catch (e) {
    console.error("search failed", e);
    setHits([]);
  } finally {
    setBusy(false);
  }
}
```

Add the import:
```ts
import { callSearchByEmbedding } from "@/lib/firebase/search-callables";
```

Remove the `tokenize` helper at the bottom — it's no longer used.

- [ ] **Step 3: Update ask page suggestions**

In `src/app/ask/page.tsx`, replace the debounced effect's body with:

```ts
useEffect(() => {
  const t = text.trim();
  if (t.length < 5) { setRelated([]); return; }
  const id = setTimeout(async () => {
    try {
      const hits = await callSearchByEmbedding(t, scope, 5);
      setRelated(hits.map((h) => ({
        qaId: h.qaId,
        questionText: h.questionText,
        scope: h.scope,
      })));
    } catch {
      // best-effort only
    }
  }, 350);
  return () => clearTimeout(id);
}, [text, scope]);
```

(Note: now passes `scope` so suggestions are scope-aware. Add `callSearchByEmbedding` import.)

- [ ] **Step 4: Build**

```bash
npm run build
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/firebase/search-callables.ts src/components/qa/search-bar.tsx src/app/ask/page.tsx
git commit -m "ui: search + ask suggestions use embedding-backed search callable"
```

---

### Task 8: Backfill function for pre-Phase-2 records

**Files:**
- Create: `functions/src/maintenance/backfillEmbeddings.ts`
- Modify: `functions/src/index.ts`

- [ ] **Step 1: Write the function**

`functions/src/maintenance/backfillEmbeddings.ts`:
```ts
import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import { embed } from "../lib/embeddings";
import { composeForEmbedding } from "../lib/embedding-source";
import { ANTHROPIC_API_KEY, VERTEX_LOCATION } from "../lib/secrets";

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

const ADMIN_EMAILS = ["zach@wrtn.io"]; // hardcoded; sync with qa-owners.yaml admins

export const backfillEmbeddings = onCall(
  {
    secrets: [ANTHROPIC_API_KEY, VERTEX_LOCATION],
    region: "asia-northeast3",
    timeoutSeconds: 540,
    memory: "512MiB",
  },
  async (req) => {
    const email = req.auth?.token.email;
    if (!email || !ADMIN_EMAILS.includes(email)) {
      throw new HttpsError("permission-denied", "Admin only.");
    }
    const dryRun = (req.data as { dryRun?: boolean })?.dryRun ?? false;

    const snap = await db.collection("qa-records").get();
    let scanned = 0, embedded = 0, skipped = 0, failed = 0;

    for (const doc of snap.docs) {
      scanned++;
      const data = doc.data();
      if (Array.isArray(data.embedding) && data.embedding.length === 768) {
        skipped++;
        continue;
      }
      // Read the answer body. We snapshotted it at approval as `answerSnapshot`
      // (≤5K chars) — that's what we use here.
      const answer = (data.answerSnapshot as string) ?? "";
      if (!answer) {
        failed++;
        console.warn(`backfill: ${doc.id} has no answerSnapshot, skipping`);
        continue;
      }
      const text = composeForEmbedding({
        question: data.questionText as string,
        answer,
        tags: [],
      });
      if (dryRun) {
        embedded++;
        continue;
      }
      try {
        const embedding = await embed(text);
        await doc.ref.update({
          embedding,
          embeddingModel: "text-embedding-005",
        });
        embedded++;
      } catch (e) {
        failed++;
        console.error(`backfill: ${doc.id} embed failed`, e);
      }
    }
    return { scanned, embedded, skipped, failed, dryRun };
  },
);
```

- [ ] **Step 2: Wire export**

```ts
export { backfillEmbeddings } from "./maintenance/backfillEmbeddings";
```

- [ ] **Step 3: Build + deploy**

```bash
cd functions && npm run build && cd ..
npx firebase deploy --only functions:backfillEmbeddings
```

- [ ] **Step 4: Run dry-run from a privileged shell**

Use the Firebase Functions emulator OR call directly via `firebase functions:shell`:
```bash
npx firebase functions:shell
> backfillEmbeddings({ dryRun: true })
```
Expected: counts scanned/embedded as if real, skipped=existing, failed=0.

Then:
```
> backfillEmbeddings({})
```

- [ ] **Step 5: Commit**

```bash
git add functions/src/maintenance/backfillEmbeddings.ts functions/src/index.ts
git commit -m "functions: backfillEmbeddings (admin-only, idempotent, dry-run support)"
```

---

### Task 9: Verify end-to-end + retire token search

**Files:**
- Modify: `functions/src/review/approveAndCommit.ts` (potentially: drop `tokens` write if vector path is now primary)

- [ ] **Step 1: Manual verification**

After backfill completes, run the Phase 1 manual checklist (steps 11–12) using semantic queries instead of exact-token matches:

- /search → type "rollout end date" (NOT exact tokens from qa-001) → should still return qa-001 if it answered something rollout-related.
- /ask → start typing "How long does the experiment last?" → should suggest qa-001 if it's about experiment duration.

If hits return correctly, embedding search is working.

- [ ] **Step 2: Decision — retire `tokens` field?**

The `tokens` field is now used only by `keywordFallback` in `list_related_qa`. Two options:

A. **Keep it** as a fallback. ~30 bytes per qa-record; cheap insurance against Vertex AI outages.
B. **Drop it.** Simplifies the data model. Removes the `qa-records.tokens (array_contains)` index — saves a small amount on Firestore index storage.

Recommend **A** for Phase 2; revisit in Phase 3 if Vertex AI proves rock-solid.

If A: no further changes.
If B: remove the `tokens` field from `approveAndCommit`'s qa-records write, drop the array-contains index from `firestore.indexes.json`, drop `keywordFallback`. Document the change.

- [ ] **Step 3: Update the runbook**

Add to `zzem-knowledge-base/docs/runbooks/qa-wiki-deploy.md` a new "Phase 2 — Embedding similarity" section documenting:
- The new `VERTEX_LOCATION` secret
- The vector index in `firestore.indexes.json`
- The `backfillEmbeddings` admin-only function and how to invoke it
- The new query semantics (what users see in /search)

- [ ] **Step 4: Final commit**

If anything changed in this task:
```bash
git add docs/runbooks/qa-wiki-deploy.md
git commit -m "docs: phase 2 embedding-similarity addendum to deploy runbook"
```

---

## Self-review notes

- **Spec coverage:** §5 Phase 2 ("embedding-based similarity (Vertex AI embeddings + Firestore vector search) for duplicate detection at submit time") ✓; §4 tools list_related_qa upgrade ✓. Cache observability remains unchanged from Plan 3.
- **Dependency on Phase 1:** This plan REQUIRES Phase 1 to be deployed and have at least 1 approved Q&A. Don't start before that — there's nothing to embed.
- **Vertex AI region:** Defaulting to `asia-northeast3` matches the Cloud Functions region. If team is on `us-central1` for cost reasons, the secret value flexes — no code change needed.
- **Embedding non-blocking on approval:** if `embed()` fails, `approveAndCommit` proceeds anyway with `embedding: null`. The `backfillEmbeddings` function fills in later. This means search recall degrades gracefully under Vertex AI outage, not catastrophically.
- **Cost:** `text-embedding-005` is $0.000025 per 1K input tokens (May 2026 pricing). A typical Q&A is ~500 tokens → $0.0000125 per embedding. Backfilling 100 records = $0.001. Per-query embedding (~20 tokens) = $0.0000005. Negligible.
- **Cache implications:** The agentic loop's prompt cache (Plan 3) is unaffected. `list_related_qa` results are tool outputs — they sit in the per-question fresh region of the prompt anyway.
- **Followups (NOT in this plan):**
  - Background embedding refresh when answer body is edited via PR (rare; out of scope)
  - Hybrid search (BM25 + vector) for higher precision on technical jargon
  - Per-user feedback loop ("this suggestion was good/bad" → re-rank)
