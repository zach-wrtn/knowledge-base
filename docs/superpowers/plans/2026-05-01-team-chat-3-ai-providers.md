# Team Chat — Plan 3: Real AI Providers + KB Tools Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the Anthropic provider (for dev with personal key), the Wrtn provider placeholder (interface only — fills in when API spec arrives), and wire KB tools so the AI can ground answers in the team KB. End in a state where setting `AI_PROVIDER=anthropic` + `ANTHROPIC_API_KEY` gives real Claude streaming with KB grounding.

**Architecture:** Anthropic adapter wraps `@anthropic-ai/sdk` streaming, translates Anthropic events to our `StreamEvent` type. Wrtn adapter is an interface stub that throws "not yet implemented" until the API spec lands. KB tools (4) executed in Cloud Function dispatcher; results piped back to provider for follow-up. Past shared conversations enter the system prompt via the `list_related_shared_conversations` tool — implementation stays a stub here (returns `[]`); Plan 4 wires the real Vertex AI vector search once `shared-conversations` exists.

**Tech Stack:** `@anthropic-ai/sdk` v0.30+, prompt caching, adaptive thinking, KB tools (file system reads via Octokit). No Vertex AI here.

**Spec:** `docs/superpowers/specs/2026-05-01-team-chat-design.md` §4 (full AI integration).

**Prerequisites:** Plans 1 and 2 merged. Mock provider working locally.

---

## File Structure

**Create:**
- `functions/src/lib/ai/anthropic.ts` — Anthropic provider implementation
- `functions/src/lib/ai/wrtn.ts` — Wrtn provider placeholder
- `functions/src/lib/ai/system-prompt.ts` — system prompt builder with cache layers
- `functions/src/lib/__tests__/anthropic-provider.test.ts`
- `functions/src/lib/__tests__/wrtn-provider.test.ts`

**Modify:**
- `functions/src/lib/ai/index.ts` — wire Anthropic + Wrtn into factory
- `functions/src/lib/secrets.ts` — already has ANTHROPIC_API_KEY; add WRTN_AI_API_KEY + WRTN_AI_ENDPOINT
- `functions/src/chat/streamMessage.ts` — add KB tools + system prompt builder
- `functions/src/lib/tools.ts` — keep (KB tools already exist, just confirm they work in streamMessage flow)

---

### Task 1: Anthropic provider implementation

**Files:**
- Create: `functions/src/lib/ai/anthropic.ts`

- [ ] **Step 1: Branch off + ensure Anthropic SDK is installed**

```bash
cd ~/dev/work/zzem-wiki
git checkout main && git pull
git checkout -b plan/team-chat-3-ai-providers
cd functions
ls node_modules/@anthropic-ai/sdk 2>/dev/null && echo "SDK present" || npm install @anthropic-ai/sdk
cd ..
```

- [ ] **Step 2: Write Anthropic adapter**

`functions/src/lib/ai/anthropic.ts`:

