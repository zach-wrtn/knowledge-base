# Team Chat — Plan 2: Mock Provider + Streaming Chat Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Get the chat fully working **with no AI keys** via the Mock provider. End in a state where `npm run dev` + emulator + seed lets a signed-in user start a conversation, send a message, see streamed response, multi-turn back-and-forth, and view their conversations in `/me`.

**Architecture:** Define `AIProvider` interface (provider-agnostic streaming contract). Implement `MockAIProvider` with canned keyword-based responses, simulated streaming (50ms per chunk), and synthetic tool-call simulation. Implement `streamMessage` Cloud Function as `onRequest` HTTP handler that emits SSE events. Build chat UI: `/c/[cid]` with input + virtualized message list + auto-scroll. Replace the placeholder home + /me with real implementations. Update emulator seed to include sample conversations.

**Tech Stack:** Same as Plan 1 + `eventsource-parser` (client-side SSE consumption). No external AI deps in this plan — that's Plan 3.

**Spec:** `docs/superpowers/specs/2026-05-01-team-chat-design.md` §3 (lifecycle), §4 (AI integration — Mock provider portion only).

**Prerequisites:** Plan 1 merged. Branch off the post-Plan-1 main.

---

## File Structure

**Create:**
- `functions/src/lib/ai/types.ts` — `AIProvider`, `StreamEvent`, etc.
- `functions/src/lib/ai/mock.ts` — `MockAIProvider`
- `functions/src/lib/ai/index.ts` — provider factory (`getProvider()` from env)
- `functions/src/chat/streamMessage.ts` — HTTPS function with SSE
- `functions/src/lib/__tests__/mock-provider.test.ts`
- `src/lib/firebase/streaming.ts` — client-side SSE consumer
- `src/components/chat/composer.tsx` — message input
- `src/components/chat/message-list.tsx` — bubble renderer with auto-scroll
- `src/components/chat/message-bubble.tsx` — single message
- `tests/e2e/chat.spec.ts` — E2E with mock + emulator

**Modify:**
- `src/app/c/[cid]/page.tsx` (replace placeholder with full chat)
- `src/app/me/page.tsx` (already real in Plan 1; minor refinements)
- `src/app/page.tsx` (no change)
- `src/lib/firebase/chat.ts` — add `subscribeToMessages()`, `sendUserMessage()`
- `functions/src/index.ts` — export `streamMessage`
- `functions/src/lib/secrets.ts` — add `AI_PROVIDER` non-secret env (just `defineString`)
- `scripts/seed-emulator.mjs` — seed sample conversations + messages
- `package.json` — add `eventsource-parser`

---

### Task 1: Provider interface + types

**Files:**
- Create: `functions/src/lib/ai/types.ts`

- [ ] **Step 1: Branch off post-Plan-1 main**

```bash
cd ~/dev/work/zzem-wiki
git checkout main && git pull
git checkout -b plan/team-chat-2-mock-streaming
mkdir -p functions/src/lib/ai
mkdir -p src/components/chat
```

- [ ] **Step 2: Define types**

`functions/src/lib/ai/types.ts`:

```ts
export type ProviderName = "mock" | "anthropic" | "wrtn";

export interface ProviderMessage {
  role: "user" | "assistant" | "tool";
  content: string;
}

export interface ProviderTool {
  name: string;
  description: string;
  inputSchema: object;
}

export interface ToolCall {
  name: string;
  input: Record<string, unknown>;
}

export type ToolResult = {
  toolCallId: string;
  output: unknown;
  isError?: boolean;
};

export interface SourceRef {
  type: string;
  id: string;
  why?: string;
}

export interface TokenUsage {
  input: number;
  output: number;
  cacheRead: number;
}

export type StreamEvent =
  | { type: "text_delta"; text: string }
  | { type: "tool_use_start"; id: string; name: string; input: Record<string, unknown> }
  | { type: "tool_use_end"; id: string; result: unknown }
  | { type: "done"; usage: TokenUsage; finalText: string; sourcesUsed: SourceRef[]; finishReason: "end_turn" | "tool_use_max" | "max_tokens" | "error" };

export interface AIProvider {
  name: ProviderName;
  model: string;
  streamMessage(input: {
    system: string;
    messages: ProviderMessage[];
    tools: ProviderTool[];
    onToolCall?: (call: ToolCall) => Promise<ToolResult>;
    maxTokens?: number;
  }): AsyncIterable<StreamEvent>;
}
```

- [ ] **Step 3: Build to confirm**

```bash
cd functions && npm run build
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add functions/src/lib/ai/types.ts
git commit -m "ai: provider interface + StreamEvent types"
```

---

### Task 2: MockAIProvider

