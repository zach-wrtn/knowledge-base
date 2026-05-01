# Team Chat — Plan 5: Escalation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the "ask a human" escalation. User clicks button in their conversation → picks recipient → Cloud Function records escalation, posts Slack notification with link, grants the recipient read access to the conversation. Recipient opens link, can read + add `role='human'` message in same thread. Either side can mark resolved.

**Architecture:** `escalateToHuman` HTTPS callable creates an `escalations/{eid}` doc and posts Slack via incoming webhook. Firestore rules grant read on the conversation when an active escalation exists for the requester. Recipient writes `role='human'` messages directly via security-rule grant. Resolution is a status update.

**Tech Stack:** Slack incoming webhook (no SDK; raw `fetch`). No new external deps.

**Spec:** `docs/superpowers/specs/2026-05-01-team-chat-design.md` §3 (lifecycle escalation transitions), §5 (escalation details).

**Prerequisites:** Plans 1, 2, 3 merged (Plan 4 not strictly required — escalation is independent of share/feed).

---

## File Structure

**Create:**
- `functions/src/escalation/escalateToHuman.ts` — HTTPS callable
- `functions/src/escalation/resolveEscalation.ts` — HTTPS callable
- `functions/src/lib/slack-notify.ts` — webhook helper (escalation-specific)
- `src/lib/firebase/escalation-callables.ts` — typed wrappers
- `src/components/chat/escalate-button.tsx`
- `src/components/chat/recipient-picker.tsx`

**Modify:**
- `src/app/c/[cid]/page.tsx` — wire escalation buttons + recipient detection
- `firestore.rules` — escalation read/write rules
- `firestore.indexes.json` — escalation queries
- `functions/src/lib/secrets.ts` — re-confirm `SLACK_WEBHOOK_URL` (added in Plan 1)
- `functions/src/index.ts` — exports

---

### Task 1: Escalation data model + rules

**Files:**
- Modify: `firestore.rules`
- Modify: `firestore.indexes.json`

- [ ] **Step 1: Branch off**

```bash
cd ~/dev/work/zzem-wiki
git checkout main && git pull
git checkout -b plan/team-chat-5-escalation
```

- [ ] **Step 2: Update Firestore rules**

In `firestore.rules`, replace the placeholder `match /escalations/{eid}` block and tighten the conversation read rule:

```
match /escalations/{eid} {
  allow read: if isWrtn() && (
    resource.data.fromUid == request.auth.uid ||
    resource.data.toUid == request.auth.uid
  );
  allow write: if false;  // Cloud Functions only
}
```

And update the conversation read rule. Currently it has the placeholder check `exists(/databases/$(database)/documents/escalations/$(cid + '-active'))`. Replace with a robust check using a query. **However**, Firestore rules don't support `where` queries — instead, escalation grants come via storing the `toUid` ON the conversation when an escalation is active. Simpler approach: the conversation document gets an `activeEscalationToUid` field when there's a pending/responded escalation, cleared when resolved.

Update `match /conversations/{cid} { allow read: ... }`:

```
allow read: if isWrtn() && (
  resource.data.ownerUid == request.auth.uid ||
  resource.data.shared == true ||
  resource.data.activeEscalationToUid == request.auth.uid
);
```

And the message read rule similarly:

```
match /conversations/{cid}/messages/{mid} {
  allow read: if isWrtn() && (
    get(/databases/$(database)/documents/conversations/$(cid)).data.ownerUid == request.auth.uid ||
    get(/databases/$(database)/documents/conversations/$(cid)).data.shared == true ||
    get(/databases/$(database)/documents/conversations/$(cid)).data.activeEscalationToUid == request.auth.uid
  );

  allow create: if isWrtn() && (
    // Owner posting role='user'
    (request.resource.data.role == 'user'
     && request.resource.data.authorUid == request.auth.uid
     && get(/databases/$(database)/documents/conversations/$(cid)).data.ownerUid == request.auth.uid)
    ||
    // Escalation recipient posting role='human'
    (request.resource.data.role == 'human'
     && request.resource.data.authorUid == request.auth.uid
     && get(/databases/$(database)/documents/conversations/$(cid)).data.activeEscalationToUid == request.auth.uid)
  );
  // role='assistant' written by Cloud Function (admin SDK).
  allow update, delete: if false;
}
```