```ts
import Anthropic from "@anthropic-ai/sdk";
import { ANTHROPIC_API_KEY } from "../secrets";
import type {
  AIProvider, ProviderMessage, ProviderTool,
  StreamEvent, ToolCall, ToolResult,
} from "./types";

const PRIMARY_MODEL = "claude-sonnet-4-6";
const FALLBACK_MODEL = "claude-haiku-4-5";

let _client: Anthropic | null = null;
function client(): Anthropic {
  if (!_client) _client = new Anthropic({ apiKey: ANTHROPIC_API_KEY.value() });
  return _client;
}

export class AnthropicProvider implements AIProvider {
  name = "anthropic" as const;
  model = PRIMARY_MODEL;

  async *streamMessage(input: {
    system: string;
    messages: ProviderMessage[];
    tools: ProviderTool[];
    onToolCall?: (call: ToolCall) => Promise<ToolResult>;
    maxTokens?: number;
  }): AsyncIterable<StreamEvent> {
    const tools: Anthropic.Tool[] = input.tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.inputSchema as Anthropic.Tool["input_schema"],
    }));
    if (tools.length > 0) {
      tools[tools.length - 1] = {
        ...tools[tools.length - 1]!,
        cache_control: { type: "ephemeral" },
      };
    }

    const messages: Anthropic.MessageParam[] = input.messages.map((m) => ({
      role: m.role === "tool" ? "user" : m.role,
      content: m.content,
    }));

    const systemBlocks: Anthropic.TextBlockParam[] = [
      { type: "text", text: input.system, cache_control: { type: "ephemeral" } },
    ];

    let totalIn = 0, totalOut = 0, totalCacheRead = 0;
    const sourcesUsed: { type: string; id: string; why?: string }[] = [];
    let finalText = "";
    let toolUseId = "";
    let toolUseName = "";
    let toolUseInputJson = "";

    const stream = await client().messages.stream({
      model: PRIMARY_MODEL,
      max_tokens: input.maxTokens ?? 4096,
      thinking: { type: "adaptive" },
      system: systemBlocks,
      tools: tools.length > 0 ? tools : undefined,
      messages,
    });

    for await (const event of stream) {
      if (event.type === "message_start") {
        // Usage available on .usage
      } else if (event.type === "content_block_start") {
        if (event.content_block.type === "tool_use") {
          toolUseId = event.content_block.id;
          toolUseName = event.content_block.name;
          toolUseInputJson = "";
          yield { type: "tool_use_start", id: toolUseId, name: toolUseName, input: {} };
        }
      } else if (event.type === "content_block_delta") {
        if (event.delta.type === "text_delta") {
          finalText += event.delta.text;
          yield { type: "text_delta", text: event.delta.text };
        } else if (event.delta.type === "input_json_delta") {
          toolUseInputJson += event.delta.partial_json;
        }
      } else if (event.type === "content_block_stop") {
        if (toolUseId && input.onToolCall) {
          let parsed: Record<string, unknown> = {};
          try { parsed = JSON.parse(toolUseInputJson || "{}"); } catch {}
          const result = await input.onToolCall({ name: toolUseName, input: parsed });
          yield { type: "tool_use_end", id: toolUseId, result: result.output };
          // Tool result becomes part of next message in agent loop — handled outside.
          // For Phase 1 streamMessage, we feed results back in a separate Anthropic call.
          // (See streamMessage refactor in Task 5 below.)
          toolUseId = "";
        }
      } else if (event.type === "message_delta") {
        if (event.usage) {
          totalIn += event.usage.input_tokens ?? 0;
          totalOut += event.usage.output_tokens ?? 0;
          totalCacheRead += (event.usage as { cache_read_input_tokens?: number }).cache_read_input_tokens ?? 0;
        }
      }
    }

    const finalMessage = await stream.finalMessage();
    yield {
      type: "done",
      usage: { input: totalIn, output: totalOut, cacheRead: totalCacheRead },
      finalText,
      sourcesUsed,
      finishReason:
        finalMessage.stop_reason === "max_tokens"
          ? "max_tokens"
          : finalMessage.stop_reason === "tool_use"
          ? "tool_use_max"
          : "end_turn",
    };
  }
}

export const ANTHROPIC_FALLBACK_MODEL = FALLBACK_MODEL;
```

Note: this provider streams a SINGLE turn. For multi-turn agent loops with tool calls, the Cloud Function (`streamMessage`) coordinates: when it receives a `tool_use_end`, it appends the assistant + tool_result messages and re-invokes the provider. This keeps the provider stateless. See Task 5 for the agent loop wiring.

- [ ] **Step 3: Build**

```bash
cd functions && npm run build && cd ..
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add functions/src/lib/ai/anthropic.ts
git commit -m "ai: AnthropicProvider — Sonnet 4.6 + adaptive thinking + cache_control + StreamEvent translation"
```

---

### Task 2: Wrtn provider placeholder

**Files:**
- Create: `functions/src/lib/ai/wrtn.ts`
- Modify: `functions/src/lib/secrets.ts`

- [ ] **Step 1: Add WRTN secrets**

In `functions/src/lib/secrets.ts`:

