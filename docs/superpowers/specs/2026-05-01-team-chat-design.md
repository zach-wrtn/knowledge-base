# Team Chat (Real-Time Q&A) Design

- **Date**: 2026-05-01
- **Status**: Draft — supersedes `docs/superpowers/specs/2026-04-30-team-qa-wiki-design.md`
- **Owner**: zach-wrtn

## Why this supersedes the prior spec

The 2026-04-30 spec framed the system as a "Q&A wiki" — a curation pipeline where every question goes through AI draft → human edit → owner approval → KB commit. That direction was wrong. The team needs a system where members ask questions while working and receive answers in real time. Curation is optional, not the primary flow.

Rewriting the spec rather than patching, because the workflow change cascades: data model, UI, Cloud Functions, security rules, and the very framing of "what is the artifact" all change.

## Problem

Team members at wrtn generate questions every day during work — about product behavior, schemas, past decisions, ops procedures, edge cases. Today these are scattered across Slack DMs, channels, and verbal exchanges. The same question gets re-asked because there's no easy way to retrieve a past good answer. Asking a domain expert directly often blocks on their availability.

We need a system that:

1. **Answers immediately** when a team member has a work question — no approval queue, no async wait.
2. **Grounds answers in the team's actual knowledge** (existing KB, past good conversations) so the AI doesn't hallucinate.
3. **Lets a human step in** when the AI is wrong, uncertain, or out of its depth.
4. **Captures good answers** as a team asset so the same question doesn't re-cost.
5. **Keeps private things private** — most work questions are individual; only valuable answers should reach the team.

## Goals

1. A web chat UI where any `@wrtn.io` member can start a multi-turn conversation with an AI assistant grounded in the team's KB and past shared conversations.
2. Streaming responses so the user sees output as it generates (real-time UX, not "wait then read").
3. A one-click "ask a human" escalation that grants a designated person access to the conversation and notifies them via Slack.
4. A one-click "share to team" that snapshots the conversation, generates an AI summary + embedding, and makes it discoverable in `/feed` and `/search`.
5. Default-private posture: conversations are visible only to the asker (and people they explicitly escalate to or share with).

### Non-goals

- StackOverflow-style multi-answer voting on a single question (we have one assistant primarily; voting goes on shared conversations as quality signal in Phase 2).
- Replacing Slack for ad-hoc team chat. The wiki is for "I want a grounded answer right now" not "let's discuss this together."
- Auto-curating answers without human consent. Sharing is an explicit, opt-in action.
- Offline / no-AI fallback. The system requires the AI provider to be available; degradation is documented but not papered over.
- Public / external access. `@wrtn.io` only.

## Decisions Summary

| # | Decision | Choice |
|---|----------|--------|
| Q1 | Surface | Custom Web chat UI |
| Q2 | Visibility | Default private (1:1 user↔AI), explicit "share to team" |
| Q3 | Responder | AI primary + user-initiated human escalation |
| Q4 | Conversation shape | Multi-turn ChatGPT-style (one conversation = many messages) |
| Q5 | AI grounding | KB + AI general knowledge + past shared conversations (E in old brainstorm) |
| Q6 | Code as a source | Phase 2 (extends KB tools to repo files; design open) |
| Q7 | AI provider | Wrtn internal model gateway (key-based) for production; abstraction layer supports Mock + Anthropic + Wrtn |
| Q8 | Local testing | Mock provider works without any keys; UI/flow fully exercisable locally with Firebase Emulator Suite |

## Design

### §1. System Architecture

**Principle: Firestore is live state, AI provider streams responses, KB grounds answers, "share" is explicit.**