- [ ] **Step 3: Add escalation indexes**

In `firestore.indexes.json`, append:

```json
,
{
  "collectionGroup": "escalations",
  "queryScope": "COLLECTION",
  "fields": [
    { "fieldPath": "toUid", "order": "ASCENDING" },
    { "fieldPath": "status", "order": "ASCENDING" },
    { "fieldPath": "createdAt", "order": "DESCENDING" }
  ]
},
{
  "collectionGroup": "escalations",
  "queryScope": "COLLECTION",
  "fields": [
    { "fieldPath": "fromUid", "order": "ASCENDING" },
    { "fieldPath": "createdAt", "order": "DESCENDING" }
  ]
}
```

- [ ] **Step 4: Commit**

```bash
git add firestore.rules firestore.indexes.json
git commit -m "rules+indexes: escalation reads/writes + conversation activeEscalationToUid grant"
```

---

### Task 2: Slack notify helper

**Files:**
- Create: `functions/src/lib/slack-notify.ts`

- [ ] **Step 1: Write helper**

```ts
import { SLACK_WEBHOOK_URL } from "./secrets";

export async function notifyEscalation(input: {
  cid: string;
  fromEmail: string;
  toEmail: string;
  conversationTitle: string;
  appBaseUrl: string;
}): Promise<{ ok: true } | { ok: false; reason: string }> {
  let url: string;
  try { url = SLACK_WEBHOOK_URL.value(); }
  catch { return { ok: false, reason: "SLACK_WEBHOOK_URL not configured" }; }

  const body = {
    text: `Help requested: ${input.conversationTitle}`,
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `:wave: *${input.fromEmail}* asked for help.\nReviewer: *${input.toEmail}*\n_Conversation:_ ${input.conversationTitle}`,
        },
      },
      {
        type: "actions",
        elements: [{
          type: "button",
          text: { type: "plain_text", text: "Open conversation" },
          url: `${input.appBaseUrl}/c/${input.cid}?from=escalation`,
        }],
      },
    ],
  };

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) return { ok: false, reason: `slack webhook ${res.status}: ${await res.text().catch(() => "")}` };
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: (e as Error).message };
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add functions/src/lib/slack-notify.ts
git commit -m "functions: slack notify helper for escalation (returns ok/reason — non-throwing)"
```

---

### Task 3: escalateToHuman Cloud Function

**Files:**
- Create: `functions/src/escalation/escalateToHuman.ts`
- Modify: `functions/src/index.ts`

- [ ] **Step 1: Write callable**

