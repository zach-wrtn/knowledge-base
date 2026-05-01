# Team Chat — Plan 1: Foundation Cleanup + New Data Model Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Clean the `zzem-wiki` repo of all approval-pipeline / qa-records / question-and-draft scaffolding. Establish the new conversation/message data model. End in a state where `npm run dev` boots cleanly and the user is dropped onto a "no conversations yet" empty state. No AI integration here.

**Architecture:** Salvage Plan 2's foundation (Next.js + Firebase + auth + shadcn). Replace `src/types/qa.ts` with `src/types/conversation.ts`. Remove all `/queue`, `/q/[qid]`, `/ask`, `/my` (in current shape), `/search` (current shape) routes. Add stub routes `/c/[cid]`, `/me`, `/feed`, `/search` (empty placeholders for later plans). Replace Firestore rules + indexes for new data model. Remove all approval-pipeline Cloud Functions; keep `mirrorUserProfile` and the lib infra.

**Tech Stack:** Same as before (Next.js 15, Firebase, Tailwind v4, shadcn). No new dependencies.

**Spec:** `zzem-knowledge-base/docs/superpowers/specs/2026-05-01-team-chat-design.md` §1 (architecture), §2 (data model), §10 (salvage decisions).

**Prerequisites:**
- spec PR #17 merged (or this work happens on a branch that doesn't conflict)
- zzem-wiki PR #1 (foundation) merged to `main` of zzem-wiki — this gives us the scaffold to clean up
- knowledge-base PR #18 merged (qa schema removed) — not strictly required for app code but keeps KB clean

**Repo context:** All paths relative to `zzem-wiki/` unless prefixed `zzem-knowledge-base/`.

---

## File Structure