```ts
import { defineSecret } from "firebase-functions/params";

export const ANTHROPIC_API_KEY = defineSecret("ANTHROPIC_API_KEY");
export const GITHUB_TOKEN      = defineSecret("GITHUB_TOKEN");
export const GITHUB_OWNER      = defineSecret("GITHUB_OWNER");
export const GITHUB_REPO       = defineSecret("GITHUB_REPO");
export const SLACK_WEBHOOK_URL = defineSecret("SLACK_WEBHOOK_URL");
export const WRTN_AI_API_KEY   = defineSecret("WRTN_AI_API_KEY");
export const WRTN_AI_ENDPOINT  = defineSecret("WRTN_AI_ENDPOINT");
```

- [ ] **Step 2: Write Wrtn placeholder**

`functions/src/lib/ai/wrtn.ts`:

```ts
import type { AIProvider, ProviderMessage, ProviderTool, StreamEvent, ToolCall, ToolResult } from "./types";
import { WRTN_AI_API_KEY, WRTN_AI_ENDPOINT } from "../secrets";

/**
 * Wrtn internal AI gateway provider — placeholder until API spec lands.
 *
 * To implement:
 * 1. Confirm wire format: OpenAI-compatible / Anthropic-compatible / custom
 * 2. Implement HTTP client with WRTN_AI_API_KEY auth
 * 3. Translate the gateway's streaming format into StreamEvent
 * 4. Map tool-use protocol (tools array, tool_call events, tool_result message)
 *
 * Until then, this throws clearly so callers know what's needed.
 */
export class WrtnProvider implements AIProvider {
  name = "wrtn" as const;
  model = "wrtn-internal";

  async *streamMessage(_input: {
    system: string;
    messages: ProviderMessage[];
    tools: ProviderTool[];
    onToolCall?: (call: ToolCall) => Promise<ToolResult>;
    maxTokens?: number;
  }): AsyncIterable<StreamEvent> {
    // Read secrets to surface missing-config issues clearly when this is invoked.
    const endpoint = WRTN_AI_ENDPOINT.value();
    const key = WRTN_AI_API_KEY.value();
    if (!endpoint || !key) {
      throw new Error(
        "Wrtn provider invoked but WRTN_AI_ENDPOINT or WRTN_AI_API_KEY is missing. " +
        "Set both via `firebase functions:secrets:set`.",
      );
    }
    throw new Error(
      "WrtnProvider.streamMessage is not yet implemented. " +
      "API spec required to write the adapter — capture wire format (request body, " +
      "streaming chunk shape, tool_use protocol) and replace this throw with a real impl.",
    );
    // Once implemented, the body must yield StreamEvent items matching the
    // contract in `functions/src/lib/ai/types.ts`.
    // Reference implementations: anthropic.ts (this folder).
  }
}
```

- [ ] **Step 3: Build**

```bash
cd functions && npm run build && cd ..
```

Expected: PASS (even with the unreachable code after `throw`, TS is happy because of `async function*`).

- [ ] **Step 4: Commit**

```bash
git add functions/src/lib/ai/wrtn.ts functions/src/lib/secrets.ts
git commit -m "ai: WrtnProvider placeholder — interface stub, throws until API spec is wired"
```

---

### Task 3: System prompt builder + provider factory wiring

**Files:**
- Create: `functions/src/lib/ai/system-prompt.ts`
- Modify: `functions/src/lib/ai/index.ts`

- [ ] **Step 1: System prompt builder**

`functions/src/lib/ai/system-prompt.ts`:

```ts
import { getIndex, summarizeForPrompt } from "../kb-index";

const ROLE = `You are the wrtn team operations assistant. Answer questions during work using the team KB and your general knowledge.

Rules:
- Be concise — under 400 words unless the question genuinely requires more.
- If the KB doesn't cover the question, say so explicitly.
- Cite KB sources when you use them. List source paths in plain prose, not as a separate JSON block.
- Don't invent KB items. If a tool returns nothing, say so.

When asked about specific code paths, files, or implementation details outside the KB, you may use general knowledge — but flag uncertainty.`.trim();

export async function buildSystemPrompt(): Promise<string> {
  const idx = await getIndex().catch(() => []);
  const indexLines = idx.length > 0 ? summarizeForPrompt(idx) : "(KB index unavailable — answer from general knowledge.)";
  return [
    ROLE,
    "",
    "## KB index (path \\t metadata JSON)",
    indexLines,
  ].join("\n");
}
```

