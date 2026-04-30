# Team Q&A Wiki

- **Date**: 2026-04-30
- **Status**: Draft — awaiting implementation plan
- **Owner**: zach-wrtn

## Problem

Team members generate questions every day during work — about product behavior, schemas, past decisions, ops procedures, edge cases. Today these questions and their answers are scattered across Slack threads, DMs, Notion comments, and verbal hallway exchanges. The same question gets re-asked every few weeks. The answers, when given, are not preserved in any form that:

1. **Humans can search** when they hit the same question later, or
2. **Orchestrator agents can consume** when they need that context to do their job.

`zzem-knowledge-base` is the team's machine-readable SSOT and is already consumed by orchestrator agents through schema-validated content (`learning/`, `products/`). It does not yet have a place for free-form operational Q&A — the kind of knowledge that doesn't fit a pattern, rubric, PRD, or event spec.

## Goals

1. A custom UI where any `@wrtn.io` member can ask a question, receive an AI-drafted answer grounded in the existing KB, edit the draft, and request a domain-owner review.
2. Approved Q&A is committed to this repo (`learning/qa/qa-{NNN}.md`) so it becomes a first-class KB asset readable by both humans and agents.
3. The system reinforces itself: as more Q&A is approved, future AI drafts get better KB context to retrieve from.

### Non-goals

- StackOverflow-style multi-answer voting (conflicts with AI-first single-canonical-answer model).
- Public access — `@wrtn.io` only, all reads gated.
- Real-time collaborative editing of drafts (single editor per draft; Phase 2 adds non-blocking comments).
- Replacing Slack as the place where ad-hoc questions originate. The wiki is for questions worth preserving, not every utterance.
- Replacing the existing `learning/patterns/`, `products/{product}/` flows. Q&A is additive.

## Decisions Summary

| # | Decision | Choice |
|---|----------|--------|
| Q1 | Primary consumer | Hybrid — humans search, agents retrieve |
| Q2 | Authoring interface | Custom mini UI (not Notion/Slack/PR) |
| Q3 | UI core value | AI-first answers with human approval |
| Q4 | SSOT location | Git repo for approved Q&A; Firestore for live state only |
| Q5 | Repo placement | Single `learning/qa/` directory + `scope` frontmatter field |
| Q6 | Approval workflow | Domain owner 1-person review; draft is single-editor |
| Q7 | AI integration | Agentic retrieval (tool-use) with Sonnet 4.6 + prompt caching |
| Q8 | Auth & ownership | Google SSO `@wrtn.io` + `qa-owners.yaml` in repo |
| Q9 | MVP scope | All features (D), delivered in 3 phases |
| — | Stack | Next.js on Firebase Hosting + Firestore + Cloud Functions + Firebase Auth |

## Design

### §1. System Architecture

```
[ Browser (Next.js App Router on Firebase Hosting) ]
   │
   ├─ Auth: Firebase Auth (Google SSO, @wrtn.io enforced)
   │
   ├─ Read live state ──→ [ Firestore ]
   │   (questions, drafts, comments, votes, notifications)
   │
   └─ RPC ──→ [ Cloud Functions (HTTPS callable) ]
                  │
                  ├─ generateDraft     → Anthropic SDK (Sonnet 4.6 + prompt caching, agentic tool-use)
                  │                      └─ KB context loaded from this repo (working copy or GitHub Contents API)
                  │
                  ├─ requestReview     → Slack webhook (mention domain owner)
                  │
                  ├─ approveAndCommit  → Octokit commit to learning/qa/qa-{NNN}.md
                  │                      └─ qa-owners.yaml routing, schema validation, atomic commit
                  │
                  └─ syncStaleness     → Cloud Scheduler (weekly), DM domain owners on stale Q&A

[ GitHub repo (zzem-knowledge-base) ]
   ├─ learning/qa/qa-{NNN}.md          ← approved Q&A (this tool writes)
   ├─ learning/qa-owners.yaml          ← human-managed, PR-only
   └─ schemas/learning/qa.schema.json  ← new
```

**Boundary principle: Git is SSOT, Firestore is volatile workspace.**

- Approved Q&A → `learning/qa/qa-{NNN}.md` in this repo. Consumed via existing `zzem-kb:read` skill (extended to know about `qa` type).
- In-progress work (drafts, review queue, comments, votes, notifications) → Firestore. Lives until approval, then archived.
- The single moment both systems write the same fact is `approveAndCommit` — race-narrowed to one Cloud Function.
- AI keys and GitHub commit tokens never touch the browser. All sensitive ops behind Cloud Functions.