**Files:**
- Create: `functions/src/lib/ai/mock.ts`
- Create: `functions/src/lib/__tests__/mock-provider.test.ts`

- [ ] **Step 1: Write Mock provider**

`functions/src/lib/ai/mock.ts`:

```ts
import type { AIProvider, ProviderMessage, StreamEvent } from "./types";

const KEYWORD_RESPONSES: Array<{ pattern: RegExp; response: string }> = [
  {
    pattern: /\b(hi|hello|안녕|반가워|반갑)/i,
    response: "안녕하세요! 무엇이 궁금하신가요? 작업 중에 막히는 게 있으면 편하게 물어봐 주세요.",
  },
  {
    pattern: /\b(rate.?limit|throttl|제한|limit)/i,
    response:
      "## Rate limit (예시 답변)\n\nUGC platform submit endpoint는 사용자당 60 RPS, 조직당 600 RPS입니다. " +
      "재시도는 지수 백오프 (1s 시작, jitter 포함, 최대 5회) 권장.\n\n*Mock 응답 — 실제 KB grounding은 Plan 3에서 활성화*",
  },
  {
    pattern: /\b(filter|free.?tab|rollout)/i,
    response:
      "Free-tab filter diversification 실험은 2026 Q3 종료 예정입니다. 자세한 일정은 PRD `free-tab/filter-diversification`을 참고하세요.\n\n*Mock 응답 — 실제 데이터는 Plan 3에서.*",
  },
  {
    pattern: /\b(test|테스트|mock)/i,
    response: "Mock provider가 정상 동작합니다. 사용자 메시지: 받음, 토큰 단위 스트리밍: 50ms 간격으로 전송됨.",
  },
];

const FALLBACK = "현재 Mock 모드라 일반 답변을 드리지 못합니다. KB 통합과 실제 AI는 Plan 3에서 활성화됩니다. 대화 흐름은 정상 동작 중입니다.";

export class MockAIProvider implements AIProvider {
  name = "mock" as const;
  model = "mock-v1";

  async *streamMessage(input: {
    messages: ProviderMessage[];
    system: string;
    tools: never[];
    maxTokens?: number;
  }): AsyncIterable<StreamEvent> {
    const lastUser = [...input.messages].reverse().find((m) => m.role === "user");
    const text = lastUser?.content ?? "";
    const responseText = matchResponse(text);

    // Stream the response in chunks of ~10 characters with 50ms delay
    const chunkSize = 10;
    for (let i = 0; i < responseText.length; i += chunkSize) {
      yield {
        type: "text_delta",
        text: responseText.slice(i, i + chunkSize),
      };
      await sleep(50);
    }

    yield {
      type: "done",
      usage: {
        input: estimateTokens(text + input.system),
        output: estimateTokens(responseText),
        cacheRead: 0,
      },
      finalText: responseText,
      sourcesUsed: [],
      finishReason: "end_turn",
    };
  }
}

function matchResponse(text: string): string {
  for (const r of KEYWORD_RESPONSES) {
    if (r.pattern.test(text)) return r.response;
  }
  return FALLBACK;
}

function estimateTokens(s: string): number {
  return Math.ceil(s.length / 4);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
```

- [ ] **Step 2: Write provider factory**

`functions/src/lib/ai/index.ts`:

```ts
import type { AIProvider } from "./types";
import { MockAIProvider } from "./mock";

export type ProviderConfig = { provider: "mock" } | { provider: "anthropic" } | { provider: "wrtn" };

export function getProvider(): AIProvider {
  const name = process.env.AI_PROVIDER ?? "mock";
  switch (name) {
    case "mock":
      return new MockAIProvider();
    case "anthropic":
      throw new Error("anthropic provider lands in Plan 3");
    case "wrtn":
      throw new Error("wrtn provider lands in Plan 3");
    default:
      throw new Error(`unknown AI_PROVIDER: ${name}`);
  }
}
```

- [ ] **Step 3: Test the mock**

`functions/src/lib/__tests__/mock-provider.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { MockAIProvider } from "../ai/mock";

describe("MockAIProvider", () => {
  const provider = new MockAIProvider();

  async function collect(stream: AsyncIterable<unknown>): Promise<unknown[]> {
    const out: unknown[] = [];
    for await (const e of stream) out.push(e);
    return out;
  }

  it("streams text_delta chunks then done", async () => {
    const events = await collect(provider.streamMessage({
      system: "You are helpful.",
      messages: [{ role: "user", content: "hello" }],
      tools: [],
    }));
    expect(events.length).toBeGreaterThan(2);
    const last = events[events.length - 1] as { type: string };
    expect(last.type).toBe("done");
    const deltas = events.filter((e) => (e as { type: string }).type === "text_delta");
    expect(deltas.length).toBeGreaterThan(0);
  });

  it("matches keyword responses", async () => {
    const events = await collect(provider.streamMessage({
      system: "",
      messages: [{ role: "user", content: "What's the rate limit?" }],
      tools: [],
    }));
    const finalText = (events.find((e) => (e as { type: string }).type === "done") as { finalText: string }).finalText;
    expect(finalText.toLowerCase()).toContain("rate limit");
  });

  it("returns fallback for unmatched input", async () => {
    const events = await collect(provider.streamMessage({
      system: "",
      messages: [{ role: "user", content: "asdfqwer xyz123" }],
      tools: [],
    }));
    const finalText = (events.find((e) => (e as { type: string }).type === "done") as { finalText: string }).finalText;
    expect(finalText).toMatch(/Mock/);
  });
});
```