- [ ] **Step 2: Update provider factory**

`functions/src/lib/ai/index.ts`:

```ts
import type { AIProvider } from "./types";
import { MockAIProvider } from "./mock";
import { AnthropicProvider } from "./anthropic";
import { WrtnProvider } from "./wrtn";

export function getProvider(): AIProvider {
  const name = process.env.AI_PROVIDER ?? "mock";
  switch (name) {
    case "mock":      return new MockAIProvider();
    case "anthropic": return new AnthropicProvider();
    case "wrtn":      return new WrtnProvider();
    default:
      throw new Error(`unknown AI_PROVIDER: ${name}`);
  }
}
```

- [ ] **Step 3: Build**

```bash
cd functions && npm run build && cd ..
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add functions/src/lib/ai/system-prompt.ts functions/src/lib/ai/index.ts
git commit -m "ai: system prompt builder + provider factory wires Mock/Anthropic/Wrtn"
```

---

### Task 4: Tests for Anthropic + Wrtn providers

**Files:**
- Create: `functions/src/lib/__tests__/anthropic-provider.test.ts`
- Create: `functions/src/lib/__tests__/wrtn-provider.test.ts`

- [ ] **Step 1: Anthropic test (mocked SDK)**

`functions/src/lib/__tests__/anthropic-provider.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@anthropic-ai/sdk", () => {
  let calls = 0;
  return {
    default: class {
      messages = {
        stream: vi.fn(async () => {
          calls++;
          return makeFakeStream();
        }),
      };
    },
  };
});

vi.mock("../secrets", () => ({
  ANTHROPIC_API_KEY: { value: () => "test-key" },
}));

import { AnthropicProvider } from "../ai/anthropic";

function makeFakeStream() {
  const events = [
    { type: "message_start" },
    { type: "content_block_start", content_block: { type: "text", text: "" } },
    { type: "content_block_delta", delta: { type: "text_delta", text: "Hello " } },
    { type: "content_block_delta", delta: { type: "text_delta", text: "world" } },
    { type: "content_block_stop" },
    { type: "message_delta", usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0 } },
  ];
  return {
    [Symbol.asyncIterator]: async function* () { for (const e of events) yield e; },
    finalMessage: async () => ({ stop_reason: "end_turn", usage: { input_tokens: 10, output_tokens: 5 } }),
  };
}

beforeEach(() => vi.clearAllMocks());

describe("AnthropicProvider", () => {
  it("translates Anthropic stream events to StreamEvent", async () => {
    const provider = new AnthropicProvider();
    const out: unknown[] = [];
    for await (const e of provider.streamMessage({
      system: "test",
      messages: [{ role: "user", content: "hi" }],
      tools: [],
    })) {
      out.push(e);
    }
    const types = out.map((e) => (e as { type: string }).type);
    expect(types).toContain("text_delta");
    expect(types[types.length - 1]).toBe("done");
    const done = out[out.length - 1] as { finalText: string; finishReason: string };
    expect(done.finalText).toBe("Hello world");
    expect(done.finishReason).toBe("end_turn");
  });
});
```

- [ ] **Step 2: Wrtn placeholder test**

`functions/src/lib/__tests__/wrtn-provider.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";

vi.mock("../secrets", () => ({
  WRTN_AI_API_KEY: { value: () => "test-key" },
  WRTN_AI_ENDPOINT: { value: () => "https://wrtn.example/ai" },
}));

import { WrtnProvider } from "../ai/wrtn";

describe("WrtnProvider (placeholder)", () => {
  it("throws not-implemented", async () => {
    const p = new WrtnProvider();
    const it = p.streamMessage({ system: "", messages: [], tools: [] });
    await expect(it.next()).rejects.toThrow(/not yet implemented/i);
  });
});
```

- [ ] **Step 3: Run tests**

```bash
cd functions && npm test 2>&1 | tail -8
```

Expected: total ~14+ tests pass (mock provider 3 + kb-index 3 + tools 6 + anthropic 1 + wrtn 1 + earlier).