```ts
import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import { SLACK_WEBHOOK_URL } from "../lib/secrets";
import { notifyEscalation } from "../lib/slack-notify";

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

export const escalateToHuman = onCall(
  {
    region: "asia-northeast3",
    timeoutSeconds: 30,
    memory: "256MiB",
    secrets: [SLACK_WEBHOOK_URL],
  },
  async (req) => {
    const fromEmail = req.auth?.token.email;
    if (!fromEmail?.endsWith("@wrtn.io")) {
      throw new HttpsError("permission-denied", "@wrtn.io only");
    }
    const fromUid = req.auth!.uid;

    const data = req.data as { cid?: string; toUid?: string; toEmail?: string; note?: string };
    if (!data?.cid || !data?.toUid || !data?.toEmail) {
      throw new HttpsError("invalid-argument", "cid, toUid, toEmail required");
    }
    if (data.toUid === fromUid) {
      throw new HttpsError("invalid-argument", "cannot escalate to yourself");
    }

    const cref = db.doc(`conversations/${data.cid}`);
    const csnap = await cref.get();
    if (!csnap.exists) throw new HttpsError("not-found", "conversation not found");
    const conv = csnap.data()!;
    if (conv.ownerUid !== fromUid) throw new HttpsError("permission-denied", "not owner");
    if (conv.status === "ended") throw new HttpsError("failed-precondition", "conversation ended");
    if (conv.activeEscalationToUid) {
      throw new HttpsError("failed-precondition", "conversation already has an active escalation");
    }

    // Verify target user exists in our /users mirror
    const targetSnap = await db.doc(`users/${data.toUid}`).get();
    if (!targetSnap.exists) {
      throw new HttpsError("not-found", "target user not found in directory");
    }
    if ((targetSnap.data()!.email as string) !== data.toEmail) {
      throw new HttpsError("invalid-argument", "toEmail does not match toUid");
    }

    const eid = db.collection("escalations").doc().id;
    const now = admin.firestore.FieldValue.serverTimestamp();

    const slackResult = await notifyEscalation({
      cid: data.cid,
      fromEmail,
      toEmail: data.toEmail,
      conversationTitle: conv.title as string,
      appBaseUrl: process.env.APP_BASE_URL ?? "https://zzem-wiki.web.app",
    });

    const batch = db.batch();
    batch.set(db.doc(`escalations/${eid}`), {
      cid: data.cid,
      fromUid, fromEmail,
      toUid: data.toUid, toEmail: data.toEmail,
      ...(data.note ? { note: data.note } : {}),
      notification: { sentAt: now, channel: "slack", ...(slackResult.ok ? {} : { error: slackResult.reason }) },
      status: "pending",
      createdAt: now,
    });
    batch.update(cref, {
      status: "escalated",
      escalationId: eid,
      activeEscalationToUid: data.toUid,
      updatedAt: now,
    });
    await batch.commit();

    return { eid, slackOk: slackResult.ok, slackReason: slackResult.ok ? null : slackResult.reason };
  },
);
```

- [ ] **Step 2: Wire export**

```ts
// functions/src/index.ts
export { mirrorUserProfile } from "./auth/mirrorUserProfile";
export { streamMessage } from "./chat/streamMessage";
export { shareConversation } from "./share/shareConversation";  // (if Plan 4 merged; otherwise omit)
export { searchShared } from "./search/searchShared";            // (same)
export { escalateToHuman } from "./escalation/escalateToHuman";
```

- [ ] **Step 3: Build + commit**

```bash
cd functions && npm run build && cd ..
git add functions/src/escalation/escalateToHuman.ts functions/src/index.ts
git commit -m "functions: escalateToHuman — creates escalation, grants read via activeEscalationToUid, posts slack"
```

---

### Task 4: resolveEscalation Cloud Function

**Files:**
- Create: `functions/src/escalation/resolveEscalation.ts`
- Modify: `functions/src/index.ts`

- [ ] **Step 1: Write callable**

```ts
import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

export const resolveEscalation = onCall(
  { region: "asia-northeast3", timeoutSeconds: 15, memory: "256MiB" },
  async (req) => {
    const email = req.auth?.token.email;
    if (!email?.endsWith("@wrtn.io")) throw new HttpsError("permission-denied", "@wrtn.io only");
    const uid = req.auth!.uid;

    const eid = (req.data as { eid?: string })?.eid;
    if (!eid) throw new HttpsError("invalid-argument", "eid required");

    const eref = db.doc(`escalations/${eid}`);
    const esnap = await eref.get();
    if (!esnap.exists) throw new HttpsError("not-found", "escalation not found");
    const esc = esnap.data()!;
    if (esc.fromUid !== uid && esc.toUid !== uid) {
      throw new HttpsError("permission-denied", "not a participant");
    }

    const batch = db.batch();
    batch.update(eref, {
      status: "resolved",
      respondedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    batch.update(db.doc(`conversations/${esc.cid}`), {
      status: "active",
      activeEscalationToUid: admin.firestore.FieldValue.delete(),
      escalationId: admin.firestore.FieldValue.delete(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    await batch.commit();
    return { ok: true };
  },
);
```

- [ ] **Step 2: Wire export + build + commit**

```ts
export { resolveEscalation } from "./escalation/resolveEscalation";
```