- [ ] **Step 4: Run tests**

```bash
cd functions && npm test 2>&1 | tail -8
```

Expected: 3 mock tests pass + earlier kb-index/tools tests = 12+ pass.

- [ ] **Step 5: Commit**

```bash
git add functions/src/lib/ai functions/src/lib/__tests__/mock-provider.test.ts
git commit -m "ai: MockAIProvider with keyword-based canned responses + streaming simulation"
```

---

### Task 3: streamMessage Cloud Function with SSE

**Files:**
- Create: `functions/src/chat/streamMessage.ts`
- Modify: `functions/src/index.ts`

- [ ] **Step 1: Write the function**

`functions/src/chat/streamMessage.ts`:

```ts
import { onRequest } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import { getProvider } from "../lib/ai";
import { consumeOrThrow, RateLimitError } from "../lib/rate-limit";
import type { ProviderMessage } from "../lib/ai/types";

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

const SYSTEM_PROMPT = `You are the wrtn team operations assistant. Answer questions during work using the team KB and your general knowledge.
Be concise. If KB doesn't cover, say so explicitly.`;

const HISTORY_LIMIT = 20;

export const streamMessage = onRequest(
  {
    region: "asia-northeast3",
    timeoutSeconds: 120,
    memory: "512MiB",
    cors: true,
  },
  async (req, res) => {
    if (req.method !== "POST") {
      res.status(405).json({ error: "POST required" });
      return;
    }

    // Auth: bearer token in Authorization header
    const idToken = (req.headers.authorization ?? "").replace(/^Bearer\s+/i, "");
    if (!idToken) {
      res.status(401).json({ error: "Authorization header missing" });
      return;
    }

    let decoded;
    try {
      decoded = await admin.auth().verifyIdToken(idToken);
    } catch {
      res.status(401).json({ error: "invalid token" });
      return;
    }
    if (!decoded.email?.endsWith("@wrtn.io")) {
      res.status(403).json({ error: "@wrtn.io only" });
      return;
    }
    const uid = decoded.uid;

    const cid = (req.body as { cid?: string })?.cid;
    if (!cid) {
      res.status(400).json({ error: "cid required" });
      return;
    }

    // Rate limit
    try { await consumeOrThrow(uid); } catch (e) {
      if (e instanceof RateLimitError) {
        res.status(429).json({ error: e.message });
        return;
      }
      throw e;
    }

    // Authorization on the conversation
    const cref = db.doc(`conversations/${cid}`);
    const csnap = await cref.get();
    if (!csnap.exists) {
      res.status(404).json({ error: "conversation not found" });
      return;
    }
    const conv = csnap.data()!;
    if (conv.ownerUid !== uid) {
      res.status(403).json({ error: "not owner" });
      return;
    }

    // Load recent messages
    const msgsSnap = await cref.collection("messages")
      .orderBy("createdAt", "desc")
      .limit(HISTORY_LIMIT)
      .get();
    const messages: ProviderMessage[] = msgsSnap.docs
      .map((d) => d.data())
      .reverse()
      .filter((m) => m.role === "user" || m.role === "assistant" || m.role === "human")
      .map((m) => ({
        role: m.role === "human" ? "user" : (m.role as "user" | "assistant"),
        content: m.content as string,
      }));

    // Set SSE headers
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders?.();

    const provider = getProvider();
    let finalText = "";
    let usage = { input: 0, output: 0, cacheRead: 0 };
    let finishReason: "end_turn" | "tool_use_max" | "max_tokens" | "error" = "end_turn";
    let toolCalls = 0;

    try {
      for await (const event of provider.streamMessage({
        system: SYSTEM_PROMPT,
        messages,
        tools: [], // KB tools wired in Plan 3
      })) {
        res.write(`data: ${JSON.stringify(event)}\n\n`);
        if (event.type === "text_delta") finalText += event.text;
        if (event.type === "tool_use_start") toolCalls++;
        if (event.type === "done") {
          usage = event.usage;
          finishReason = event.finishReason;
        }
      }
    } catch (e) {
      finishReason = "error";
      res.write(`data: ${JSON.stringify({ type: "done", usage, finalText, sourcesUsed: [], finishReason: "error", error: (e as Error).message })}\n\n`);
    }

    // Persist assistant message
    if (finalText) {
      await cref.collection("messages").add({
        role: "assistant",
        content: finalText,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        authorUid: "ai",
        ai: {
          sourcesUsed: [],
          tokenUsage: usage,
          toolCalls,
          finishReason,
        },
      });

      const messageCount = msgsSnap.size + 1;
      await cref.update({
        messageCount,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        "ai.provider": provider.name,
        "ai.model": provider.model,
        "ai.totalTokens.input": admin.firestore.FieldValue.increment(usage.input),
        "ai.totalTokens.output": admin.firestore.FieldValue.increment(usage.output),
        "ai.totalTokens.cacheRead": admin.firestore.FieldValue.increment(usage.cacheRead),
      });

      // First message → set conversation title from user message
      if (msgsSnap.size <= 2) {
        const firstUser = messages.find((m) => m.role === "user");
        if (firstUser) {
          const title = firstUser.content.slice(0, 40).replace(/\s+/g, " ").trim();
          await cref.update({ title: title || "(new conversation)" });
        }
      }
    }

    res.end();
  },
);
```

- [ ] **Step 2: Wire export**

`functions/src/index.ts`:

```ts
export { mirrorUserProfile } from "./auth/mirrorUserProfile";
export { streamMessage } from "./chat/streamMessage";
```

- [ ] **Step 3: Build**

```bash
cd functions && npm run build
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add functions/src/chat/streamMessage.ts functions/src/index.ts
git commit -m "functions: streamMessage HTTPS with SSE — auth + rate limit + provider streaming + assistant message persistence"
```

---

### Task 4: Client-side SSE consumer

**Files:**
- Create: `src/lib/firebase/streaming.ts`
- Modify: `package.json`

- [ ] **Step 1: Install eventsource-parser**

```bash
npm install eventsource-parser
```

- [ ] **Step 2: Write streaming helper**

`src/lib/firebase/streaming.ts`:

```ts
"use client";
import { createParser, type ParsedEvent } from "eventsource-parser";
import { getFirebase } from "./client";