- [ ] **Step 4: Commit**

```bash
git add functions/src/lib/__tests__/anthropic-provider.test.ts functions/src/lib/__tests__/wrtn-provider.test.ts
git commit -m "test: anthropic provider stream translation + wrtn placeholder"
```

---

### Task 5: Wire KB tools into streamMessage with agent loop

**Files:**
- Modify: `functions/src/chat/streamMessage.ts`

The current Plan 2 `streamMessage` calls the provider once. With tools, we need an agent loop: provider streams, if it requests a tool, dispatch it, append results, re-invoke provider until `done`. This applies only when `AI_PROVIDER=anthropic|wrtn` (Mock has no tool calls).

- [ ] **Step 1: Refactor streamMessage to support agent loop**

Full updated `functions/src/chat/streamMessage.ts`:

```ts
import { onRequest } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import { getProvider } from "../lib/ai";
import { buildSystemPrompt } from "../lib/ai/system-prompt";
import { TOOLS, dispatch as dispatchTool } from "../lib/tools";
import { consumeOrThrow, RateLimitError } from "../lib/rate-limit";
import {
  ANTHROPIC_API_KEY, GITHUB_OWNER, GITHUB_REPO, GITHUB_TOKEN,
  WRTN_AI_API_KEY, WRTN_AI_ENDPOINT,
} from "../lib/secrets";
import type { ProviderMessage, ProviderTool, StreamEvent } from "../lib/ai/types";

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

const HISTORY_LIMIT = 20;
const MAX_AGENT_TURNS = 6;

export const streamMessage = onRequest(
  {
    region: "asia-northeast3",
    timeoutSeconds: 120,
    memory: "512MiB",
    cors: true,
    secrets: [
      ANTHROPIC_API_KEY, GITHUB_OWNER, GITHUB_REPO, GITHUB_TOKEN,
      WRTN_AI_API_KEY, WRTN_AI_ENDPOINT,
    ],
  },
  async (req, res) => {
    if (req.method !== "POST") return res.status(405).json({ error: "POST required" });

    const idToken = (req.headers.authorization ?? "").replace(/^Bearer\s+/i, "");
    if (!idToken) return res.status(401).json({ error: "Authorization missing" });

    let decoded;
    try { decoded = await admin.auth().verifyIdToken(idToken); }
    catch { return res.status(401).json({ error: "invalid token" }); }
    if (!decoded.email?.endsWith("@wrtn.io")) return res.status(403).json({ error: "@wrtn.io only" });
    const uid = decoded.uid;

    const cid = (req.body as { cid?: string })?.cid;
    if (!cid) return res.status(400).json({ error: "cid required" });

    try { await consumeOrThrow(uid); }
    catch (e) {
      if (e instanceof RateLimitError) return res.status(429).json({ error: e.message });
      throw e;
    }

    const cref = db.doc(`conversations/${cid}`);
    const csnap = await cref.get();
    if (!csnap.exists) return res.status(404).json({ error: "conversation not found" });
    const conv = csnap.data()!;
    if (conv.ownerUid !== uid) return res.status(403).json({ error: "not owner" });

    const msgsSnap = await cref.collection("messages").orderBy("createdAt", "desc").limit(HISTORY_LIMIT).get();
    const initialHistory: ProviderMessage[] = msgsSnap.docs.map((d) => d.data())
      .reverse()
      .filter((m) => m.role === "user" || m.role === "assistant" || m.role === "human")
      .map((m) => ({
        role: m.role === "human" ? "user" : (m.role as "user" | "assistant"),
        content: m.content as string,
      }));

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders?.();

    const provider = getProvider();
    const system = await buildSystemPrompt();
    const tools: ProviderTool[] = TOOLS.map((t) => ({
      name: t.name,
      description: t.description ?? "",
      inputSchema: t.input_schema as object,
    }));

    let history = [...initialHistory];
    let totalIn = 0, totalOut = 0, totalCacheRead = 0;
    let finalText = "";
    let toolCallCount = 0;
    let finishReason: StreamEvent extends infer T ? T extends { type: "done"; finishReason: infer F } ? F : never : never = "end_turn";
    const sourcesUsed: { type: string; id: string; why?: string }[] = [];

    try {
      for (let turn = 0; turn < MAX_AGENT_TURNS; turn++) {
        let turnFinishedWithToolCall = false;
        const turnToolCalls: { id: string; name: string; input: Record<string, unknown>; result: unknown }[] = [];

        for await (const event of provider.streamMessage({
          system,
          messages: history,
          tools,
          onToolCall: async (call) => {
            const result = await dispatchTool(call.name, call.input);
            turnToolCalls.push({ id: "", name: call.name, input: call.input, result });
            toolCallCount++;
            return { toolCallId: "", output: result };
          },
        })) {
          res.write(`data: ${JSON.stringify(event)}\n\n`);
          if (event.type === "text_delta") finalText += event.text;
          if (event.type === "tool_use_start") turnFinishedWithToolCall = true;
          if (event.type === "done") {
            totalIn += event.usage.input;
            totalOut += event.usage.output;
            totalCacheRead += event.usage.cacheRead;
            finishReason = event.finishReason;
          }
        }

        if (!turnFinishedWithToolCall) break;
        // Append assistant turn (text so far + tool requests) and tool results to history,
        // then loop for the next turn.
        history = [
          ...history,
          { role: "assistant", content: finalText || "(tool use)" },
          ...turnToolCalls.map((tc) => ({
            role: "tool" as const,
            content: `Tool ${tc.name} result: ${JSON.stringify(tc.result).slice(0, 8000)}`,
          })),
        ];
        finalText = ""; // reset for next turn (the final turn's text is what we keep)
      }
    } catch (e) {
      finishReason = "error";
      res.write(`data: ${JSON.stringify({ type: "done", usage: { input: totalIn, output: totalOut, cacheRead: totalCacheRead }, finalText, sourcesUsed, finishReason: "error", error: (e as Error).message })}\n\n`);
    }

    if (finalText) {
      await cref.collection("messages").add({
        role: "assistant",
        content: finalText,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        authorUid: "ai",
        ai: {
          sourcesUsed,
          tokenUsage: { input: totalIn, output: totalOut, cacheRead: totalCacheRead },
          toolCalls: toolCallCount,
          finishReason,
        },
      });

      await cref.update({
        messageCount: admin.firestore.FieldValue.increment(1),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        "ai.provider": provider.name,
        "ai.model": provider.model,
        "ai.totalTokens.input": admin.firestore.FieldValue.increment(totalIn),
        "ai.totalTokens.output": admin.firestore.FieldValue.increment(totalOut),
        "ai.totalTokens.cacheRead": admin.firestore.FieldValue.increment(totalCacheRead),
      });

      if (msgsSnap.size <= 2) {
        const firstUser = initialHistory.find((m) => m.role === "user");
        if (firstUser) {
          const title = firstUser.content.slice(0, 40).replace(/\s+/g, " ").trim();
          if (title) await cref.update({ title });
        }
      }
    }

    res.end();
  },
);
```