```
[ Browser (Next.js App Router on Firebase App Hosting) ]
   │
   ├─ Auth: Firebase Auth (Google SSO, @wrtn.io enforced)
   │
   ├─ Read live state ──→ [ Firestore ]
   │   conversations, messages, shared-conversations, escalations, users
   │
   └─ HTTP streaming ──→ [ Cloud Functions ]
                            │
                            ├─ streamMessage      → AIProvider (Mock | Anthropic | Wrtn)
                            │                       └─ KB tools (4: list/read/grep/related)
                            │                       └─ Past shared conversations (top-K via Vertex AI embedding)
                            │
                            ├─ shareConversation  → AI summary + embedding + Firestore batch
                            │
                            ├─ escalateToHuman    → escalation record + Slack DM + access grant
                            │
                            ├─ searchShared       → Vertex AI embedding + Firestore findNearest
                            │
                            └─ mirrorUserProfile  → auth-trigger user-doc cache (existing)

[ External services ]
   ├─ AI provider (Wrtn internal endpoint OR Anthropic OR Mock)
   ├─ Vertex AI (text-embedding-005, 768 dim)
   ├─ Slack (incoming webhook for escalation/share notifications)
   └─ KB GitHub repo (read-only — Octokit, no commits)
```

**Boundary principles**

- **Browser writes user messages directly** to Firestore (optimistic, fast). AI responses always written by Cloud Function (security: AI keys never reach browser).
- **AI is behind a provider interface.** Cloud Function code knows nothing about Anthropic vs Wrtn vs Mock — env-controlled.
- **KB read-only.** Old approval pipeline committed to KB repo; new design only reads. The KB GitHub PAT only needs `Contents: Read`.
- **Shared snapshots are immutable.** Once a conversation is shared, the snapshot is frozen at that moment — even if the underlying conversation continues evolving.

### §2. Data Model

#### Firestore (live)

```
/conversations/{cid}
  ownerUid: string
  title: string                # auto-generated from first user message; user-editable
  status: 'active' | 'escalated' | 'ended' | 'shared'
  createdAt, updatedAt: timestamp
  messageCount: int            # cached for list display
  scope?: 'global' | 'ai-webtoon' | 'free-tab' | 'ugc-platform'
  shared: bool                 # true once shareConversation fires; status syncs to 'shared'
  sharedConvId?: string        # → shared-conversations/{sid}
  escalationId?: string        # → escalations/{eid} (currently active escalation)
  ai: {
    provider: 'mock' | 'anthropic' | 'wrtn'
    model: string
    totalTokens: { input, output, cacheRead }
  }

/conversations/{cid}/messages/{mid}
  role: 'user' | 'assistant' | 'system' | 'human'
  content: string              # markdown
  createdAt: timestamp
  authorUid: string            # 'ai' for assistant; uid for user/human
  authorEmail?: string         # rendered when role='human'
  ai?: {                       # role='assistant' only
    sourcesUsed: [{ type, id, why? }]
    tokenUsage: { input, output, cacheRead }
    toolCalls: int
    finishReason: 'end_turn' | 'tool_use_max' | 'max_tokens' | 'error'
  }

/shared-conversations/{sid}
  fromCid: string
  ownerUid, ownerEmail
  title: string                # editable at share time
  summary: string              # AI-generated, ~150 chars, editable at share time
  body: string                 # full conversation as plain text (search fallback)
  scope?: string
  tags: string[]               # user-added or AI-extracted
  embedding: number[]          # 768d
  embeddingModel: string       # 'text-embedding-005'
  tokens: string[]             # keyword fallback
  sharedAt: timestamp
  voteCount: int               # default 0 (Phase 2 wires)
  lastVerifiedAt: timestamp    # default = sharedAt; cron updates (Phase 3)

/escalations/{eid}
  cid: string                  # target conversation
  fromUid, fromEmail
  toUid, toEmail               # required — user picks
  notification: { sentAt, channel?, ts? }
  status: 'pending' | 'acknowledged' | 'responded' | 'resolved'
  createdAt: timestamp
  respondedAt?: timestamp

/users/{uid}                   # unchanged
  email, displayName, avatarUrl, createdAt

/notifications/{nid}           # reused — escalation/share broadcast log
/rate-limits/{uid}             # reused — token bucket (Cloud Function only)
```