**Delete:**
- `src/types/qa.ts`
- `src/lib/firebase/db.ts`
- `src/lib/firebase/owners.ts` (qa-owners loader — no longer used)
- `src/components/qa/` (entire directory)
- `src/app/ask/page.tsx` (form-based ask)
- `src/app/q/[qid]/page.tsx`
- `src/app/queue/page.tsx`
- `src/app/my/page.tsx` (will be re-added in Plan 2 with different shape)
- `src/app/search/page.tsx` (placeholder will be added; real impl in Plan 4)
- `src/lib/firebase/callables.ts` (callables to deleted functions)
- `functions/src/draft/` (entire directory)
- `functions/src/review/` (entire directory)
- `functions/src/lib/qa-validate.ts`
- `functions/src/lib/qa-commit.ts`
- `functions/src/lib/slack.ts`
- `functions/src/lib/search-tokens.ts`
- `functions/src/lib/draft-output.ts`
- `functions/src/lib/owners.ts`
- `functions/src/schemas/` (entire directory — vendored qa schema)
- `functions/src/lib/__tests__/` (qa-related test files; we'll re-add provider tests later)
- `tests/e2e/ask.spec.ts` (relied on the form-based ask flow)
- `firestore.rules` qa/qa-records rules (rewrite from scratch)
- `firestore.indexes.json` qa-related indexes (rewrite from scratch)

**Create:**
- `src/types/conversation.ts`
- `src/lib/firebase/chat.ts` (basic helpers — full impl in Plan 2)
- `src/app/c/[cid]/page.tsx` (placeholder; full UI in Plan 2)
- `src/app/me/page.tsx` (placeholder)
- `src/app/feed/page.tsx` (placeholder)
- `src/app/search/page.tsx` (placeholder)
- `firestore.indexes.json` (new content)

**Modify:**
- `src/app/layout.tsx` (drop Toaster import if it goes; sonner is still useful — keep)
- `src/app/page.tsx` (rewrite home; minimal "new chat" + empty list)
- `firestore.rules` (rewrite for conversation model)
- `scripts/seed-emulator.mjs` (rewrite for new model — only users for now; conversation seed in Plan 2)
- `README.md` (update Phase 1 description)
- `functions/src/index.ts` (drop deleted exports; only `mirrorUserProfile` remains)
- `functions/src/lib/tools.ts` — keep but rename `list_related_qa` → `list_related_shared_conversations`. Implementation can be a stub returning `[]` until Plan 4. (Schemas of the other 3 tools are unchanged.)

---

### Task 1: Branch off and remove qa-related app code

**Files:**
- Delete: `src/types/qa.ts`, `src/lib/firebase/db.ts`, `src/lib/firebase/owners.ts`, `src/lib/firebase/callables.ts`, `src/components/qa/`, `src/app/{ask,q,queue,my,search}/`, `tests/e2e/ask.spec.ts`

- [ ] **Step 1: Create branch from current zzem-wiki main**

```bash
cd ~/dev/work/zzem-wiki
git checkout main && git pull
git checkout -b plan/team-chat-1-foundation-cleanup
```

- [ ] **Step 2: Delete app-side qa files**

```bash
rm src/types/qa.ts
rm src/lib/firebase/db.ts src/lib/firebase/owners.ts src/lib/firebase/callables.ts
rm -rf src/components/qa
rm -rf src/app/ask src/app/q src/app/queue src/app/my src/app/search
rm tests/e2e/ask.spec.ts
git status --short
```

Expected: ~30 deletions across `src/` and `tests/`.

- [ ] **Step 3: Verify build now fails (sanity check that types weren't dangling)**

```bash
npm run build 2>&1 | tail -20
```

Expected: build fails because `src/app/page.tsx`, `src/app/q/[qid]/page.tsx` import deleted modules. We fix in Tasks 3-5.

- [ ] **Step 4: Commit (intentionally broken state — checkpoint)**

```bash
git add -A
git commit -m "chore: remove qa-related app code (broken build, fixed in subsequent tasks)"
```

This commit is intentionally broken-build to keep the diff narrow. Subsequent tasks restore.

---

### Task 2: Remove approval-pipeline Cloud Functions

**Files:**
- Delete: `functions/src/draft/`, `functions/src/review/`, `functions/src/lib/{qa-validate,qa-commit,slack,search-tokens,draft-output,owners}.ts`, `functions/src/schemas/`, `functions/src/lib/__tests__/{qa-validate,qa-commit,owners,search-tokens,draft-output,kb-index,tools}.test.ts`
- Modify: `functions/src/index.ts`

- [ ] **Step 1: Delete function files**

```bash
cd ~/dev/work/zzem-wiki/functions
rm -rf src/draft src/review src/schemas
rm src/lib/{qa-validate,qa-commit,slack,search-tokens,draft-output,owners}.ts
rm src/lib/__tests__/{qa-validate,qa-commit,owners,search-tokens,draft-output}.test.ts
# kb-index, tools tests stay — those test surviving lib code
ls src/lib  # verify what remains
```

Expected remaining files: `anthropic.ts`, `kb-index.ts`, `octokit.ts`, `rate-limit.ts`, `secrets.ts`, `tools.ts`, `__tests__/{kb-index,tools}.test.ts`

- [ ] **Step 2: Strip vendored schema reference from secrets.ts**

If `secrets.ts` still imports anything from the deleted schemas dir, fix. Currently it shouldn't.

`functions/src/lib/secrets.ts` — verify with `cat`. Should only contain `defineSecret` calls. The `SLACK_WEBHOOK_URL` line: keep it for now (Plan 5 reuses).

- [ ] **Step 3: Rename `list_related_qa` → `list_related_shared_conversations` in tools.ts**

In `functions/src/lib/tools.ts`:

Replace the entire `list_related_qa` tool definition + dispatcher case with:

```ts
{
  name: "list_related_shared_conversations",
  description: "Find recently shared team conversations by scope + keyword overlap. Returns up to 5, sorted by recency.",
  input_schema: {
    type: "object",
    properties: {
      scope:    { type: "string", enum: ["global", "ai-webtoon", "free-tab", "ugc-platform"] },
      keywords: { type: "array",  items: { type: "string" } },
    },
    required: ["scope", "keywords"],
  },
},
```

And the dispatcher:

```ts
case "list_related_shared_conversations": return list_related_shared_conversations(input);
```

For now, the implementation is a stub:

```ts
async function list_related_shared_conversations(_i: Record<string, unknown>): Promise<unknown[]> {
  // Plan 4 wires this to the Vertex AI vector search over shared-conversations.
  return [];
}
```

Delete the old `list_related_qa` function body. Update the corresponding test (`tools.test.ts`) to use the new name and assert empty array.

- [ ] **Step 4: Update functions index.ts**

`functions/src/index.ts`:

```ts
export { mirrorUserProfile } from "./auth/mirrorUserProfile";
// generateDraft, requestReview, approveAndCommit, rejectDraft come back in Plans 2/4/5
```

- [ ] **Step 5: Build + test**

```bash
cd ~/dev/work/zzem-wiki/functions
rm -rf lib/  # clean stale build output
npm run build
npm test
```

Expected: build PASS; tests run only kb-index + tools (~9 tests pass).

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "functions: remove approval pipeline (generateDraft/review/qa-validate/qa-commit/slack/search-tokens/draft-output/owners + vendored schemas)"
```

---

### Task 3: Add new conversation types

**Files:**
- Create: `src/types/conversation.ts`

- [ ] **Step 1: Write the types file**

`src/types/conversation.ts`:

```ts
import type { Timestamp } from "firebase/firestore";

export type Scope = "global" | "ai-webtoon" | "free-tab" | "ugc-platform";

export type ConversationStatus =
  | "active"
  | "escalated"
  | "ended"
  | "shared";

export type AIProviderName = "mock" | "anthropic" | "wrtn";

export interface ConversationDoc {
  ownerUid: string;
  title: string;
  status: ConversationStatus;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  messageCount: number;
  scope?: Scope;
  shared: boolean;
  sharedConvId?: string;
  escalationId?: string;
  ai: {
    provider: AIProviderName;
    model: string;
    totalTokens: { input: number; output: number; cacheRead: number };
  };
}

export type MessageRole = "user" | "assistant" | "system" | "human";

export type AISourceType = "kb_pattern" | "kb_prd" | "kb_event" | "kb_reflection" | "kb_rubric" | "shared_conversation";

export interface AISource {
  type: AISourceType;
  id: string;
  why?: string;
}

export interface MessageDoc {
  role: MessageRole;
  content: string;
  createdAt: Timestamp;
  authorUid: string;
  authorEmail?: string;
  ai?: {
    sourcesUsed: AISource[];
    tokenUsage: { input: number; output: number; cacheRead: number };
    toolCalls: number;
    finishReason: "end_turn" | "tool_use_max" | "max_tokens" | "error";
  };
}

export interface SharedConversationDoc {
  fromCid: string;
  ownerUid: string;
  ownerEmail: string;
  title: string;
  summary: string;
  body: string;
  scope?: Scope;
  tags: string[];
  embedding: number[];
  embeddingModel: string;
  tokens: string[];
  sharedAt: Timestamp;
  voteCount: number;
  lastVerifiedAt: Timestamp;
}

export interface EscalationDoc {
  cid: string;
  fromUid: string;
  fromEmail: string;
  toUid: string;
  toEmail: string;
  notification: { sentAt: Timestamp; channel?: string; ts?: string };
  status: "pending" | "acknowledged" | "responded" | "resolved";
  createdAt: Timestamp;
  respondedAt?: Timestamp;
}

export interface UserDoc {
  email: string;
  displayName: string;
  avatarUrl?: string | null;
  createdAt: Timestamp;
}

export interface NotificationDoc {
  toUid: string | "broadcast";
  type: "share_broadcast" | "escalation" | "escalation_response";
  payload: Record<string, unknown>;
  sentAt?: Timestamp;
  readAt?: Timestamp;
  failedAt?: Timestamp;
}

export const SCOPES: Scope[] = ["global", "ai-webtoon", "free-tab", "ugc-platform"];
```

- [ ] **Step 2: Build to confirm types compile**

```bash
cd ~/dev/work/zzem-wiki
# Build will still fail because pages reference deleted modules; just check types module compiles.
npx tsc --noEmit src/types/conversation.ts 2>&1 | tail -5
```

Expected: no errors specific to `conversation.ts`.

- [ ] **Step 3: Commit**

```bash
git add src/types/conversation.ts
git commit -m "types: conversation/message/shared/escalation data model"
```

---

### Task 4: Minimal home page + chat helpers (placeholder)

**Files:**
- Create: `src/lib/firebase/chat.ts`
- Replace: `src/app/page.tsx`

- [ ] **Step 1: Write minimal chat helpers**

`src/lib/firebase/chat.ts`:

```ts
"use client";
import {
  addDoc, collection, doc, serverTimestamp,
  query, where, orderBy, limit, getDocs,
} from "firebase/firestore";
import { getFirebase } from "./client";
import type { ConversationDoc } from "@/types/conversation";

export async function createConversation(input: {
  ownerUid: string;
  scope?: ConversationDoc["scope"];
}): Promise<string> {
  const { db } = getFirebase();
  const ref = await addDoc(collection(db, "conversations"), {
    ownerUid: input.ownerUid,
    title: "(new conversation)",  // updated by streamMessage when first user msg arrives
    status: "active",
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    messageCount: 0,
    ...(input.scope ? { scope: input.scope } : {}),
    shared: false,
    ai: {
      provider: "mock",  // placeholder; updated when streamMessage runs
      model: "unknown",
      totalTokens: { input: 0, output: 0, cacheRead: 0 },
    },
  });
  return ref.id;
}

export async function listMyConversations(uid: string) {
  const { db } = getFirebase();
  const q = query(
    collection(db, "conversations"),
    where("ownerUid", "==", uid),
    orderBy("updatedAt", "desc"),
    limit(50),
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as ConversationDoc) }));
}