- [ ] **Step 2: Build**

```bash
cd functions && npm run build && cd ..
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add functions/src/chat/streamMessage.ts
git commit -m "functions: streamMessage agent loop — KB tools dispatched, ≤6 turns, tool results re-fed to provider"
```

---

### Task 6: LOCAL CHECKPOINT — verify Mock still works after refactor

The agent loop change in Task 5 affects all providers. Verify Mock still works (no regression).

- [ ] **Step 1: Restart emulator + dev**

```bash
# Terminal 1
cd functions && rm -rf lib && npm run build && cd ..
# Restart emulator (Ctrl-C in its terminal, then re-run)
npm run emulator

# Terminal 2 — re-seed (clears + re-creates):
npm run seed

# Terminal 3
npm run dev
```

- [ ] **Step 2: Manual verification (Mock provider)**

In `.env.local`, ensure NO `AI_PROVIDER` is set (defaults to `mock`).

1. Sign in as alice → click "Team onboarding question" → type "rate limit"
2. Should see streaming response (Mock keyword match for rate-limit)
3. Conversation `messageCount` updates, assistant message appears in Firestore

- [ ] **Step 3: Switch to Anthropic provider locally (optional, requires personal key)**

```bash
# Set provider + key as Cloud Function env (when running locally with emulator,
# functions emulator picks up `functions/.env` or process env)
echo 'AI_PROVIDER=anthropic' > functions/.env.local
echo 'ANTHROPIC_API_KEY=sk-ant-...' >> functions/.env.local

# Restart functions emulator (firebase emulators uses functions/.env*)
# In the emulator terminal: Ctrl-C, then `npm run emulator` again
```