#### Removed collections (vs prior spec)

- `questions`, `questions/{qid}/drafts`, `questions/{qid}/comments` — replaced by conversations/messages
- `qa-records` — replaced by shared-conversations

#### Security rules (summary)

```
isWrtn() = auth != null && email_verified && email matches @wrtn.io
isOwner(uid) = isWrtn() && auth.uid == uid

/conversations/{cid}
  read   = isOwner(resource.data.ownerUid)
            OR resource.data.shared == true
            OR exists escalations/{eid} where eid.cid == cid AND eid.toUid == auth.uid
  create = isWrtn() && resource.data.ownerUid == auth.uid && status == 'active'
  update = isOwner(resource.data.ownerUid) (for title, scope, ending)
  delete = isOwner(resource.data.ownerUid)

/conversations/{cid}/messages/{mid}
  read   = (parent conv read permission)
  create = isOwner(parent.ownerUid) && role == 'user'
            OR (auth.uid is in active escalation for parent) && role == 'human'
            OR (Cloud Function only — admin SDK bypasses for role='assistant')
  update, delete = false

/shared-conversations/{sid}
  read   = isWrtn()
  write  = false (Cloud Function only)

/escalations/{eid}
  read   = isOwner(resource.data.fromUid) || isOwner(resource.data.toUid)
  write  = false (Cloud Function only)
```

### §3. Conversation Lifecycle & Data Flow

```
[ user clicks "new chat" ]
        │
        ▼
   active ────── multi-turn back-and-forth with AI (streaming)
        │
        ├──[ "ask a human" ]──→ escalated ──→ active OR ended
        ├──[ "share to team" ]─→ shared (and stays shared; can keep chatting)
        └──[ "end" or 30d idle ]→ ended (read-only)
```

#### User message → AI response flow

1. Client writes `{ role: 'user', content }` to `messages` (optimistic).
2. Client calls `streamMessage` Cloud Function (HTTP, SSE response).
3. Function:
   1. Rate-limit check (5 messages/min/user).
   2. Authorization (caller is conversation owner).
   3. Load most recent N messages (default 20) for context.
   4. Build system prompt (rules + KB index + top-K shared conversations for this scope).
   5. `provider.streamMessage(messages, tools, onToolCall)` — async iterable.
   6. Stream `text_delta` events to client over SSE.
   7. If provider emits `tool_use_start`, dispatch via KB tools, feed result back.
   8. On `done`, write final `{ role: 'assistant', content, ai: {...} }` to messages and update `conversation.updatedAt + ai.totalTokens`.
4. Client reads SSE; on disconnect, re-subscribes via `onSnapshot` for the final message.

#### Share flow

1. User clicks "share to team" → modal.
2. Cloud Function calls AI once: "summarize this conversation as: 1-line title + 1-paragraph summary + 3 tag candidates."
3. Show preview to user (editable).
4. On confirm:
   - Vertex AI embedding on `summary + body` (768d).
   - Firestore batch:
     - Create `shared-conversations/{sid}`.
     - Update conversation: `shared=true`, `sharedConvId`, `status='shared'`.
   - Optional Slack `#qa-feed` broadcast (configurable).

#### Escalation flow

1. User clicks "ask a human" → modal: pick recipient (user search or scope-based suggestion).
2. Cloud Function:
   - Create `escalations/{eid}`.
   - Update conversation: `status='escalated'`, `escalationId`.
   - Slack DM to recipient with link `https://app/c/{cid}?from=escalation`.
3. Recipient opens link → security rules grant read access via the escalation record → can add `role='human'` message in the existing conversation.
4. Asker resolves with "resolved" button → `status='active'` (or `'ended'` if the user is done).

#### Invariants