export function conversationRef(cid: string) {
  const { db } = getFirebase();
  return doc(db, "conversations", cid);
}
```

- [ ] **Step 2: Replace home page**

`src/app/page.tsx`:

```tsx
"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/firebase/auth-provider";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { createConversation, listMyConversations } from "@/lib/firebase/chat";
import type { ConversationDoc } from "@/types/conversation";

export default function Home() {
  const { user, loading, signOutNow } = useAuth();
  const router = useRouter();
  const [recent, setRecent] = useState<(ConversationDoc & { id: string })[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [loading, user, router]);

  useEffect(() => {
    if (!user) return;
    listMyConversations(user.uid).then((rows) => setRecent(rows.slice(0, 5)));
  }, [user]);

  async function startNew() {
    if (!user) return;
    setBusy(true);
    try {
      const cid = await createConversation({ ownerUid: user.uid });
      router.push(`/c/${cid}`);
    } finally {
      setBusy(false);
    }
  }

  if (loading || !user) return null;

  return (
    <main className="mx-auto max-w-3xl space-y-6 p-6">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">zzem chat</h1>
        <div className="flex items-center gap-3 text-sm">
          <span className="text-muted-foreground">{user.email}</span>
          <Button variant="ghost" onClick={signOutNow}>Sign out</Button>
        </div>
      </header>

      <Button onClick={startNew} disabled={busy} size="lg" className="w-full">
        {busy ? "Starting..." : "+ New chat"}
      </Button>

      <section className="grid grid-cols-3 gap-3 text-sm">
        <Link href="/me" className="rounded border p-4 hover:bg-accent">
          <div className="font-medium">My chats</div>
          <div className="text-muted-foreground">{recent.length} recent</div>
        </Link>
        <Link href="/feed" className="rounded border p-4 hover:bg-accent">
          <div className="font-medium">Team feed</div>
          <div className="text-muted-foreground">Shared by team</div>
        </Link>
        <Link href="/search" className="rounded border p-4 hover:bg-accent">
          <div className="font-medium">Search</div>
          <div className="text-muted-foreground">Find past answers</div>
        </Link>
      </section>

      {recent.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-medium text-muted-foreground">Recent</h2>
          {recent.map((c) => (
            <Link key={c.id} href={`/c/${c.id}`}>
              <Card className="hover:bg-accent">
                <CardContent className="py-3 text-sm">
                  <div className="font-medium">{c.title}</div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    status: <span className="font-mono">{c.status}</span> · {c.messageCount} messages
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </section>
      )}
    </main>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/firebase/chat.ts src/app/page.tsx
git commit -m "ui: home page with new chat / chat list (multi-page placeholders to follow)"
```

---

### Task 5: Stub pages for /c/[cid], /me, /feed, /search

**Files:**
- Create: `src/app/c/[cid]/page.tsx`, `src/app/me/page.tsx`, `src/app/feed/page.tsx`, `src/app/search/page.tsx`

These are placeholders. Plan 2 fills in `/c/[cid]` and `/me`. Plan 4 fills in `/feed` and `/search`.

- [ ] **Step 1: `/c/[cid]/page.tsx` placeholder**

```tsx
"use client";
import { use } from "react";

export default function ConversationPage({ params }: { params: Promise<{ cid: string }> }) {
  const { cid } = use(params);
  return (
    <main className="mx-auto max-w-3xl p-6">
      <h1 className="text-xl font-semibold">Conversation {cid}</h1>
      <p className="mt-4 text-sm text-muted-foreground">
        Chat UI lands in Plan 2. This page currently just confirms routing.
      </p>
    </main>
  );
}
```

- [ ] **Step 2: `/me/page.tsx` placeholder**

```tsx
"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/firebase/auth-provider";
import { listMyConversations } from "@/lib/firebase/chat";
import { Card, CardContent } from "@/components/ui/card";
import type { ConversationDoc } from "@/types/conversation";

export default function MePage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [items, setItems] = useState<(ConversationDoc & { id: string })[]>([]);

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [loading, user, router]);

  useEffect(() => {
    if (!user) return;
    listMyConversations(user.uid).then(setItems);
  }, [user]);

  if (loading || !user) return null;

  return (
    <main className="mx-auto max-w-3xl space-y-3 p-6">
      <h1 className="text-2xl font-semibold">My chats</h1>
      {items.length === 0 && <p className="text-sm text-muted-foreground">No chats yet. Start one from the home page.</p>}
      {items.map((c) => (
        <Link key={c.id} href={`/c/${c.id}`}>
          <Card className="hover:bg-accent">
            <CardContent className="py-3 text-sm">
              <div className="font-medium">{c.title}</div>
              <div className="mt-1 text-xs text-muted-foreground">
                status: <span className="font-mono">{c.status}</span> · {c.messageCount} messages
              </div>
            </CardContent>
          </Card>
        </Link>
      ))}
    </main>
  );
}
```

- [ ] **Step 3: `/feed/page.tsx` placeholder**

```tsx
"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/firebase/auth-provider";

export default function FeedPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  useEffect(() => { if (!loading && !user) router.replace("/login"); }, [loading, user, router]);
  if (loading || !user) return null;
  return (
    <main className="mx-auto max-w-3xl p-6">
      <h1 className="text-2xl font-semibold">Team feed</h1>
      <p className="mt-4 text-sm text-muted-foreground">
        Shared conversations land here. Wired up in Plan 4.
      </p>
    </main>
  );
}
```

- [ ] **Step 4: `/search/page.tsx` placeholder**

```tsx
"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/firebase/auth-provider";

export default function SearchPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  useEffect(() => { if (!loading && !user) router.replace("/login"); }, [loading, user, router]);
  if (loading || !user) return null;
  return (
    <main className="mx-auto max-w-3xl p-6">
      <h1 className="text-2xl font-semibold">Search</h1>
      <p className="mt-4 text-sm text-muted-foreground">
        Embedding-backed search lands in Plan 4.
      </p>
    </main>
  );
}
```

- [ ] **Step 5: Build + commit**

```bash
cd ~/dev/work/zzem-wiki
npm run build
```

Expected: build PASS now (all imports resolve).

```bash
git add src/app
git commit -m "ui: placeholder routes for /c/[cid], /me, /feed, /search (filled in by later plans)"
```

---

### Task 6: Rewrite Firestore rules + indexes for new model

**Files:**
- Modify: `firestore.rules`
- Modify: `firestore.indexes.json`

- [ ] **Step 1: Replace firestore.rules entirely**

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    function isWrtn() {
      return request.auth != null
        && request.auth.token.email_verified == true
        && request.auth.token.email.matches(".*@wrtn[.]io$");
    }
    function isOwner(uid) { return isWrtn() && request.auth.uid == uid; }

    match /users/{uid} {
      allow read:  if isWrtn();
      allow write: if false;  // mirrorUserProfile (auth trigger) only
    }

    match /conversations/{cid} {
      allow read: if isOwner(resource.data.ownerUid)
                   || resource.data.shared == true
                   || exists(/databases/$(database)/documents/escalations/$(cid + '-active')); // simplified check; refined in Plan 5

      allow create: if isWrtn()
                     && request.resource.data.ownerUid == request.auth.uid
                     && request.resource.data.status == 'active';

      allow update: if isOwner(resource.data.ownerUid)
                     && request.resource.data.ownerUid == resource.data.ownerUid;

      allow delete: if isOwner(resource.data.ownerUid);

      match /messages/{mid} {
        allow read: if isOwner(get(/databases/$(database)/documents/conversations/$(cid)).data.ownerUid)
                     || get(/databases/$(database)/documents/conversations/$(cid)).data.shared == true;
        allow create: if (isOwner(get(/databases/$(database)/documents/conversations/$(cid)).data.ownerUid)
                          && request.resource.data.role == 'user'
                          && request.resource.data.authorUid == request.auth.uid);
                      // role='assistant' written by Cloud Function (admin SDK bypass)
                      // role='human' added in Plan 5 with escalation grants
        allow update, delete: if false;
      }
    }

    match /shared-conversations/{sid} {
      allow read: if isWrtn();
      allow write: if false;  // shareConversation (Plan 4) only
    }

    match /escalations/{eid} {
      allow read: if false;   // refined in Plan 5
      allow write: if false;  // escalateToHuman (Plan 5) only
    }

    match /notifications/{nid} {
      allow read: if isWrtn();
      allow write: if false;
    }

    match /rate-limits/{uid} {
      allow read, write: if false;
    }
  }
}
```