### §2. Data Model

#### Firestore (volatile)

```
/questions/{qid}
  text: string                    # 1-line title
  body: string                    # optional full body
  scope: 'global' | 'ai-webtoon' | 'free-tab' | 'ugc-platform'
  askerUid: string
  status: 'drafting' | 'review_requested' | 'approved' | 'rejected' | 'archived'
  currentDraftId: string
  createdAt, updatedAt: timestamp
  approvedQaId: string?           # filled at approval, e.g. 'qa-042'

/questions/{qid}/drafts/{did}
  body: markdown
  editorUid: string
  ai: {
    model: string,                # e.g. 'claude-sonnet-4-6'
    sourcesUsed: [{ type: 'pattern'|'prd'|'event'|'qa', id, excerpt }],
    tokenUsage: { input, output, cacheRead, cacheWrite },
    confidence: 'high'|'medium'|'low',
    caveats: string[],
    draftedAt: timestamp
  }
  version: int                    # immutable; new draft doc per edit

/questions/{qid}/comments/{cid}
  body, authorUid, createdAt

/qa-records/{qa-id}               # live meta for approved Q&A (post-commit)
  scope, ownerUids: [uid]         # snapshot at commit time
  voteCount: int                  # "still valid" thumbs-up
  lastVerifiedAt: timestamp
  staleAfterDays: int             # default 90

/notifications/{nid}
  toUid, type, payload, sentAt, readAt?

/users/{uid}
  email, displayName, avatarUrl   # cached from auth token
```

**Security rules summary**

- All reads/writes require `request.auth.token.email.endsWith('@wrtn.io')`.
- `questions/{qid}` write: only askerUid (own questions only).
- `questions/{qid}/status: 'approved'` transition: clients cannot set this directly — only the `approveAndCommit` Cloud Function can.
- `qa-records/*` writes: Cloud Function only.
- `users/{uid}`: written on first sign-in by an auth-trigger function.

#### Repo asset: `learning/qa/qa-{NNN}.md`

```yaml
---
id: qa-042
question: "When does the free-tab filter diversification experiment end?"
scope: free-tab
asker: alice@wrtn.io
approver: zach@wrtn.io
approved_at: 2026-04-30
last_verified_at: 2026-04-30
status: active                    # active | deprecated | superseded
superseded_by: qa-051             # only if status: superseded
related:
  patterns: [correctness-006]
  prds: [free-tab/filter-diversification]
  events: [meme-app-home]
  qa: [qa-017]
ai:
  model: claude-sonnet-4-6
  sources_used:
    - { type: prd, id: free-tab/filter-diversification }
    - { type: pattern, id: correctness-006 }
tags: [experiment, rollout]
---

## Question
(original question text, including any clarifying body)

## Answer
(approved answer, free markdown)

## References
- (optional, for human-curated reference links beyond `related:`)
```

#### `learning/qa-owners.yaml`

```yaml
scopes:
  global:       [zach@wrtn.io]
  ai-webtoon:   [zach@wrtn.io, alice@wrtn.io]
  free-tab:     [bob@wrtn.io]
  ugc-platform: [carol@wrtn.io]
admins:         [zach@wrtn.io]    # may approve any scope (still cannot self-approve)
```

#### New schema: `schemas/learning/qa.schema.json`

JSON Schema covering the frontmatter above. Wired into `validate:learning` script alongside existing pattern/reflection/rubric validators.

### §3. Q&A Lifecycle & Data Flow

#### State transitions

```
drafting ──► review_requested ──► approved ──► (stale alerts ──► verify | deprecate | supersede)
   ▲                │
   └── rejected ────┘
```

- **drafting**: asker iterating on AI draft. Each edit creates a new immutable `drafts/{did}` doc. Multi-turn AI redrafts allowed (asker can request "regenerate with this constraint").
- **review_requested**: Slack DM/mention sent to domain owner(s) per `qa-owners.yaml`. Question appears in owner queue UI.
- **approved**: `approveAndCommit` runs. Question moves to permanent KB. Firestore record marked archived but retained for audit.
- **rejected**: owner returns to `drafting` with mandatory comment. Asker iterates and re-requests review.
- **stale**: scheduled function flags Q&A whose `lastVerifiedAt + staleAfterDays < now`. Owner DM with three actions: verify (frontmatter PR), edit (manual PR), deprecate/supersede (status change PR).