- AI responses are written only by Cloud Functions. User messages can be written by clients. Human escalation messages can be written by escalation recipients (not arbitrary users).
- Shared snapshot is frozen at share time; underlying conversation continues independently.
- Escalation is a permission grant. Removing access (resolve / unescalate) revokes the read window.
- Deletion of a conversation cascades to its messages and escalations; shared snapshots are kept (team asset preservation; ownerEmail masked if user requests).

### §4. AI Integration

#### Provider abstraction

```ts
// functions/src/lib/ai/provider.ts
export interface AIProvider {
  name: 'mock' | 'anthropic' | 'wrtn';
  streamMessage(input: {
    system: string | TextBlock[];
    messages: ProviderMessage[];
    tools: ProviderTool[];
    onToolCall: (call: ToolCall) => Promise<ToolResult>;
  }): AsyncIterable<StreamEvent>;
}

type StreamEvent =
  | { type: 'text_delta'; text: string }
  | { type: 'tool_use_start'; name: string; input: object }
  | { type: 'tool_use_end'; result: object }
  | { type: 'done'; usage: TokenUsage; finalText: string; sourcesUsed: SourceRef[] };
```

Selection: env var `AI_PROVIDER` ∈ `mock | anthropic | wrtn`.

#### Mock Provider — local-first

- No keys required. Works against Firebase Emulator Suite immediately.
- Streams canned responses based on user message keyword matches (e.g., greeting → friendly hello, "rate limit" → example answer, fallback → "Mock AI: KB has no answer").
- Simulates tool calls (returns synthetic file lists / grep hits).
- 50ms inter-token delay to simulate real streaming UX.
- Used for: UI development, CI E2E, demos, debugging frontend without burning AI budget.

#### Anthropic Provider — dev override

- Reuses Plan 3 code: Sonnet 4.6, adaptive thinking, Anthropic streaming → `StreamEvent` translation.
- KB tools 4 from Plan 3 + `list_related_shared_conversations` (renamed from `list_related_qa`, hits the same shared-conversations vector index).
- Dev-only path: contributors who want real AI quality during local dev set `AI_PROVIDER=anthropic` + their personal `ANTHROPIC_API_KEY`.

#### Wrtn Internal Provider — production

- Adapter calls Wrtn's internal AI gateway with `WRTN_AI_API_KEY` (secret).
- API spec is TBD at design time; implementation is a 1–2 day adapter once the spec lands. Interface contract is the same `StreamEvent` AsyncIterable so swapping is opaque to the rest of the function.
- Exact endpoint, auth header style, tool-use protocol shape, and SSE format → captured when adapter is written.

#### System prompt structure (cache layout)

| Layer | Content | Cacheable | Refresh |
|-------|---------|-----------|---------|
| 1 | Role + rules + output expectations | ✓ ephemeral | Rarely |
| 2 | KB meta-index (file tree + frontmatter summaries) | ✓ ephemeral | On KB push webhook (Phase 2) |
| 3 | Top-K relevant shared conversations (this scope) | ✗ uncached | Per turn |
| 4 | Multi-turn message history | ✗ uncached | Per turn |

Phase 1 keeps layer 3 uncached for simplicity. Optimization for cache friendliness is a Phase 2 followup.

#### KB tools

| Tool | Behavior |
|------|----------|
| `list_kb_files` | List KB files with metadata, optional scope/type filters |
| `read_kb_file` | Read a specific KB file (truncated to 32KB) |
| `grep_kb` | Substring search across KB bodies, returns up to 50 hits |
| `list_related_shared_conversations` | Vector search over `shared-conversations.embedding` filtered by scope |

Code source tools (`read_repo_file`, `grep_repo`, `search_symbol`) — Phase 2.

#### Streaming mechanism

- Cloud Functions v2 `onRequest` with chunked HTTP response.
- `Content-Type: text/event-stream`, `Cache-Control: no-cache`.
- Each `StreamEvent` serialized as `data: {...}\n\n`.
- Client uses `fetch` + `ReadableStream` reader (works in Next.js App Router).
- Auth: Firebase Auth ID token in `Authorization: Bearer <token>` header — Cloud Function verifies and extracts uid.