- [ ] **Step 2: Replace firestore.indexes.json**

```json
{
  "indexes": [
    {
      "collectionGroup": "conversations",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "ownerUid", "order": "ASCENDING" },
        { "fieldPath": "updatedAt", "order": "DESCENDING" }
      ]
    },
    {
      "collectionGroup": "conversations",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "shared", "order": "ASCENDING" },
        { "fieldPath": "updatedAt", "order": "DESCENDING" }
      ]
    }
  ],
  "fieldOverrides": []
}
```

(Plans 4 and 5 add the shared-conversations vector index and escalation indexes.)

- [ ] **Step 3: Commit**

```bash
git add firestore.rules firestore.indexes.json
git commit -m "rules+indexes: rewrite for conversation/message/shared model"
```

---

### Task 7: Update emulator seed for new model

**Files:**
- Modify: `scripts/seed-emulator.mjs`

- [ ] **Step 1: Replace seed content**

```js
#!/usr/bin/env node
/**
 * Seed the local Firebase Emulator Suite with demo data for the chat redesign.
 * Run after `npm run emulator` is up.
 */
import admin from "firebase-admin";

const PROJECT_ID = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "demo-zzem-wiki";

process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || "localhost:8181";
process.env.FIREBASE_AUTH_EMULATOR_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST || "localhost:9099";

admin.initializeApp({ projectId: PROJECT_ID });
const auth = admin.auth();
const db = admin.firestore();

const USERS = [
  { uid: "u-zach",  email: "zach@wrtn.io",  displayName: "Zach (admin)" },
  { uid: "u-alice", email: "alice@wrtn.io", displayName: "Alice" },
  { uid: "u-bob",   email: "bob@wrtn.io",   displayName: "Bob" },
];

async function clear() {
  const list = await auth.listUsers();
  if (list.users.length) await auth.deleteUsers(list.users.map((u) => u.uid));

  for (const col of ["conversations", "shared-conversations", "users", "notifications", "rate-limits", "escalations"]) {
    const snap = await db.collection(col).get();
    const batch = db.batch();
    snap.docs.forEach((d) => batch.delete(d.ref));
    if (snap.size) await batch.commit();
    if (col === "conversations") {
      for (const d of snap.docs) {
        const sub = await d.ref.collection("messages").get();
        const sb = db.batch();
        sub.docs.forEach((sd) => sb.delete(sd.ref));
        if (sub.size) await sb.commit();
      }
    }
  }
}

async function seed() {
  console.log("clearing existing data...");
  await clear();

  console.log("creating users...");
  for (const u of USERS) {
    await auth.createUser({
      uid: u.uid, email: u.email, emailVerified: true, displayName: u.displayName,
    });
    await db.doc(`users/${u.uid}`).set({
      email: u.email,
      displayName: u.displayName,
      avatarUrl: null,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  }

  // Plan 1 deliberately seeds NO conversations — Plan 2 seeds them once chat works.
  // This makes Plan 1 verifiable by an empty-state UI.

  console.log("\n✅ seed complete (users only — chats added in Plan 2's seed)");
  console.log("Sign in as any of:");
  for (const u of USERS) console.log(`  ${u.email}`);
}

seed().catch((e) => { console.error("seed failed:", e); process.exit(1); });
```