Note: Firebase functions emulator reads `.env` and `.env.<project>` files in `functions/`. For Anthropic local dev:

`functions/.secret.local` (a file format the emulator picks up for secret values):

```
ANTHROPIC_API_KEY=sk-ant-actual-key
```

And `functions/.env` for non-secret config:

```
AI_PROVIDER=anthropic
```

(Refer to Firebase emulator docs for the exact loading mechanism in your version. Alternatively, set environment variables in the shell that runs the emulator.)

Restart the emulator. Send a message in the chat — you should see real Claude streaming, with KB tool calls visible (the Mock canned responses are gone; real responses come through).

- [ ] **Step 4: Verify with Mock again to ensure default still works**

Remove the `AI_PROVIDER=anthropic` line, restart emulator, verify Mock responses come back.

- [ ] **Step 5: Commit checkpoint notes**

No code change needed; just confirm both providers work end-to-end. If Anthropic key isn't accessible, the Mock checkpoint is enough — Anthropic verification is pure follow-up.

---

### Task 7: Push + PR

- [ ] **Step 1: Push**

```bash
git push -u origin plan/team-chat-3-ai-providers
gh pr create --base main --head plan/team-chat-3-ai-providers \
  --title "feat: real AI providers + KB tools (Plan 3)" \
  --body "Plan 3 of team chat redesign.

Adds:
- AnthropicProvider (Sonnet 4.6 + adaptive thinking + cache_control)
- WrtnProvider placeholder (interface stub; throws until API spec is wired)
- System prompt builder with KB index summary
- streamMessage agent loop (≤6 turns, KB tool dispatch, tool results re-fed)
- Tests for both new providers

Local checkpoint passes:
- Mock provider still works (no regression after agent loop refactor)
- Anthropic provider works locally with personal key (verified by hand)
- Wrtn provider throws with clear message (placeholder)"
```

---

## Self-review notes

- **Spec coverage:** §4 AI integration (provider abstraction ✓, Mock + Anthropic + Wrtn ✓, system prompt with cache layout ✓, KB tools wired ✓, agent loop with 6-turn cap ✓). §4 "past shared conversations" — implementation deferred until Plan 4 creates `shared-conversations`. The tool definition + dispatcher entry are wired with stub returning `[]` (preserves the contract).
- **Stream event translation:** Anthropic's streaming protocol has more event types than our minimal `StreamEvent`. We map `content_block_delta(text)` → `text_delta`, `content_block_start(tool_use)` → `tool_use_start`, etc. Tool input arrives as `input_json_delta` chunks; we accumulate then parse on `content_block_stop`.
- **Wrtn deferral:** the placeholder reads its secrets at invocation time so missing-config produces a clear error rather than a generic "not implemented." When the spec arrives, the impl-guidance comment in the file points at exactly what changes.
- **Multi-turn agent loop:** lives in `streamMessage` rather than inside the provider — keeps providers stateless and parallel-safe. The cost is duplicated logic if we ever add a non-tool-using single-turn API surface; for Phase 1 this isn't an issue.
- **`onToolCall` signature:** providers receive a callback for tool dispatch, but the agent loop in `streamMessage` re-issues the provider call with tool results in history. The Anthropic adapter's `onToolCall` is invoked on `content_block_stop` for `tool_use` blocks; the agent loop captures the call/result for the NEXT turn's history. The provider yields `tool_use_end` so the client SSE consumer can render "AI is using a tool" UI hints (Phase 2 polish).
- **Provider tests are unit-level** (mocked SDK). End-to-end with real Anthropic is verified via the local checkpoint (Task 6 step 3). E2E in CI would require a CI-only Anthropic key — Phase 2 followup.