```bash
cd functions && npm run build && cd ..
git add functions/src/escalation/resolveEscalation.ts functions/src/index.ts
git commit -m "functions: resolveEscalation — clears escalation grant, restores conversation to active"
```

---

### Task 5: Client callables + recipient picker

**Files:**
- Create: `src/lib/firebase/escalation-callables.ts`
- Create: `src/components/chat/recipient-picker.tsx`

- [ ] **Step 1: Callable wrappers**

`src/lib/firebase/escalation-callables.ts`:

```ts
"use client";
import { getFunctions, httpsCallable } from "firebase/functions";
import { getFirebase } from "./client";

const REGION = "asia-northeast3";
function fns() { const { app } = getFirebase(); return getFunctions(app, REGION); }

export async function callEscalateToHuman(input: {
  cid: string; toUid: string; toEmail: string; note?: string;
}) {
  const fn = httpsCallable<typeof input, { eid: string; slackOk: boolean; slackReason: string | null }>(
    fns(), "escalateToHuman",
  );
  return (await fn(input)).data;
}

export async function callResolveEscalation(eid: string) {
  const fn = httpsCallable<{ eid: string }, { ok: true }>(fns(), "resolveEscalation");
  await fn({ eid });
}
```

- [ ] **Step 2: Recipient picker — searches `/users` collection**

`src/components/chat/recipient-picker.tsx`:

```tsx
"use client";
import { useEffect, useState } from "react";
import { collection, getDocs, limit, orderBy, query, where } from "firebase/firestore";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { getFirebase } from "@/lib/firebase/client";

interface UserItem { uid: string; email: string; displayName: string }

export function RecipientPicker({ excludeUid, onPick }: {
  excludeUid: string;
  onPick: (user: UserItem) => void;
}) {
  const [search, setSearch] = useState("");
  const [users, setUsers] = useState<UserItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const { db } = getFirebase();
    // Plan 5 keeps it simple: pull all users (small team), filter client-side.
    // For larger teams, switch to per-keystroke `where("displayName", ">=", search)` query.
    getDocs(query(collection(db, "users"), orderBy("email"), limit(100))).then((snap) => {
      const all: UserItem[] = snap.docs
        .filter((d) => d.id !== excludeUid)
        .map((d) => ({ uid: d.id, ...(d.data() as { email: string; displayName: string }) }));
      setUsers(all);
      setLoading(false);
    });
  }, [excludeUid]);

  const filtered = users.filter((u) =>
    !search || u.email.toLowerCase().includes(search.toLowerCase()) || u.displayName.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-2">
      <Input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search by name or email..."
      />
      {loading ? <p className="text-xs text-muted-foreground">Loading…</p> : null}
      <ul className="max-h-48 space-y-1 overflow-y-auto">
        {filtered.map((u) => (
          <li key={u.uid}>
            <Button
              variant="ghost"
              className="w-full justify-start text-left text-sm"
              onClick={() => onPick(u)}
            >
              <span className="font-medium">{u.displayName}</span>
              <span className="ml-2 font-mono text-xs text-muted-foreground">{u.email}</span>
            </Button>
          </li>
        ))}
        {filtered.length === 0 && !loading && (
          <li className="text-xs text-muted-foreground">No matches.</li>
        )}
      </ul>
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/firebase/escalation-callables.ts src/components/chat/recipient-picker.tsx
git commit -m "ui: escalation callables + recipient picker (searches /users mirror)"
```

---

### Task 6: Escalate button + flow on /c/[cid]

**Files:**
- Create: `src/components/chat/escalate-button.tsx`
- Modify: `src/app/c/[cid]/page.tsx`

- [ ] **Step 1: Escalate button + modal**

`src/components/chat/escalate-button.tsx`:

```tsx
"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { RecipientPicker } from "./recipient-picker";
import { callEscalateToHuman } from "@/lib/firebase/escalation-callables";

export function EscalateButton({ cid, currentUid, onResult }: {
  cid: string;
  currentUid: string;
  onResult: (msg: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [recipient, setRecipient] = useState<{ uid: string; email: string; displayName: string } | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  async function send() {
    if (!recipient) return;
    setBusy(true);
    try {
      const r = await callEscalateToHuman({
        cid,
        toUid: recipient.uid,
        toEmail: recipient.email,
        note: note || undefined,
      });
      if (r.slackOk) {
        onResult(`Sent to ${recipient.email} (Slack notified).`);
      } else {
        onResult(`Recorded for ${recipient.email}, but Slack failed: ${r.slackReason}`);
      }
      setOpen(false);
      setRecipient(null);
      setNote("");
    } catch (e) {
      onResult(`Failed: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return <Button variant="outline" onClick={() => setOpen(true)}>Ask a human</Button>;
  }
  return (
    <div className="space-y-3 rounded-lg border bg-blue-50/30 p-4">
      <div className="text-sm font-medium">Ask a human</div>
      <p className="text-xs text-muted-foreground">
        The recipient will see this entire conversation and can reply in this thread.
      </p>
      {!recipient ? (
        <RecipientPicker excludeUid={currentUid} onPick={(u) => setRecipient(u)} />
      ) : (
        <div className="rounded border p-2 text-sm">
          → <span className="font-mono">{recipient.email}</span> ({recipient.displayName})
          <Button variant="ghost" size="sm" className="ml-2" onClick={() => setRecipient(null)}>change</Button>
        </div>
      )}
      <Textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Optional note (e.g., what context they need)"
        rows={2}
      />
      <div className="flex gap-2">
        <Button onClick={send} disabled={busy || !recipient}>{busy ? "Sending..." : "Send"}</Button>
        <Button variant="ghost" onClick={() => setOpen(false)} disabled={busy}>Cancel</Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Wire into /c/[cid]**

In `src/app/c/[cid]/page.tsx`:

- Add imports:

```tsx
import { EscalateButton } from "@/components/chat/escalate-button";
import { callResolveEscalation } from "@/lib/firebase/escalation-callables";
```

- After the existing share button block, add:

```tsx
{isOwner && conv.status !== "ended" && conv.status !== "shared" && !conv.escalationId && (
  <EscalateButton cid={cid} currentUid={user.uid} onResult={(m) => setActionMsg(m)} />
)}
{isOwner && conv.escalationId && (
  <div className="rounded-lg border bg-blue-50/30 p-3 text-sm">
    Escalation pending. <Button variant="link" onClick={async () => {
      try { await callResolveEscalation(conv.escalationId!); setActionMsg("Resolved."); }
      catch (e) { setActionMsg(`Failed: ${(e as Error).message}`); }
    }}>Mark resolved</Button>
  </div>
)}
```

- Add a `[actionMsg, setActionMsg]` state at the top of the component if not already present (it was added in Plan 4 if you merged that; if not, add now).

For **recipient view** (when current user is the escalation target, not the asker):

```tsx
const isRecipient = !isOwner
  && conv.activeEscalationToUid === user.uid;

{isRecipient && (
  <div className="rounded-lg border bg-emerald-50/30 p-3 text-sm">
    You're helping <span className="font-mono">{conv.ownerUid}</span> with this question.
    Add a reply below — the asker will see it.
  </div>
)}
```

For the recipient to write, the Composer's send needs to write `role='human'` instead of `role='user'`. Update the `handleSend` in /c/[cid] to branch:

```tsx
async function handleSend(text: string) {
  if (!user) return;
  setErr(null);

  if (isRecipient) {
    // Human writes a 'human' message directly via security rule grant
    const { db } = getFirebase();
    const { addDoc, collection, serverTimestamp } = await import("firebase/firestore");
    await addDoc(collection(db, `conversations/${cid}/messages`), {
      role: "human",
      content: text,
      createdAt: serverTimestamp(),
      authorUid: user.uid,
      authorEmail: user.email,
    });
    return;
  }

  // Owner: existing flow (user message → SSE for AI response)
  setStreamingText("");
  await sendUserMessage({ cid, authorUid: user.uid, content: text });
  // ... existing SSE streaming code
}
```

(The recipient does NOT trigger the AI; their message is just plain. The asker sees it via onSnapshot. If the asker wants AI again after the human reply, they continue typing — system goes back to active state automatically when they send a new user message.)

- [ ] **Step 3: Build + commit**

```bash
npm run build
git add src/components/chat/escalate-button.tsx src/app/c
git commit -m "ui: escalate button + recipient response flow + resolve button"
```

---

### Task 7: LOCAL CHECKPOINT — escalation flow with two users

- [ ] **Step 1: Restart everything**

```bash
cd functions && rm -rf lib && npm run build && cd ..
# Restart emulator
npm run emulator
# Re-seed
npm run seed
# Dev server
npm run dev
```

- [ ] **Step 2: Manual flow**

You need two browsers (or one normal + one incognito) to act as two users.

1. **Browser A**: sign in as `alice@wrtn.io`. Open the seeded conversation. Send a message ("real" or mock — works either way).
2. **Browser A**: click "Ask a human" → search for "zach" → pick zach@wrtn.io → optional note → Send.
3. Should see: "Sent to zach@wrtn.io" message. Conversation header shows "Escalation pending" with "Mark resolved" button. Slack webhook fails (since it's a fake URL in emulator) but the conversation transition works.
4. **Browser B**: sign in as `zach@wrtn.io`. Visit `/c/{cid}` (the URL alice was on — copy it).
5. Should see: green banner "You're helping alice with this question." Plus the entire conversation history.
6. Type a reply: "Try X." Press send. Should appear as a green-bordered "human" bubble.
7. **Browser A**: should see zach's message arrive (onSnapshot).
8. **Browser A**: click "Mark resolved". Banner disappears. Conversation status returns to active. activeEscalationToUid cleared on doc.
9. **Browser B**: visiting /c/{cid} now should fail to read (rules denied). The page shows "Loading…" forever or 404 depending on how the rule denial surfaces.

If steps 1-9 work, escalation is good.

- [ ] **Step 3: Push + PR**

```bash
git push -u origin plan/team-chat-5-escalation
gh pr create --base main --head plan/team-chat-5-escalation \
  --title "feat: escalation (Plan 5)" \
  --body "Plan 5 (final). Adds escalateToHuman + resolveEscalation Cloud Functions with Slack webhook, recipient picker UI, in-conversation human response flow with rule-based access grant, resolve button. Local checkpoint passes with two users (alice escalating to zach)."
```

---

## Self-review notes

- **Spec coverage:** §3 escalation transitions ✓, §5 escalation details (recipient picker via `/users` collection ✓, Slack notify ✓, access grant via `activeEscalationToUid` ✓, response in same thread as `role='human'` ✓, resolve button ✓).
- **Why `activeEscalationToUid` instead of querying `escalations`:** Firestore security rules can't run `where` queries to find related docs. Storing the active recipient on the conversation makes the rule a simple field check (`O(1)`). Trade-off: the conversation has redundant state, but the cleanup is one batch update on resolve. Acceptable for Phase 1.
- **One active escalation at a time:** the Cloud Function rejects new escalations while one is pending. Future support for multiple simultaneous (different recipients) is a Phase 2 followup.
- **Recipient picker scaling:** loads up to 100 users client-side. Fine for team scale (~30). For 100+ users, switch to keystroke-driven Firestore queries.
- **Slack webhook resilience:** if the webhook fails, escalation still happens (recorded in Firestore + activeEscalationToUid grants access). The function's response includes `slackOk: false, slackReason` so UI can flag the recipient may not have been notified out-of-band. They'll still see it on next visit.
- **Recipient writes "human" not "user":** important distinction — `role='human'` clearly signals to the asker it's a peer response, not the AI. The streamMessage Cloud Function (Plan 2/3) already filters human messages from history when constructing the AI's view, treating them as user-side context.
- **No auto-resolve:** intentional. If the recipient just adds a message, escalation stays pending until either side clicks resolve. Phase 2 could add 24h auto-resolve via cron.