- [ ] **Step 2: Run seed against the emulator**

```bash
# Terminal 1
npm run emulator

# Terminal 2
npm run seed
```

Expected: "✅ seed complete (users only — chats added in Plan 2's seed)" and 3 users listed.

- [ ] **Step 3: Commit**

```bash
git add scripts/seed-emulator.mjs
git commit -m "seed: rewrite for conversation model (users only, chats deferred to plan 2)"
```

---

### Task 8: Update README

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Rewrite description sections**

Replace the top-of-README description with:

```markdown
# zzem-wiki

(Repo name kept for stability; functionally this is now a real-time team chat.)

Internal team chat: ask questions while working, get AI-grounded answers
streaming back, optionally escalate to a human or share the answer to the
team. Spec: `zzem-knowledge-base/docs/superpowers/specs/2026-05-01-team-chat-design.md`.

## Stack

- Next.js 15 (App Router) + Tailwind v4 + shadcn/ui
- Firebase Auth (Google SSO, `@wrtn.io` only)
- Firestore (live state) + Cloud Functions (server-side, streaming SSE)
- AI provider abstraction: Mock (local-first) + Anthropic (dev) + Wrtn internal (production)
- Vertex AI for embedding-backed search (Plan 4)

## Local dev

### Option 1 — UI only (no Firebase, ~30s)

```bash
npm install
npm run dev
```

Pages render but `Sign in with Google` shows "Firebase is not configured".

### Option 2 — Firebase Emulator with seeded users (~3 min, no real Firebase project)

```bash
cp .env.local.example .env.local      # ensure NEXT_PUBLIC_USE_FIREBASE_EMULATOR=1
npm run emulator                       # terminal 1
npm run seed                           # terminal 2
npm run dev                            # terminal 3
```

Sign in as zach@wrtn.io / alice@wrtn.io / bob@wrtn.io via the emulator UI.

### Option 3 — Full stack (real Firebase + AI provider)

See `zzem-knowledge-base/docs/runbooks/team-chat-deploy.md` (forthcoming).

## Tests

```bash
npx playwright test tests/e2e/login.spec.ts
cd functions && npm test
```

## Spec & plans

- Spec: `zzem-knowledge-base/docs/superpowers/specs/2026-05-01-team-chat-design.md`
- Plans: `zzem-knowledge-base/docs/superpowers/plans/2026-05-01-team-chat-{1..5}-*.md`
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: README reflects chat redesign"
```