interface StreamEvent {
  type: "text_delta" | "tool_use_start" | "tool_use_end" | "done";
  text?: string;
  finalText?: string;
  finishReason?: string;
  error?: string;
}

export async function streamFromCloudFunction(input: {
  cid: string;
  onEvent: (event: StreamEvent) => void;
  signal?: AbortSignal;
}): Promise<void> {
  const { auth } = getFirebase();
  const idToken = await auth.currentUser?.getIdToken();
  if (!idToken) throw new Error("not signed in");

  const url = process.env.NEXT_PUBLIC_STREAM_MESSAGE_URL
    ?? `https://asia-northeast3-${process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID}.cloudfunctions.net/streamMessage`;

  const res = await fetch(url, {
    method: "POST",
    signal: input.signal,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify({ cid: input.cid }),
  });
  if (!res.ok || !res.body) {
    throw new Error(`streamMessage HTTP ${res.status}: ${await res.text().catch(() => "")}`);
  }

  const parser = createParser({
    onEvent(ev: ParsedEvent) {
      try {
        const data = JSON.parse(ev.data) as StreamEvent;
        input.onEvent(data);
      } catch {
        // ignore malformed
      }
    },
  });

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    parser.feed(decoder.decode(value));
  }
}
```

- [ ] **Step 3: Add env var to .env.local.example**

Append:

```
# Optional: Cloud Function emulator endpoint for streamMessage. Default falls back to deployed Cloud Function URL.
NEXT_PUBLIC_STREAM_MESSAGE_URL=
```

- [ ] **Step 4: Build to confirm**

```bash
npm run build
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/firebase/streaming.ts package.json package-lock.json .env.local.example
git commit -m "ui: client SSE consumer for streamMessage (eventsource-parser)"
```

---

### Task 5: Chat helpers — sendUserMessage + subscribeToMessages

**Files:**
- Modify: `src/lib/firebase/chat.ts`

- [ ] **Step 1: Append to chat.ts**

```ts
import {
  addDoc, collection, doc, onSnapshot,
  orderBy, query, serverTimestamp, updateDoc,
} from "firebase/firestore";
import { getFirebase } from "./client";
import type { ConversationDoc, MessageDoc } from "@/types/conversation";

// (existing imports + functions stay)