#### Cost / rate guards

- Per-user 5 messages/min (Plan 3 token bucket reused).
- Conversation history cap 20 turns; older messages dropped from context (still kept in Firestore for display).
- Tool-call cap 6 per response.
- `max_tokens` 4096 per response.

#### Behavior when KB has no answer

- Provider's response surfaces `confidence: low` (or equivalent) → Cloud Function records this on the assistant message.
- Client UI shows a prominent "ask a human" CTA on low-confidence responses.

### §5. Escalation

(See §3 flow diagram.) Notable details:

- Recipient picker: search by email/name OR scope-based suggestion (e.g., user picks scope → system suggests scope owners from a config; for Phase 1, the config can be a hardcoded mapping in a `team-config.yaml` shipped with the app — KB's `qa-owners.yaml` is gone; new file lives elsewhere or rolls into env config).
- Notification: Phase 1 uses a Slack incoming webhook posting to a single `#qa-escalations` channel with the recipient `@`-mentioned, plus question summary + link. (True per-user DMs need a Slack bot token + `chat.postMessage` — Phase 2 followup if the channel-mention approach proves too noisy.)
- Access grant: enforced via `escalations/{eid}.toUid == auth.uid` rule. Recipient's read on `conversations/{cid}` and `messages` works while escalation is `pending|acknowledged|responded`. When `resolved`, the read window closes (escalation record kept for audit).
- Recipient response: writing a `role='human'` message in the same `messages` collection. Same-thread, no separate "comment" surface.
- Auto-escalation on low confidence: not in Phase 1 (always user-initiated; the UI just makes the CTA more visible on low confidence).

### §6. Share to Team

(See §3 flow.) Notable details:

- Summary generation: a one-shot AI call (same provider, same `streamMessage` infra, but consumed synchronously) that returns: title, summary, tag candidates, scope guess.
- Editable preview: user can override title/summary/tags/scope before confirming.
- Embedding: `text-embedding-005`, 768d, on `summary + body`.
- Snapshot is permanent: the original conversation continues to live independently.
- Re-share: future shares of the same conversation create new `shared-conversations/{sid}` docs (versioned by time). UI shows "shared 2 times" badge.
- Unshare: original sharer can delete the snapshot. Cascade: shared-conversations doc + parent conversation `shared=false`, `sharedConvId` cleared.

### §7. Feed & Search

- `/` (home): "new chat" button + recent personal conversations + 5 most recent team-shared.
- `/c/[cid]`: single conversation chat (multi-turn UI, streaming).
- `/me`: user's conversations (active / escalated / ended / shared).
- `/feed`: chronological list of `shared-conversations` (descending by `sharedAt`). Filter by scope, tag (Phase 2).
- `/feed/[sid]`: read-only shared snapshot.
- `/search`: text input → Vertex AI embedding → Firestore `findNearest` (COSINE) over `shared-conversations.embedding`. Top-10 with similarity score and scope filter (Phase 2).

### §8. Auth & Permissions

(See §2 security rules summary.) Stack stays as Plan 2:

- Firebase Auth, Google SSO, `@wrtn.io` domain enforcement (client + auth-trigger Cloud Function defense in depth).
- `mirrorUserProfile` auth trigger reused as-is.
- Wrtn AI gateway key (`WRTN_AI_API_KEY`) and Anthropic key (`ANTHROPIC_API_KEY`, optional dev) in Firebase Secret Manager.

### §9. Phased Delivery

**Phase 1 — Local-first MVP (3–4 weeks)**

Working software, single-user testable from day one via Mock provider:

- Provider abstraction (Mock + Anthropic + Wrtn placeholder)
- Firebase emulator + seed for local development
- Conversation data model + Firestore rules
- `streamMessage` Cloud Function with SSE
- KB tools 4 (Plan 3 reused)
- UI: `/`, `/chat` (or just first-message inline), `/c/[cid]`, `/me`, `/feed`, `/search`
- `shareConversation`, `escalateToHuman` Cloud Functions
- Slack notification (escalation only; broadcast configurable)
- Embedding generation on share + Vertex AI vector search

**Kill criterion**: < 5 active users by week 4 OR < 10 conversations/day average → reassess.

**Phase 2 — Quality & Extension (~3 weeks)**

- Code-source agentic retrieval (read_repo_file, grep_repo, search_symbol)
- Shared-conversation voting (`voteCount`, lastVerifiedAt updated)
- AI metrics dashboard (token usage, cache hit, escalation rate, low-confidence rate)
- 30-day idle → automatic `ended` (Cloud Scheduler weekly cron)
- Cache-friendly system prompt restructure (move shared-convs context into a cacheable layer)

**Phase 3 — Operations (~3 weeks)**

- Stale-shared check (lastVerifiedAt + threshold → owner DM)
- User feedback loop (👍/👎 on assistant messages → tuning data)
- KB-gap dashboard (frequently-searched, low-confidence → topics needing KB authoring)
- Search quality analytics (zero-result queries → product signal)

### §10. Salvage vs Scrap (Existing Work)

Five PRs from the prior direction:

| PR | Repo | Decision |
|----|------|----------|
| #14 — KB qa schema, qa-owners | knowledge-base (merged) | **Revert** — `learning/qa/`, `learning/qa-owners.yaml`, `schemas/learning/qa.schema.json`, `schemas/learning/qa-owners.schema.json`, `scripts/validate-qa-owners.mjs`, README/skill changes. New design doesn't use any of these. |
| #15 — deploy runbook | knowledge-base | **Close** — superseded by a new runbook for the chat redesign. |
| #16 — Phase 2A embeddings | knowledge-base | **Close** — was scoped to `qa-records` which doesn't exist anymore. New embedding plan targets `shared-conversations` (same Vertex AI infra; different data model). |
| zzem-qa-wiki #1 — foundation | zzem-qa-wiki | **Merge** — reusable scaffold (Next.js, auth, shadcn, Firebase glue). Data model in `src/types/qa.ts` will be replaced post-merge. |
| zzem-qa-wiki #2 — AI integration | zzem-qa-wiki | **Partial merge** — keep KB tools, Anthropic SDK integration, secrets infra. `generateDraft` Cloud Function will be replaced by `streamMessage`. |
| zzem-qa-wiki #3 — approval pipeline | zzem-qa-wiki | **Close** — entirely scrapped. requestReview / approveAndCommit / rejectDraft / qa-owners.yaml routing / qa-validate / qa-commit / search-tokens / Slack approval helpers all gone. |

**Salvageable code (~40%):**

- `src/lib/firebase/{client,auth-provider}.ts` (with emulator support added in `dev/emulator-mode` branch)
- `src/components/ui/*` (shadcn primitives)
- `src/app/{login,layout}.tsx`
- `functions/src/lib/{secrets,anthropic,octokit,kb-index,tools,rate-limit}.ts`
- `functions/src/auth/mirrorUserProfile.ts`
- Firebase project setup, secrets infrastructure, emulator config, seed pattern
- `firebase.json`, `.env.local.example`, `.firebaserc` (when added)

**Replaced or removed code (~60%):**

- `src/types/qa.ts` → `src/types/conversation.ts`
- `src/lib/firebase/db.ts` → `src/lib/firebase/chat.ts`
- `src/components/qa/*` → `src/components/chat/*`
- `src/app/{ask,my,q/[qid],queue,search}/*` → `src/app/{c/[cid],me,feed,search}/*`
- `functions/src/draft/generateDraft.ts` → `functions/src/chat/streamMessage.ts`
- `functions/src/review/*`, `functions/src/lib/{qa-validate,qa-commit,slack,search-tokens,draft-output}.ts` → removed

The redesign isn't blocked by any merge order: a fresh branch off `main` (post-foundation merge) with the new data model and UI is the cleanest path.

### §11. Error Handling

| Failure | Handling |
|---------|----------|
| AI provider 5xx | Provider-internal retry (1×) → mark assistant message `finishReason: 'error'`; user can retry from UI |
| AI rate limit | Function returns 429; UI shows wait + retry-after timer |
| KB tool failure | Tool result reports error; AI continues with what it has; logged for ops |
| GitHub Octokit failure (KB read) | Tool returns synthetic empty result; AI proceeds without that source; logged |
| Vertex AI embedding failure on share | Share blocked; user sees error + retry. Conversation unchanged. |
| Vertex AI failure on search | Fallback to keyword tokens (`tokens` array on `shared-conversations`) |
| Slack webhook failure on escalation | Escalation record still created; recipient sees it on next visit; webhook failure logged on `notifications/{nid}.failedAt` |
| SSE stream interrupted | Client reconnects via `onSnapshot`; final message arrives via Firestore once Cloud Function completes |
| Cloud Function timeout mid-stream | Partial assistant message saved; UI shows "interrupted, retry" |
| User token bucket exceeded | Function returns 429 before any provider call |

### §12. Testing Strategy

**Unit (vitest):**
- Provider implementations (Mock fully testable; Anthropic adapter testable with stubbed SDK; Wrtn adapter testable with HTTP mock)
- KB tools dispatcher
- Embedding source composer
- Rate limiter
- Schema rules logic (e.g., escalation access)

**Integration:**
- Firebase emulator + seed → full chat lifecycle end-to-end with Mock provider (no external deps)
- Functions emulator runs `streamMessage` against Mock provider
- Playwright E2E for: login, new chat, send message → see streaming response, share, escalate, search

**Provider parity:**
- Same test suite runs against Mock and (if present) Anthropic, asserting identical event shapes per turn
- Wrtn adapter gets a separate suite when the API spec arrives

**Out of scope:**
- Load testing — team-scale traffic (tens of users, ~hundreds of messages/day) doesn't warrant it
- Cross-browser testing — internal tool, modern Chrome/Safari sufficient

## Open Questions (non-blocking)

1. **Wrtn internal AI gateway API spec** — is it OpenAI-compatible / Anthropic-compatible / custom? Adapter design depends on this. Current decision: Wrtn provider is a placeholder until spec is in hand; Mock + Anthropic ship in Phase 1.
2. **Scope owner config location** — old design used `learning/qa-owners.yaml` in KB. New design needs equivalent for "who can be escalated to per scope." Options: (a) keep a config file in this app's repo, (b) hardcode in code, (c) Firestore `team-config` collection. Recommend (a) for git tracking, but punt to implementation phase.
3. **Slack workspace integration** — webhook to a single channel for Phase 1. Per-user DMs (real Slack integration with bot token) is Phase 2 if needed.
4. **Anonymity / sensitive questions** — currently not supported. If need arises, add `anonymousAsk: bool` flag on conversation.

## Risks

- **AI cost overrun under unmoderated free use** — Mitigation: per-user rate limit, max tokens, cache strategy; Phase 2 dashboard.
- **Wrtn gateway API instability or unexpected shape** — Mitigation: provider abstraction means production Anthropic fallback is a config flip if needed (provided keys exist).
- **Privacy violation via accidental share** — Mitigation: explicit confirmation modal with preview; "unshare" is permanent and immediate.
- **Escalation SLA unclear** — culture issue, not a software issue. Mitigation: escalation status visible to both parties; cron reminder if no response in 24h (Phase 2).
- **KB drift** — if the KB repo content changes meaningfully, the AI's grounded answers may go stale. Mitigation: Phase 2 KB push webhook → cache invalidation; Phase 3 stale-check on shared answers.