---

### Task 9: LOCAL CHECKPOINT — verify clean state

After this task the user can run the app locally end-to-end.

- [ ] **Step 1: Build everything**

```bash
cd ~/dev/work/zzem-wiki
npm run build
cd functions && npm run build && cd ..
```

Both expected PASS.

- [ ] **Step 2: Run unauth E2E**

```bash
npx playwright test tests/e2e/login.spec.ts
```

Expected: 2/2 PASS.

- [ ] **Step 3: Boot emulator + seed + dev (3 terminals)**

```bash
# Terminal 1
npm run emulator

# Terminal 2 (after emulator ready)
npm run seed

# Terminal 3
npm run dev
```

- [ ] **Step 4: Manual verification**

Open http://localhost:3000 (or 3001 if busy):

1. Should redirect to `/login`.
2. Click "Sign in with Google" → emulator popup → pick `zach@wrtn.io`.
3. Should land on `/` showing:
   - "+ New chat" button
   - 3 tile links: My chats / Team feed / Search
   - No "Recent" section (no conversations yet)
4. Click "+ New chat" → should redirect to `/c/{some-id}` showing the placeholder text.
5. Open Firestore Emulator UI (http://localhost:4000/firestore) → confirm `conversations/{cid}` doc exists with `status: 'active'`, `messageCount: 0`, `ownerUid: u-zach`.
6. Visit `/me` → should show that one conversation in the list.
7. Visit `/feed`, `/search` → placeholder text.
8. Sign out and sign in as alice → `/me` is empty.

- [ ] **Step 5: Push branch + create PR**

```bash
git push -u origin plan/team-chat-1-foundation-cleanup
gh pr create --title "feat: foundation cleanup + new chat data model (Plan 1)" --body "Plan 1 of team chat redesign. Removes approval pipeline / qa-records / questions / drafts. Adds conversation/message types, minimal home + placeholder routes, new Firestore rules/indexes, updated seed. Local checkpoint passes (build + unauth E2E + manual emulator verification)."
```

---

## Self-review notes

- **Spec coverage:** §10 Salvage / Scrap (entirely covered — every removal item listed); §1 architecture (boundaries set); §2 data model types module written; §8 auth rules rewritten. AI integration / streaming / share / search / escalation are correctly DEFERRED to Plans 2-5.
- **Local checkpoint validates:** auth flow with emulator, conversation create + Firestore write, list query with composite index, page routing, sign-out / sign-in as different user.
- **Intentionally broken commit in Task 1:** the broken-build commit is deliberate — it isolates the deletion diff. Subsequent tasks restore the build. If the engineer is doing strictly-bisectable history, they can squash these together at PR merge time.
- **Sonner is kept:** the `Toaster` component in layout stays. Plan 2/4/5 use it for toast notifications.
- **`list_related_shared_conversations` stub:** intentionally returns `[]` so `tools.ts` compiles and dispatcher case is wired. Plan 4 swaps in the Vertex AI implementation once `shared-conversations` exists.