export async function sendUserMessage(input: {
  cid: string;
  authorUid: string;
  content: string;
}): Promise<string> {
  const { db } = getFirebase();
  const ref = await addDoc(collection(db, `conversations/${input.cid}/messages`), {
    role: "user",
    content: input.content,
    createdAt: serverTimestamp(),
    authorUid: input.authorUid,
  });
  // Optimistically bump messageCount + updatedAt
  await updateDoc(doc(db, "conversations", input.cid), {
    messageCount: (await import("firebase/firestore")).increment(1),
    updatedAt: serverTimestamp(),
  });
  return ref.id;
}

export function subscribeToMessages(
  cid: string,
  onChange: (messages: (MessageDoc & { id: string })[]) => void,
): () => void {
  const { db } = getFirebase();
  const q = query(
    collection(db, `conversations/${cid}/messages`),
    orderBy("createdAt", "asc"),
  );
  return onSnapshot(q, (snap) => {
    const items = snap.docs.map((d) => ({ id: d.id, ...(d.data() as MessageDoc) }));
    onChange(items);
  });
}

export function subscribeToConversation(
  cid: string,
  onChange: (conv: (ConversationDoc & { id: string }) | null) => void,
): () => void {
  const { db } = getFirebase();
  return onSnapshot(doc(db, "conversations", cid), (snap) => {
    onChange(snap.exists() ? ({ id: snap.id, ...(snap.data() as ConversationDoc) }) : null);
  });
}
```

(The exact placement is at the end of the file, after `conversationRef`. The duplicate `import` block above is illustrative — unify with the existing imports at top.)

Refactored full file:

```ts
"use client";
import {
  addDoc, collection, doc, increment, onSnapshot,
  orderBy, query, serverTimestamp, updateDoc, where, limit, getDocs,
} from "firebase/firestore";
import { getFirebase } from "./client";
import type { ConversationDoc, MessageDoc } from "@/types/conversation";