#### `approveAndCommit` mechanics

1. Cloud Function loads latest draft + question + frontmatter inputs.
2. Lists `learning/qa/` via GitHub API to find next available `qa-{NNN}` number.
3. Builds the `.md` file content from a template.
4. Validates against `qa.schema.json` locally (ajv).
5. Commits directly to `main` (allowed by repo rules for content-only paths) via Octokit.
6. On SHA conflict, retries up to 3 times (re-fetches next number).
7. On success: sets `questions.status = approved`, `approvedQaId = qa-NNN`, creates `/qa-records/{qa-NNN}`, sends asker confirmation, optionally posts to a `#qa-feed` Slack channel.
8. On terminal failure: rolls back Firestore status, surfaces error to owner with diagnostic.

#### Invariants

- **No write to repo before approval.** All editing happens in Firestore.
- **Repo is monotonic from this tool's side.** UI never modifies or deletes existing `qa-*.md` files. Humans can still PR-edit them (deprecate, supersede, fix typos).
- **Drafts are immutable.** Edit = new draft doc. Provides full audit of "what AI said vs what human shipped."
- **Votes and verification dates live in Firestore forever.** They never trigger commits — only actual content changes do.

### §4. AI Integration

#### Tool surface (Anthropic tool-use)

The model is given exactly four tools, all backed by Cloud Function readers over the repo:

```ts
list_kb_files({ scope?, type?: 'pattern'|'prd'|'event'|'qa' })
  → [{ path, frontmatter_summary }]      // returns metadata only, not bodies

read_kb_file({ path })
  → { frontmatter, body }

grep_kb({ pattern, scope?, type? })
  → [{ path, line, snippet }]

list_related_qa({ scope, keywords })
  → [{ qa_id, question, answer_excerpt, approved_at }]
```

The model decides which to call. Loop bounded at 6 turns and 4096 output tokens. KB reads come from a working copy of this repo cached in the Cloud Function (refreshed on GitHub `push` webhook).

#### Prompt caching layout

Anthropic's 4 cache breakpoints used as follows:

| Layer | Content | Refresh |
|-------|---------|---------|
| 1 | System prompt: role, output JSON schema, safety rules | Rarely (deploy) |
| 2 | Tool definitions | Rarely (deploy) |
| 3 | KB meta-index: full file tree + per-file frontmatter summary (no bodies) | On `push` webhook |
| 4 | (reserved; per-question content goes uncached) | — |

Target cache hit rate: ≥ 90% on layers 1–3. Per-question call carries only the question text, scope, and asker context as fresh tokens.

#### Output contract

The model's final assistant message must end with this JSON block (enforced via system prompt + parsing):

```json
{
  "answer_markdown": "## ... \n ...",
  "sources_used": [
    { "type": "prd", "id": "free-tab/filter-diversification", "why": "..." },
    { "type": "pattern", "id": "correctness-006", "why": "..." }
  ],
  "confidence": "high",
  "caveats": ["KB has no info on X — needs human verification"]
}
```

`confidence` and `caveats` surface directly in the asker/owner UI as the primary review signals. `sources_used` populates the draft's `related:` candidates.

#### Cost & rate guards

- Anthropic key in GCP Secret Manager; Cloud Function runtime access only.
- Per-user limit: 3 draft generations / minute (Cloud Function token bucket).
- Tool-call cap: 6 turns per draft.
- Token usage logged per draft for cost analysis.
- Sonnet 4.6 with 1× retry → Haiku 4.5 fallback on persistent 5xx. Fallback fact recorded in `ai.model`.

#### When KB has no answer

If tool calls return nothing relevant, model still returns a draft scaffold with `confidence: "low"` and `caveats` listing what's missing. This:
- Avoids the worst case (asker stares at empty editor).
- Surfaces KB gaps as a measurable signal — Phase 3 builds a "low-confidence Q&A" dashboard from this.

### §5. Phased Delivery

D-scope (all features) split into three phases. Each phase has a kill criterion before starting the next.

**Phase 1 — Core loop (~3–4 weeks)**
- Ask, AI draft, edit, request review, owner approve/reject, commit.
- Google SSO + Firestore security rules.
- `qa-owners.yaml` routing, `qa.schema.json`, `validate:learning` integration.
- Slack notification on review request and on approval.
- In-UI search of approved Q&A (Firestore basic keyword index).
- `zzem-kb:read` skill extended for `qa` type.
- **Kill criterion**: < 5 approved Q&A by week 4 → reassess concept.