export async function createConversation(input: {
  ownerUid: string;
  scope?: ConversationDoc["scope"];
}): Promise<string> {
  const { db } = getFirebase();
  const ref = await addDoc(collection(db, "conversations"), {
    ownerUid: input.ownerUid,
    title: "(new conversation)",
    status: "active",
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    messageCount: 0,
    ...(input.scope ? { scope: input.scope } : {}),
    shared: false,
    ai: {
      provider: "mock",
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

export async function sendUserMessage(input: {
  cid: string;
  authorUid: string;
  content: string;
}): Promise<string> {
  const { db } = getFirebase();
  const ref = await addDoc(collection(db, `conversations/${input.cid}/messages`), {
    role: "user",
    content: input.content,
    createdAt: serverTimestamp(),
    authorUid: input.authorUid,
  });
  await updateDoc(doc(db, "conversations", input.cid), {
    messageCount: increment(1),
    updatedAt: serverTimestamp(),
  });
  return ref.id;
}

export function subscribeToMessages(
  cid: string,
  onChange: (messages: (MessageDoc & { id: string })[]) => void,
): () => void {
  const { db } = getFirebase();
  const q = query(
    collection(db, `conversations/${cid}/messages`),
    orderBy("createdAt", "asc"),
  );
  return onSnapshot(q, (snap) => {
    onChange(snap.docs.map((d) => ({ id: d.id, ...(d.data() as MessageDoc) })));
  });
}

export function subscribeToConversation(
  cid: string,
  onChange: (conv: (ConversationDoc & { id: string }) | null) => void,
): () => void {
  const { db } = getFirebase();
  return onSnapshot(doc(db, "conversations", cid), (snap) => {
    onChange(snap.exists() ? ({ id: snap.id, ...(snap.data() as ConversationDoc) }) : null);
  });
}
```

- [ ] **Step 2: Build**

```bash
npm run build
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/lib/firebase/chat.ts
git commit -m "ui: chat helpers — sendUserMessage + subscribeToMessages + subscribeToConversation"
```

---

### Task 6: Chat components

**Files:**
- Create: `src/components/chat/composer.tsx`, `message-bubble.tsx`, `message-list.tsx`

- [ ] **Step 1: Composer (input)**

`src/components/chat/composer.tsx`:

```tsx
"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

export function Composer({ onSend, disabled }: {
  onSend: (text: string) => void | Promise<void>;
  disabled?: boolean;
}) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = text.trim();
    if (!trimmed) return;
    setBusy(true);
    try {
      await onSend(trimmed);
      setText("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex items-end gap-2">
      <Textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            submit(e as unknown as React.FormEvent);
          }
        }}
        placeholder="Ask anything..."
        rows={2}
        className="flex-1 font-mono text-sm"
        disabled={disabled || busy}
      />
      <Button type="submit" disabled={disabled || busy || !text.trim()}>
        {busy ? "..." : "Send"}
      </Button>
    </form>
  );
}
```

- [ ] **Step 2: Message bubble**

`src/components/chat/message-bubble.tsx`:

```tsx
"use client";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { MessageDoc } from "@/types/conversation";

export function MessageBubble({ message, streamingText }: {
  message: MessageDoc & { id: string };
  streamingText?: string;  // shown when this is the streaming assistant placeholder
}) {
  const role = message.role;
  const isUser = role === "user";
  const isAssistant = role === "assistant";
  const isHuman = role === "human";

  const align = isUser ? "items-end" : "items-start";
  const bubbleClass = isUser
    ? "bg-foreground text-background"
    : isHuman
    ? "border border-emerald-500/40 bg-emerald-500/5"
    : "border bg-accent/50";

  const text = streamingText ?? message.content;

  return (
    <div className={`flex flex-col gap-1 ${align}`}>
      <div className="text-xs text-muted-foreground">
        {isUser && "You"}
        {isAssistant && "AI"}
        {isHuman && (message.authorEmail ?? "Human")}
      </div>
      <div className={`max-w-[80%] rounded-lg px-4 py-2 text-sm ${bubbleClass}`}>
        {isAssistant || isHuman ? (
          <div className="prose prose-sm max-w-none">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
          </div>
        ) : (
          <div className="whitespace-pre-wrap">{text}</div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Message list**

`src/components/chat/message-list.tsx`:

```tsx
"use client";
import { useEffect, useRef } from "react";
import { MessageBubble } from "./message-bubble";
import type { MessageDoc } from "@/types/conversation";

export function MessageList({ messages, streamingText }: {
  messages: (MessageDoc & { id: string })[];
  streamingText: string | null;
}) {
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, streamingText]);

  // If streaming and the last message is NOT yet the streaming assistant,
  // show a synthetic placeholder.
  const showPlaceholder = streamingText !== null
    && (messages.length === 0 || messages[messages.length - 1]!.role !== "assistant");

  return (
    <div className="space-y-3">
      {messages.map((m) => <MessageBubble key={m.id} message={m} />)}
      {showPlaceholder && streamingText !== null && (
        <MessageBubble
          message={{
            id: "__streaming__",
            role: "assistant",
            content: streamingText,
            authorUid: "ai",
            createdAt: { toMillis: () => Date.now() } as unknown as MessageDoc["createdAt"],
          }}
          streamingText={streamingText}
        />
      )}
      <div ref={endRef} />
    </div>
  );
}
```

- [ ] **Step 4: Commit**

```bash
git add src/components/chat
git commit -m "ui: chat components — composer + message list/bubble with streaming placeholder"
```

---

### Task 7: Replace /c/[cid] with full chat page

**Files:**
- Modify: `src/app/c/[cid]/page.tsx`

- [ ] **Step 1: Replace placeholder with full chat UI**

```tsx
"use client";
import { use, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/firebase/auth-provider";
import {
  sendUserMessage,
  subscribeToConversation,
  subscribeToMessages,
} from "@/lib/firebase/chat";
import { streamFromCloudFunction } from "@/lib/firebase/streaming";
import { Composer } from "@/components/chat/composer";
import { MessageList } from "@/components/chat/message-list";
import type { ConversationDoc, MessageDoc } from "@/types/conversation";

export default function ConversationPage({ params }: { params: Promise<{ cid: string }> }) {
  const { cid } = use(params);
  const { user, loading } = useAuth();
  const router = useRouter();
  const [conv, setConv] = useState<(ConversationDoc & { id: string }) | null>(null);
  const [messages, setMessages] = useState<(MessageDoc & { id: string })[]>([]);
  const [streamingText, setStreamingText] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [loading, user, router]);

  useEffect(() => {
    if (!user) return;
    return subscribeToConversation(cid, setConv);
  }, [user, cid]);

  useEffect(() => {
    if (!user) return;
    return subscribeToMessages(cid, setMessages);
  }, [user, cid]);

  async function handleSend(text: string) {
    if (!user) return;
    setErr(null);
    setStreamingText("");
    await sendUserMessage({ cid, authorUid: user.uid, content: text });

    abortRef.current = new AbortController();
    let buffer = "";
    try {
      await streamFromCloudFunction({
        cid,
        signal: abortRef.current.signal,
        onEvent: (e) => {
          if (e.type === "text_delta" && e.text) {
            buffer += e.text;
            setStreamingText(buffer);
          }
          // 'done' is when the function persists the final assistant message;
          // onSnapshot picks it up. We just clear streaming UI on done.
          if (e.type === "done") {
            setStreamingText(null);
          }
        },
      });
    } catch (e) {
      setErr((e as Error).message);
      setStreamingText(null);
    }
  }

  function cancel() {
    abortRef.current?.abort();
    setStreamingText(null);
  }

  if (loading || !user) return null;
  if (!conv) return <main className="p-6">Loading…</main>;

  const isOwner = conv.ownerUid === user.uid;

  return (
    <main className="mx-auto flex h-screen max-w-3xl flex-col gap-3 p-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold">{conv.title}</h1>
          <div className="mt-0.5 text-xs text-muted-foreground">
            status: <span className="font-mono">{conv.status}</span>
            {conv.scope && <> · scope: <span className="font-mono">{conv.scope}</span></>}
            <> · {conv.messageCount} messages</>
          </div>
        </div>
        <div className="flex gap-2">
          <button onClick={() => router.push("/")} className="text-xs text-muted-foreground hover:underline">
            Home
          </button>
        </div>
      </header>

      <section className="flex-1 overflow-y-auto rounded border bg-background p-4">
        {messages.length === 0 && streamingText === null && (
          <p className="text-sm text-muted-foreground">No messages yet — say hi.</p>
        )}
        <MessageList messages={messages} streamingText={streamingText} />
      </section>

      {err && <p role="alert" className="text-sm text-destructive">{err}</p>}

      <footer className="border-t pt-3">
        <Composer
          onSend={handleSend}
          disabled={!isOwner || conv.status === "ended" || streamingText !== null}
        />
        {streamingText !== null && (
          <button onClick={cancel} className="mt-2 text-xs text-muted-foreground hover:underline">
            Cancel
          </button>
        )}
      </footer>
    </main>
  );
}
```

- [ ] **Step 2: Build**

```bash
npm run build
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/app/c
git commit -m "ui: full chat page — message subscription, optimistic user write, streaming via SSE, composer"
```

---

### Task 8: Update emulator seed with sample conversations

**Files:**
- Modify: `scripts/seed-emulator.mjs`

- [ ] **Step 1: Append conversation/message seeding**

After the user creation block, add:

```js
console.log("creating sample conversations...");

const tsAgo = (m) => new Date(Date.now() - m * 60_000);

// Alice's conversation: simple multi-turn
const c1 = db.collection("conversations").doc();
await c1.set({
  ownerUid: "u-alice",
  title: "Team onboarding question",
  status: "active",
  createdAt: tsAgo(60),
  updatedAt: tsAgo(50),
  messageCount: 2,
  shared: false,
  ai: {
    provider: "mock",
    model: "mock-v1",
    totalTokens: { input: 50, output: 100, cacheRead: 0 },
  },
});
await c1.collection("messages").add({
  role: "user",
  content: "How does our team onboard new hires?",
  createdAt: tsAgo(60),
  authorUid: "u-alice",
});
await c1.collection("messages").add({
  role: "assistant",
  content: "*Mock seed:* Onboarding involves repo access, Slack invites, and a buddy match. (Real KB grounding lands in Plan 3.)",
  createdAt: tsAgo(50),
  authorUid: "ai",
  ai: {
    sourcesUsed: [],
    tokenUsage: { input: 50, output: 100, cacheRead: 0 },
    toolCalls: 0,
    finishReason: "end_turn",
  },
});

// Bob's empty conversation
const c2 = db.collection("conversations").doc();
await c2.set({
  ownerUid: "u-bob",
  title: "(new conversation)",
  status: "active",
  createdAt: tsAgo(10),
  updatedAt: tsAgo(10),
  messageCount: 0,
  shared: false,
  ai: { provider: "mock", model: "unknown", totalTokens: { input: 0, output: 0, cacheRead: 0 } },
});
```

- [ ] **Step 2: Re-run seed (against running emulator)**

```bash
npm run seed
```

Expected: log shows "creating sample conversations..." plus the user creation lines. Then verify in Emulator UI Firestore tab that 2 conversations exist with the right ownerUids.

- [ ] **Step 3: Commit**

```bash
git add scripts/seed-emulator.mjs
git commit -m "seed: sample conversations for chat redesign"
```

---

### Task 9: Functions emulator wiring + .env.local for streamMessage URL

**Files:**
- Modify: `firebase.json` (already has functions emulator at port 5001)
- Update: usage docs

- [ ] **Step 1: Verify firebase.json includes functions emulator**

```bash
grep -A1 functions firebase.json | head -10
```

Should show `"functions": { "port": 5001 }`. If not, add to the `emulators:` block.

- [ ] **Step 2: Update emulator npm script to include functions**

In `package.json`:

```json
"emulator": "firebase emulators:start --only auth,firestore,functions --project demo-zzem-wiki",
```

- [ ] **Step 3: Set NEXT_PUBLIC_STREAM_MESSAGE_URL for local dev**

In `.env.local` (not `.env.local.example`):

```
NEXT_PUBLIC_STREAM_MESSAGE_URL=http://localhost:5001/demo-zzem-wiki/asia-northeast3/streamMessage
```

(For dev only. Production uses the deployed URL — Cloud Functions URL pattern is `https://<region>-<project-id>.cloudfunctions.net/<function-name>`.)

Update `.env.local.example` comment:

```
# For local emulator: http://localhost:5001/<project-id>/<region>/streamMessage
# For production: defaults to https://<region>-<project>.cloudfunctions.net/streamMessage
NEXT_PUBLIC_STREAM_MESSAGE_URL=
```

- [ ] **Step 4: Build functions for emulator**

```bash
cd functions && npm run build && cd ..
```

The functions emulator picks up `functions/lib/`. Now restart the emulator (kill, run `npm run emulator` again) so it loads the function.

- [ ] **Step 5: Commit**

```bash
git add firebase.json package.json .env.local.example
git commit -m "emulator: include functions in npm run emulator; document NEXT_PUBLIC_STREAM_MESSAGE_URL"
```

---

### Task 10: LOCAL CHECKPOINT — full chat works with Mock

After this task, the user can run the app locally end-to-end with mock AI.

- [ ] **Step 1: Restart everything fresh**

```bash
# Terminal 1
cd ~/dev/work/zzem-wiki/functions && npm run build && cd ..
npm run emulator

# Terminal 2 (after emulator UI shows ready)
npm run seed

# Terminal 3
npm run dev
```

- [ ] **Step 2: Manual verification**

1. Open http://localhost:3000 (or the port dev shows)
2. Sign in as `alice@wrtn.io` via emulator popup
3. Land on home → see "Team onboarding question" conversation in Recent
4. Click that conversation → see the existing user + assistant messages
5. Type a follow-up: "Tell me more" → press Enter
6. Should see:
   - Your message appears immediately
   - "AI" placeholder bubble appears with text streaming in (50ms chunks)
   - Once done, the streaming bubble is replaced by the persisted assistant message
   - Conversation header shows messageCount incremented
7. Type "rate limit" → see the keyword-matched mock response
8. Sign out → sign in as `zach@wrtn.io` → click "+ New chat" → start a fresh conversation
9. Type "hello" → see the greeting mock response
10. Refresh `/me` → see both alice's seed conversation (only her own — RLS works) AND zach's new conversation? No — RLS should mean each user only sees their own. So as zach, /me only shows zach's.

If all 10 steps work, Plan 2 is done.

- [ ] **Step 3: Run E2E tests**

```bash
# Make sure emulator is running, then:
npx playwright test tests/e2e/login.spec.ts
```

Expected: 2/2 PASS (no chat E2E added in this plan; that's a Phase 2 polish).

- [ ] **Step 4: Push + create PR**

```bash
git push -u origin plan/team-chat-2-mock-streaming
gh pr create --base main --head plan/team-chat-2-mock-streaming \
  --title "feat: mock provider + streaming chat (Plan 2)" \
  --body "Plan 2 of team chat redesign. Adds AI provider abstraction, MockAIProvider, streamMessage Cloud Function (SSE), client-side SSE consumer, full chat UI at /c/[cid], chat helpers, sample conversation seed. Local checkpoint passes — chat works end-to-end with mock AI in Firebase emulator."
```

---

## Self-review notes

- **Spec coverage:** §3 lifecycle (active state, multi-turn) ✓; §4 AI integration (Mock provider portion) ✓; §4 streaming via SSE ✓; §11 error handling (provider error → finishReason='error', SSE interrupted → reconnect via onSnapshot) ✓.
- **What's NOT in this plan (correctly deferred):**
  - Anthropic + Wrtn providers (Plan 3)
  - KB tools wiring (Plan 3)
  - Past shared conversations as context (Plan 3, requires shared-conversations to exist — Plan 4)
  - Share button (Plan 4)
  - Escalation (Plan 5)
- **Local-first:** every task except 9 (which configures emulator) requires zero external services. Task 10 explicitly verifies the full mock flow runs locally without any AI keys, GitHub PAT, or Slack webhook.
- **Scope of Mock provider:** intentionally simple keyword matching, not a full LLM simulation. The point is to validate the wiring (SSE → Firestore writes → React subscription) not to test conversation quality. Real quality testing requires real provider (Plan 3).
- **Streaming UX guarantee:** the user sees text appear ~50ms after each chunk; the assistant message is finalized in Firestore by the Cloud Function before the SSE stream closes; `onSnapshot` picks up the persisted message and replaces the streaming placeholder. If the SSE stream is killed mid-flight (cancel button or network), the Cloud Function still completes its work and persists; `onSnapshot` shows the result on next render.