**Phase 2 — Collaboration & quality (~2–3 weeks)**
- Comments on drafts (non-blocking owner feedback).
- "Still valid" voting on approved Q&A → bumps `voteCount` and `lastVerifiedAt`.
- Embedding-based similarity (Vertex AI embeddings + Firestore vector search) for duplicate detection at submit time.
- AI fallback / retry / cache-hit metrics dashboard.

**Phase 3 — Stewardship (~2–3 weeks)**
- Stale-check scheduler (weekly Cloud Scheduler cron).
- Supersede workflow — new Q&A replaces old; both frontmatters auto-updated.
- KB-gap dashboard (low-confidence + frequently-asked-but-no-answer clusters).
- Usage analytics (active askers/owners per scope, time-to-approve).

**Explicit non-build**: multi-answer voting / SO-style ranking. Conflicts with AI-first single-answer model. Revisit only with explicit decision.

### §6. Error Handling

| Failure | Handling |
|---------|----------|
| Anthropic 5xx | 1× retry → Haiku fallback → manual-write mode if still failing |
| Anthropic rate limit | Backoff + Cloud Tasks queue serialization |
| GitHub SHA conflict | Up to 3 retries with number reallocation |
| Schema validation fail | Block commit, log reason on `questions`, return to drafting |
| Slack webhook fail | Record `failedAt` on notification doc; cron retries |
| Missing scope mapping in qa-owners.yaml | Block approval, route to `admins` |
| Self-approval attempt (asker == approver) | Blocked even for `admins` |
| Token bucket exceeded | UI shows wait, no draft created |
| Cloud Function timeout mid-commit | Firestore status remains `review_requested`; manual operator playbook documented |

### §7. Testing Strategy

**Unit**
- Schema validation (ajv).
- `qa-owners.yaml` routing logic (scope → owner UIDs).
- Next-number allocation.
- Cache key construction for prompt caching layers.
- Tool definition shape (matches Anthropic schema).

**Integration**
- Cloud Functions emulator + Firestore emulator: full lifecycle ask → draft → approve → commit.
- GitHub commit step uses test repo or mocked Octokit.
- Anthropic responses use canned tool-use sequences (deterministic).

**Contract**
- `qa.schema.json` integrated into existing `npm run validate:learning`.
- New fixtures in `tests/fixtures/qa/`: `valid.md`, `invalid-missing-scope.md`, `invalid-bad-scope-enum.md`, `invalid-superseded-without-target.md`.

**Observability**
- Cloud Logging for every `approveAndCommit` (qid, qa-id, scope, approver, token usage).
- Latency P50/P95 for `generateDraft`.
- Tool-call distribution.
- Cache hit rate from `cache_read_input_tokens` in Anthropic responses.

**Out of scope**
- Load testing — team scale (tens of users, tens of questions/day) doesn't warrant it.

## Open Questions

These do not block writing the implementation plan; they are flagged for resolution during build.

1. **Slack channel for `#qa-feed`** — should approved Q&A auto-broadcast somewhere visible to the whole team, or be silent with opt-in subscriptions per scope? Recommend: silent + per-scope opt-in subscription pattern in Phase 2.
2. **Migration of historical Q&A** — does the team want to seed `learning/qa/` with retroactive entries from existing Slack/Notion? Out of scope for Phase 1; consider standalone import script later.
3. **`related:` coverage** — currently lists `patterns`, `prds`, `events`, `qa`. The KB also has `reflections` and `rubrics` already; should Q&A be able to link to those? Likely yes — add to schema before Phase 1 ships.
4. **Anonymous-asker mode** — for sensitive operational questions. Default off; revisit if requested.

## Risks

- **AI hallucination passes review** — domain owner review is the only gate. Mitigation: `confidence` + `caveats` + `sources_used` surface in review UI; retrospective pattern: log Q&A that get edited/superseded soon after approval as a quality signal.
- **Owner queue becomes a bottleneck** — single-owner scopes with one busy person. Mitigation: `admins` fallback; Phase 2 metrics will show queue age; can split scope or add owners via `qa-owners.yaml` PR.
- **Q&A becomes stale silently** — long tail of "approved long ago, no one revisits." Mitigation: Phase 3 stale-check is the primary fix; voting in Phase 2 is a leading indicator.
- **Cost overrun** — Sonnet 4.6 + agentic loop with 6 turns can be expensive at scale. Mitigation: prompt caching on KB index (largest token block), per-user rate limit, token usage dashboard from day one.
