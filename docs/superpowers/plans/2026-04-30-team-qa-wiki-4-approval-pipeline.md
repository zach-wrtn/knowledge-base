# Team Q&A Wiki — Plan 4: Approval Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the Phase 1 loop: askers can request review, owners get Slack notifications, owners can approve/reject in-UI, approval commits the Q&A to `zzem-knowledge-base/learning/qa/qa-{NNN}.md` via Octokit (with schema validation and SHA-conflict retry), and approved Q&A is searchable in-UI.

**Architecture:** Three new Cloud Functions (`requestReview`, `approveAndCommit`, `rejectDraft`) own all state-changing transitions out of `drafting`. Firestore rules block client-side `approved` writes; Cloud Functions write with Admin SDK and bypass rules. Slack notifications go through an incoming-webhook URL stored in Secret Manager. Owner queue UI lists `review_requested` questions filtered by the signed-in owner's scopes loaded from `learning/qa-owners.yaml`. In-UI search uses a lightweight prefix-token index in Firestore (added at commit time).

**Tech Stack:** Same as Plan 3 + `@octokit/rest` (existing), Slack incoming webhooks (no SDK needed), `ajv` 2020 for schema validation in the function.

**Spec:** `zzem-knowledge-base/docs/superpowers/specs/2026-04-30-team-qa-wiki-design.md` §3 (lifecycle), §4 (review states), §6 (error handling).

**Prerequisites:** Plans 1, 2, 3 merged. `learning/qa-owners.yaml` exists. `qa.schema.json` exists. Wiki app deployed with auth + draft generation.

**Repo context:** All file paths relative to `zzem-qa-wiki` unless explicitly prefixed with `zzem-knowledge-base/`.

---

## File Structure

**Create — Cloud Functions:**
- `functions/src/lib/owners.ts` — load + parse `qa-owners.yaml` from KB repo
- `functions/src/lib/slack.ts` — webhook helper + message templates
- `functions/src/lib/qa-validate.ts` — ajv compiled with `qa.schema.json`
- `functions/src/lib/qa-commit.ts` — frontmatter assembly, next-number scan, Octokit commit + retry
- `functions/src/lib/search-tokens.ts` — generate denormalized search tokens for Firestore
- `functions/src/review/requestReview.ts`
- `functions/src/review/approveAndCommit.ts`
- `functions/src/review/rejectDraft.ts`

**Modify — Cloud Functions:**
- `functions/src/index.ts` — export new functions

**Create — App:**
- `src/lib/firebase/owners.ts` — fetch owners file (cached)
- `src/components/qa/review-queue.tsx`
- `src/components/qa/review-actions.tsx`
- `src/components/qa/search-bar.tsx`

**Modify — App:**
- `src/app/page.tsx` — add Review Queue tile + Search tile
- `src/app/q/[qid]/page.tsx` — add "Request review" + owner approve/reject panel
- `src/app/queue/page.tsx` — owner review queue
- `src/app/search/page.tsx` — search approved Q&A
- `firestore.rules` — tighten approved/review transitions
- `firestore.indexes.json` — add search index field config
- `functions/package.json` — add `ajv-formats`, `ajv` (likely present already via gray-matter chain — verify)

**Create — tests:**
- `functions/src/lib/__tests__/qa-validate.test.ts`
- `functions/src/lib/__tests__/qa-commit.test.ts` (mocked Octokit)
- `functions/src/lib/__tests__/owners.test.ts`
- `tests/e2e/full-lifecycle.spec.ts`

---

### Task 1: Owners file loader

**Files:**
- Create: `functions/src/lib/owners.ts`
- Create: `functions/src/lib/__tests__/owners.test.ts`

- [ ] **Step 1: Install yaml + ajv**

```bash
cd functions
npm install ajv@^8 ajv-formats@^3 js-yaml@^4
npm install -D @types/js-yaml
cd ..
```

- [ ] **Step 2: Write loader**

`functions/src/lib/owners.ts`:
```ts
import yaml from "js-yaml";
import { readFile } from "./octokit";

export interface OwnersDoc {
  schema_version: 1;
  scopes: {
    global: string[];
    "ai-webtoon": string[];
    "free-tab": string[];
    "ugc-platform": string[];
  };
  admins: string[];
}

export type Scope = keyof OwnersDoc["scopes"];

let cached: { at: number; doc: OwnersDoc } | null = null;
const TTL_MS = 5 * 60 * 1000; // 5 minutes

export async function getOwners(): Promise<OwnersDoc> {
  if (cached && Date.now() - cached.at < TTL_MS) return cached.doc;
  const raw = await readFile("learning/qa-owners.yaml");
  const doc = yaml.load(raw) as OwnersDoc;
  cached = { at: Date.now(), doc };
  return doc;
}

export function ownersForScope(doc: OwnersDoc, scope: Scope): string[] {
  return Array.from(new Set([...(doc.scopes[scope] ?? []), ...doc.admins]));
}

export function isOwnerOf(doc: OwnersDoc, scope: Scope, email: string): boolean {
  return ownersForScope(doc, scope).includes(email);
}

export function clearOwnersCache() { cached = null; }
```

- [ ] **Step 3: Write tests**

`functions/src/lib/__tests__/owners.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../octokit", () => ({
  readFile: async () => `
schema_version: 1
scopes:
  global:       [a@wrtn.io]
  ai-webtoon:   [a@wrtn.io, b@wrtn.io]
  free-tab:     [c@wrtn.io]
  ugc-platform: [d@wrtn.io]
admins:         [a@wrtn.io]
`,
  repoCoords: () => ({ owner: "x", repo: "y" }),
}));

import { clearOwnersCache, getOwners, ownersForScope, isOwnerOf } from "../owners";

beforeEach(() => clearOwnersCache());

describe("owners", () => {
  it("admins are unioned into every scope's owners", async () => {
    const doc = await getOwners();
    expect(ownersForScope(doc, "free-tab").sort()).toEqual(["a@wrtn.io", "c@wrtn.io"]);
  });

  it("isOwnerOf respects scope + admin overlap", async () => {
    const doc = await getOwners();
    expect(isOwnerOf(doc, "ai-webtoon", "b@wrtn.io")).toBe(true);
    expect(isOwnerOf(doc, "ai-webtoon", "c@wrtn.io")).toBe(false);
    expect(isOwnerOf(doc, "ugc-platform", "a@wrtn.io")).toBe(true); // admin
  });
});
```

- [ ] **Step 4: Run tests**

```bash
cd functions && npm test && cd ..
```

Expected: 2 passing in this file + earlier total.

- [ ] **Step 5: Commit**

```bash
git add functions/src/lib/owners.ts functions/src/lib/__tests__/owners.test.ts functions/package.json functions/package-lock.json
git commit -m "functions: owners loader (5min cache) + admin union"
```

---

### Task 2: QA schema validator

**Files:**
- Create: `functions/src/lib/qa-validate.ts`
- Create: `functions/src/lib/__tests__/qa-validate.test.ts`

- [ ] **Step 1: Vendor the schema (read at build time)**

The Cloud Function shouldn't fetch the schema from GitHub on every commit — it must validate against the version of the schema deployed *with* the function. Vendor it as a JSON import.

```bash
mkdir -p functions/src/schemas
curl -fsSL https://raw.githubusercontent.com/zach-wrtn/knowledge-base/main/schemas/learning/qa.schema.json \
  -o functions/src/schemas/qa.schema.json
```

If your KB repo is private, copy from local instead:
```bash
cp ~/dev/work/zzem-knowledge-base/schemas/learning/qa.schema.json functions/src/schemas/qa.schema.json
```

Add a top-level note: this file is a *vendored copy*. To refresh, re-run the copy + redeploy the function. Keep deliberate — schema bumps are explicit.

- [ ] **Step 2: Add JSON resolver to tsconfig**

In `functions/tsconfig.json`, add `resolveJsonModule: true`:
```json
"compilerOptions": {
  ...,
  "resolveJsonModule": true,
  "esModuleInterop": true
}
```

- [ ] **Step 3: Write validator**

`functions/src/lib/qa-validate.ts`:
```ts
import Ajv from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import schema from "../schemas/qa.schema.json";

const ajv = new Ajv({ strict: false, allErrors: true });
addFormats(ajv);
const compiled = ajv.compile(schema as object);

export interface QAFrontmatter {
  id: string;
  question: string;
  scope: "global" | "ai-webtoon" | "free-tab" | "ugc-platform";
  asker: string;
  approver: string;
  approved_at: string;
  last_verified_at: string;
  status: "active" | "deprecated" | "superseded";
  superseded_by?: string;
  related?: { patterns?: string[]; prds?: string[]; events?: string[]; qa?: string[]; reflections?: string[]; rubrics?: string[] };
  ai: { model: string; sources_used: { type: string; id: string; why?: string }[] };
  tags?: string[];
  schema_version: 1;
}

export class QAValidationError extends Error {
  errors: unknown;
  constructor(errors: unknown) { super("qa frontmatter validation failed"); this.errors = errors; }
}

export function validateQa(fm: unknown): asserts fm is QAFrontmatter {
  if (!compiled(fm)) throw new QAValidationError(compiled.errors);
}
```

- [ ] **Step 4: Write tests**

`functions/src/lib/__tests__/qa-validate.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { validateQa, QAValidationError } from "../qa-validate";

const valid = {
  id: "qa-001",
  question: "When does free-tab end?",
  scope: "free-tab",
  asker: "a@wrtn.io",
  approver: "b@wrtn.io",
  approved_at: "2026-04-30T00:00:00Z",
  last_verified_at: "2026-04-30T00:00:00Z",
  status: "active",
  ai: { model: "claude-sonnet-4-6", sources_used: [] },
  schema_version: 1,
};

describe("qa schema validator", () => {
  it("accepts a valid frontmatter", () => {
    expect(() => validateQa({ ...valid })).not.toThrow();
  });
  it("rejects missing scope", () => {
    const { scope: _scope, ...rest } = valid;
    expect(() => validateQa(rest)).toThrow(QAValidationError);
  });
  it("rejects superseded without superseded_by", () => {
    expect(() => validateQa({ ...valid, status: "superseded" })).toThrow(QAValidationError);
  });
  it("accepts superseded with superseded_by", () => {
    expect(() => validateQa({ ...valid, status: "superseded", superseded_by: "qa-051" })).not.toThrow();
  });
});
```

- [ ] **Step 5: Run tests**

```bash
cd functions && npm test && cd ..
```

Expected: 4 passing in this file + earlier.

- [ ] **Step 6: Commit**

```bash
git add functions/src/lib/qa-validate.ts functions/src/lib/__tests__/qa-validate.test.ts functions/src/schemas functions/tsconfig.json
git commit -m "functions: vendor qa.schema.json + ajv validator"
```

---

### Task 3: Slack webhook helper

**Files:**
- Create: `functions/src/lib/slack.ts`

- [ ] **Step 1: Add the webhook secret**

```bash
echo -n "https://hooks.slack.com/services/<TXX>/<BXX>/<XXX>" | npx firebase functions:secrets:set SLACK_WEBHOOK_URL
```

(Create the webhook in Slack: workspace → manage apps → Incoming Webhooks → add to channel `#qa-feed` or similar. We'll use Slack `mrkdwn` and `@email` mentions which need the email-to-Slack-uid resolver — for Phase 1 we send to a single channel and tag emails as text.)

- [ ] **Step 2: Add to secrets module**

In `functions/src/lib/secrets.ts`, append:
```ts
export const SLACK_WEBHOOK_URL = defineSecret("SLACK_WEBHOOK_URL");
```

- [ ] **Step 3: Write helper**

`functions/src/lib/slack.ts`:
```ts
import { SLACK_WEBHOOK_URL } from "./secrets";

export async function notifyReviewRequested(input: {
  qid: string;
  scope: string;
  questionText: string;
  askerEmail: string;
  ownerEmails: string[];
  appBaseUrl: string;
}) {
  const url = SLACK_WEBHOOK_URL.value();
  const tag = input.ownerEmails.map((e) => `*${e}*`).join(", ");
  const body = {
    text: `New Q&A review needed (${input.scope})`,
    blocks: [
      {
        type: "section",
        text: { type: "mrkdwn",
          text: `:eyes: *Review needed* — scope \`${input.scope}\`\nReviewers: ${tag}`,
        },
      },
      {
        type: "section",
        text: { type: "mrkdwn",
          text: `*Q:* ${input.questionText}\n_Asked by_ \`${input.askerEmail}\``,
        },
      },
      {
        type: "actions",
        elements: [{
          type: "button",
          text: { type: "plain_text", text: "Open in wiki" },
          url: `${input.appBaseUrl}/q/${input.qid}`,
        }],
      },
    ],
  };
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`slack webhook ${res.status}: ${await res.text()}`);
}

export async function notifyApproved(input: {
  qid: string;
  qaId: string;
  scope: string;
  questionText: string;
  askerEmail: string;
  approverEmail: string;
  repoUrl: string;
  appBaseUrl: string;
}) {
  const url = SLACK_WEBHOOK_URL.value();
  const body = {
    text: `Q&A approved: ${input.qaId}`,
    blocks: [
      {
        type: "section",
        text: { type: "mrkdwn",
          text: `:white_check_mark: *${input.qaId}* approved (\`${input.scope}\`) by *${input.approverEmail}*\n_Asked by_ \`${input.askerEmail}\``,
        },
      },
      {
        type: "section",
        text: { type: "mrkdwn", text: `*Q:* ${input.questionText}` },
      },
      {
        type: "actions",
        elements: [
          { type: "button", text: { type: "plain_text", text: "Open in wiki" },
            url: `${input.appBaseUrl}/q/${input.qid}` },
          { type: "button", text: { type: "plain_text", text: "View in repo" },
            url: input.repoUrl },
        ],
      },
    ],
  };
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) console.error(`slack webhook (approved) ${res.status}: ${await res.text()}`);
  // approval notify failure is non-fatal — log only.
}
```

- [ ] **Step 4: Build**

```bash
cd functions && npm run build && cd ..
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add functions/src/lib/secrets.ts functions/src/lib/slack.ts
git commit -m "functions: slack webhook helpers (review_requested, approved)"
```

---

### Task 4: requestReview Cloud Function

**Files:**
- Create: `functions/src/review/requestReview.ts`
- Modify: `functions/src/index.ts`

- [ ] **Step 1: Write function**

`functions/src/review/requestReview.ts`:
```ts
import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import { ANTHROPIC_API_KEY, GITHUB_OWNER, GITHUB_REPO, GITHUB_TOKEN, SLACK_WEBHOOK_URL } from "../lib/secrets";
import { getOwners, ownersForScope, type Scope } from "../lib/owners";
import { notifyReviewRequested } from "../lib/slack";

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

export const requestReview = onCall(
  {
    secrets: [GITHUB_OWNER, GITHUB_REPO, GITHUB_TOKEN, SLACK_WEBHOOK_URL, ANTHROPIC_API_KEY],
    region: "asia-northeast3",
    timeoutSeconds: 30,
  },
  async (req) => {
    if (!req.auth?.token.email?.endsWith("@wrtn.io")) {
      throw new HttpsError("permission-denied", "@wrtn.io only.");
    }
    const qid = (req.data as { qid?: string })?.qid;
    if (!qid) throw new HttpsError("invalid-argument", "qid required.");

    const qref = db.doc(`questions/${qid}`);
    const snap = await qref.get();
    if (!snap.exists) throw new HttpsError("not-found", "Question missing.");
    const q = snap.data()!;

    if (q.askerUid !== req.auth.uid) {
      throw new HttpsError("permission-denied", "Not your question.");
    }
    if (q.status !== "drafting" && q.status !== "rejected") {
      throw new HttpsError("failed-precondition", `Cannot request review from status ${q.status}.`);
    }
    if (!q.currentDraftId) {
      throw new HttpsError("failed-precondition", "No draft to review yet.");
    }

    const owners = await getOwners();
    const ownerEmails = ownersForScope(owners, q.scope as Scope);

    await qref.update({
      status: "review_requested",
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    const appBaseUrl = process.env.APP_BASE_URL ?? "https://zzem-qa-wiki.web.app";
    try {
      await notifyReviewRequested({
        qid, scope: q.scope, questionText: q.text,
        askerEmail: req.auth.token.email, ownerEmails, appBaseUrl,
      });
      await db.collection("notifications").add({
        toUid: "broadcast",
        type: "review_requested",
        payload: { qid, scope: q.scope, ownerEmails },
        sentAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    } catch (e) {
      // Slack failure must NOT block state transition. Log and persist failure marker for retry.
      await db.collection("notifications").add({
        toUid: "broadcast",
        type: "review_requested",
        payload: { qid, scope: q.scope, ownerEmails },
        failedAt: admin.firestore.FieldValue.serverTimestamp(),
        error: (e as Error).message,
      });
      console.error("slack notify failed for review_requested", qid, e);
    }

    return { ok: true };
  },
);
```

- [ ] **Step 2: Wire export**

In `functions/src/index.ts`:
```ts
export { mirrorUserProfile } from "./auth/mirrorUserProfile";
export { generateDraft } from "./draft/generateDraft";
export { requestReview } from "./review/requestReview";
```

- [ ] **Step 3: Build + deploy**

```bash
cd functions && npm run build && cd ..
npx firebase deploy --only functions:requestReview
```

- [ ] **Step 4: Commit**

```bash
git add functions/src/review/requestReview.ts functions/src/index.ts
git commit -m "functions: requestReview transitions to review_requested + slack notify"
```

---

### Task 5: qa-commit lib (frontmatter assembly + numbering + commit)

**Files:**
- Create: `functions/src/lib/qa-commit.ts`
- Create: `functions/src/lib/__tests__/qa-commit.test.ts`

- [ ] **Step 1: Write commit helper**

`functions/src/lib/qa-commit.ts`:
```ts
import { getOctokit, repoCoords } from "./octokit";
import { validateQa, type QAFrontmatter } from "./qa-validate";
import yaml from "js-yaml";

const QA_DIR = "learning/qa";

export async function nextQaNumber(): Promise<number> {
  const { owner, repo } = repoCoords();
  const res = await getOctokit().repos.getContent({ owner, repo, path: QA_DIR });
  if (!Array.isArray(res.data)) throw new Error("learning/qa not a directory");
  const nums = res.data
    .map((e) => /^qa-([0-9]+)\.md$/.exec(e.name))
    .filter((m): m is RegExpExecArray => Boolean(m))
    .map((m) => parseInt(m[1]!, 10));
  return nums.length ? Math.max(...nums) + 1 : 1;
}

export function buildFile(fm: QAFrontmatter, body: { question: string; answer: string }): string {
  validateQa(fm); // throws QAValidationError on bad frontmatter
  const fmYaml = yaml.dump(fm, { lineWidth: 120, noRefs: true }).trimEnd();
  return [
    "---",
    fmYaml,
    "---",
    "",
    "## Question",
    body.question.trim(),
    "",
    "## Answer",
    body.answer.trim(),
    "",
  ].join("\n");
}

export async function commitQa(input: {
  fm: QAFrontmatter;
  body: { question: string; answer: string };
  messageScope: string;
  messageOneLine: string;
}): Promise<{ qaId: string; sha: string; htmlUrl: string }> {
  const { owner, repo } = repoCoords();
  const oct = getOctokit();

  let attempt = 0;
  let lastErr: unknown;
  while (attempt < 3) {
    attempt++;
    const num = await nextQaNumber();
    const id = `qa-${String(num).padStart(3, "0")}`;
    const fm = { ...input.fm, id };
    const path = `${QA_DIR}/${id}.md`;
    const content = buildFile(fm, input.body);
    const message = `qa: ${id} / ${input.messageScope} / ${input.messageOneLine.slice(0, 90)}`;

    try {
      const res = await oct.repos.createOrUpdateFileContents({
        owner, repo, path, message,
        content: Buffer.from(content, "utf8").toString("base64"),
        branch: "main",
        committer: { name: "zzem-qa-wiki", email: "qa-wiki@wrtn.io" },
        author:    { name: "zzem-qa-wiki", email: "qa-wiki@wrtn.io" },
      });
      const sha = res.data.content?.sha;
      const htmlUrl = res.data.content?.html_url;
      if (!sha || !htmlUrl) throw new Error("commit returned no sha/url");
      return { qaId: id, sha, htmlUrl };
    } catch (e) {
      const status = (e as { status?: number }).status;
      if (status === 422 || status === 409) {
        // SHA conflict / file exists — retry with new number
        lastErr = e;
        continue;
      }
      throw e;
    }
  }
  throw new Error(`commit failed after 3 attempts: ${(lastErr as Error)?.message}`);
}
```

- [ ] **Step 2: Write tests**

`functions/src/lib/__tests__/qa-commit.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

let conflictsLeft = 0;
const createMock = vi.fn();

vi.mock("../octokit", () => ({
  repoCoords: () => ({ owner: "x", repo: "y" }),
  getOctokit: () => ({
    repos: {
      getContent: vi.fn(async () => ({
        data: [
          { name: "qa-001.md" },
          { name: "qa-002.md" },
          { name: "README.md" },
        ],
      })),
      createOrUpdateFileContents: createMock,
    },
  }),
}));

import { buildFile, commitQa, nextQaNumber } from "../qa-commit";

beforeEach(() => {
  conflictsLeft = 0;
  createMock.mockReset();
});

describe("qa-commit", () => {
  it("nextQaNumber returns max+1", async () => {
    expect(await nextQaNumber()).toBe(3);
  });

  it("buildFile composes valid frontmatter + body", () => {
    const fm = {
      id: "qa-003",
      question: "Q?",
      scope: "global" as const,
      asker: "a@wrtn.io",
      approver: "b@wrtn.io",
      approved_at: "2026-04-30T00:00:00Z",
      last_verified_at: "2026-04-30T00:00:00Z",
      status: "active" as const,
      ai: { model: "claude-sonnet-4-6", sources_used: [] },
      schema_version: 1 as const,
    };
    const f = buildFile(fm, { question: "Q?", answer: "A." });
    expect(f).toMatch(/^---\n/);
    expect(f).toMatch(/## Question\nQ\?/);
    expect(f).toMatch(/## Answer\nA\./);
  });

  it("commitQa retries on 422", async () => {
    let attempts = 0;
    createMock.mockImplementation(async () => {
      attempts++;
      if (attempts === 1) {
        const err = new Error("conflict") as Error & { status: number };
        err.status = 422;
        throw err;
      }
      return { data: { content: { sha: "abc", html_url: "https://github.com/x/y/blob/main/learning/qa/qa-003.md" } } };
    });
    const out = await commitQa({
      fm: {
        id: "ignored",
        question: "Q?",
        scope: "global",
        asker: "a@wrtn.io",
        approver: "b@wrtn.io",
        approved_at: "2026-04-30T00:00:00Z",
        last_verified_at: "2026-04-30T00:00:00Z",
        status: "active",
        ai: { model: "claude-sonnet-4-6", sources_used: [] },
        schema_version: 1,
      },
      body: { question: "Q?", answer: "A." },
      messageScope: "global",
      messageOneLine: "test",
    });
    expect(out.qaId).toMatch(/^qa-\d{3}$/);
    expect(attempts).toBe(2);
  });
});
```

- [ ] **Step 3: Run tests**

```bash
cd functions && npm test && cd ..
```

Expected: 3 passing in this file + earlier.

- [ ] **Step 4: Commit**

```bash
git add functions/src/lib/qa-commit.ts functions/src/lib/__tests__/qa-commit.test.ts
git commit -m "functions: qa-commit (next-number, frontmatter+body builder, octokit + retry)"
```

---

### Task 6: approveAndCommit Cloud Function

**Files:**
- Create: `functions/src/lib/search-tokens.ts`
- Create: `functions/src/review/approveAndCommit.ts`
- Modify: `functions/src/index.ts`

- [ ] **Step 1: Write search token generator**

`functions/src/lib/search-tokens.ts`:
```ts
const STOP = new Set([
  "the","a","an","of","to","in","for","on","is","it","this","that","with","and","or","does",
  "do","did","how","what","when","where","why","i","we","our","you","your","at","by","be","as",
]);

export function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9가-힣\s\-_]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 2 && !STOP.has(t))
    .slice(0, 80);
}
```

- [ ] **Step 2: Write the function**

`functions/src/review/approveAndCommit.ts`:
```ts
import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import {
  ANTHROPIC_API_KEY, GITHUB_OWNER, GITHUB_REPO, GITHUB_TOKEN, SLACK_WEBHOOK_URL,
} from "../lib/secrets";
import { getOwners, isOwnerOf, type Scope } from "../lib/owners";
import { commitQa } from "../lib/qa-commit";
import { type QAFrontmatter, QAValidationError } from "../lib/qa-validate";
import { notifyApproved } from "../lib/slack";
import { tokenize } from "../lib/search-tokens";

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

export const approveAndCommit = onCall(
  {
    secrets: [GITHUB_OWNER, GITHUB_REPO, GITHUB_TOKEN, SLACK_WEBHOOK_URL, ANTHROPIC_API_KEY],
    region: "asia-northeast3",
    timeoutSeconds: 60,
    memory: "512MiB",
  },
  async (req) => {
    const email = req.auth?.token.email;
    if (!email?.endsWith("@wrtn.io")) {
      throw new HttpsError("permission-denied", "@wrtn.io only.");
    }
    const qid = (req.data as { qid?: string })?.qid;
    if (!qid) throw new HttpsError("invalid-argument", "qid required.");

    const qref = db.doc(`questions/${qid}`);
    const qsnap = await qref.get();
    if (!qsnap.exists) throw new HttpsError("not-found", "Question missing.");
    const q = qsnap.data()!;

    if (q.status !== "review_requested") {
      throw new HttpsError("failed-precondition", `Cannot approve from status ${q.status}.`);
    }
    if (q.askerUid === req.auth!.uid) {
      throw new HttpsError("permission-denied", "Cannot self-approve.");
    }

    const owners = await getOwners();
    if (!isOwnerOf(owners, q.scope as Scope, email)) {
      throw new HttpsError("permission-denied", `Not an owner of scope ${q.scope}.`);
    }

    if (!q.currentDraftId) throw new HttpsError("failed-precondition", "No draft to commit.");
    const draftSnap = await db.doc(`questions/${qid}/drafts/${q.currentDraftId}`).get();
    if (!draftSnap.exists) throw new HttpsError("not-found", "Draft missing.");
    const draft = draftSnap.data()!;

    // Resolve asker email from /users/{askerUid}
    const askerSnap = await db.doc(`users/${q.askerUid}`).get();
    const askerEmail = askerSnap.exists ? (askerSnap.data()!.email as string) : `${q.askerUid}@unknown`;

    const now = new Date().toISOString();
    const fm: QAFrontmatter = {
      id: "qa-000", // overwritten by commitQa with the assigned number
      question: q.text,
      scope: q.scope,
      asker: askerEmail,
      approver: email,
      approved_at: now,
      last_verified_at: now,
      status: "active",
      related: relatedFromSources(draft.ai?.sourcesUsed ?? []),
      ai: {
        model: draft.ai?.model ?? "unknown",
        sources_used: (draft.ai?.sourcesUsed ?? []).map((s: { type: string; id: string; why?: string }) => ({
          type: s.type, id: s.id, ...(s.why ? { why: s.why } : {}),
        })),
      },
      tags: [],
      schema_version: 1,
    };

    let committed: Awaited<ReturnType<typeof commitQa>>;
    try {
      committed = await commitQa({
        fm,
        body: { question: questionBody(q), answer: draft.body },
        messageScope: q.scope,
        messageOneLine: q.text,
      });
    } catch (e) {
      if (e instanceof QAValidationError) {
        await qref.update({
          status: "drafting",
          lastApproveError: { code: "schema", errors: e.errors, at: admin.firestore.FieldValue.serverTimestamp() },
        });
        throw new HttpsError("failed-precondition", "Schema validation failed; question returned to drafting.");
      }
      throw new HttpsError("unavailable", `Commit failed: ${(e as Error).message}`);
    }

    // Persist approval state + qa-records + search tokens
    const tokens = Array.from(new Set([...tokenize(q.text), ...tokenize(draft.body), ...tokenize(q.body ?? "")]));
    const batch = db.batch();
    batch.update(qref, {
      status: "approved",
      approvedQaId: committed.qaId,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    batch.set(db.doc(`qa-records/${committed.qaId}`), {
      qid,
      scope: q.scope,
      ownerUids: [], // populated by a separate sync if needed; not load-bearing in Phase 1
      voteCount: 0,
      lastVerifiedAt: admin.firestore.FieldValue.serverTimestamp(),
      staleAfterDays: 90,
      askerEmail,
      approverEmail: email,
      questionText: q.text,
      answerSnapshot: draft.body.slice(0, 5000),
      githubUrl: committed.htmlUrl,
      sha: committed.sha,
      tokens,
    });
    await batch.commit();

    const appBaseUrl = process.env.APP_BASE_URL ?? "https://zzem-qa-wiki.web.app";
    try {
      await notifyApproved({
        qid, qaId: committed.qaId, scope: q.scope,
        questionText: q.text, askerEmail, approverEmail: email,
        repoUrl: committed.htmlUrl, appBaseUrl,
      });
    } catch (e) { console.error("slack notify (approved) failed", e); }

    console.log(JSON.stringify({
      event: "approveAndCommit.success",
      qid, qaId: committed.qaId, scope: q.scope, approver: email,
    }));

    return { qaId: committed.qaId, githubUrl: committed.htmlUrl };
  },
);

function questionBody(q: { text: string; body?: string }): string {
  return q.body ? `${q.text}\n\n${q.body}` : q.text;
}

function relatedFromSources(sources: { type: string; id: string }[]) {
  const out: { patterns?: string[]; prds?: string[]; events?: string[]; qa?: string[]; reflections?: string[]; rubrics?: string[] } = {};
  for (const s of sources) {
    const k = ({ pattern: "patterns", prd: "prds", event: "events", qa: "qa", reflection: "reflections", rubric: "rubrics" } as const)[s.type as "pattern"];
    if (!k) continue;
    (out[k] ??= []).push(s.id);
  }
  return out;
}
```

- [ ] **Step 3: Wire export**

`functions/src/index.ts`:
```ts
export { mirrorUserProfile } from "./auth/mirrorUserProfile";
export { generateDraft } from "./draft/generateDraft";
export { requestReview } from "./review/requestReview";
export { approveAndCommit } from "./review/approveAndCommit";
```

- [ ] **Step 4: Build + deploy**

```bash
cd functions && npm run build && cd ..
npx firebase deploy --only functions:approveAndCommit
```

- [ ] **Step 5: Commit**

```bash
git add functions/src/review/approveAndCommit.ts functions/src/lib/search-tokens.ts functions/src/index.ts
git commit -m "functions: approveAndCommit (octokit commit + qa-records + search tokens + slack)"
```

---

### Task 7: rejectDraft Cloud Function

**Files:**
- Create: `functions/src/review/rejectDraft.ts`
- Modify: `functions/src/index.ts`

- [ ] **Step 1: Write function**

`functions/src/review/rejectDraft.ts`:
```ts
import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import { GITHUB_OWNER, GITHUB_REPO, GITHUB_TOKEN } from "../lib/secrets";
import { getOwners, isOwnerOf, type Scope } from "../lib/owners";

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

export const rejectDraft = onCall(
  {
    secrets: [GITHUB_OWNER, GITHUB_REPO, GITHUB_TOKEN],
    region: "asia-northeast3",
    timeoutSeconds: 30,
  },
  async (req) => {
    const email = req.auth?.token.email;
    if (!email?.endsWith("@wrtn.io")) {
      throw new HttpsError("permission-denied", "@wrtn.io only.");
    }
    const { qid, comment } = (req.data as { qid?: string; comment?: string }) ?? {};
    if (!qid)     throw new HttpsError("invalid-argument", "qid required.");
    if (!comment || comment.trim().length < 5) {
      throw new HttpsError("invalid-argument", "comment of ≥5 chars required.");
    }

    const qref = db.doc(`questions/${qid}`);
    const snap = await qref.get();
    if (!snap.exists) throw new HttpsError("not-found", "Question missing.");
    const q = snap.data()!;
    if (q.status !== "review_requested") {
      throw new HttpsError("failed-precondition", `Cannot reject from status ${q.status}.`);
    }
    if (q.askerUid === req.auth!.uid) {
      throw new HttpsError("permission-denied", "Cannot reject your own question.");
    }
    const owners = await getOwners();
    if (!isOwnerOf(owners, q.scope as Scope, email)) {
      throw new HttpsError("permission-denied", `Not an owner of scope ${q.scope}.`);
    }

    const batch = db.batch();
    batch.update(qref, {
      status: "drafting",
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    batch.set(db.collection(`questions/${qid}/comments`).doc(), {
      body: comment.trim(),
      authorUid: req.auth!.uid,
      authorEmail: email,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      kind: "rejection",
    });
    await batch.commit();
    return { ok: true };
  },
);
```

- [ ] **Step 2: Wire export**

`functions/src/index.ts`:
```ts
export { mirrorUserProfile } from "./auth/mirrorUserProfile";
export { generateDraft } from "./draft/generateDraft";
export { requestReview } from "./review/requestReview";
export { approveAndCommit } from "./review/approveAndCommit";
export { rejectDraft } from "./review/rejectDraft";
```

- [ ] **Step 3: Build + deploy**

```bash
cd functions && npm run build && cd ..
npx firebase deploy --only functions:rejectDraft
```

- [ ] **Step 4: Commit**

```bash
git add functions/src/review/rejectDraft.ts functions/src/index.ts
git commit -m "functions: rejectDraft returns to drafting + records rejection comment"
```

---

### Task 8: Tighten Firestore rules

**Files:**
- Modify: `firestore.rules`

- [ ] **Step 1: Update rules**

Replace `firestore.rules` with:
```js
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    function isWrtn() {
      return request.auth != null
        && request.auth.token.email_verified == true
        && request.auth.token.email.matches(".*@wrtn[.]io$");
    }
    function isOwnerUid(uid) { return isWrtn() && request.auth.uid == uid; }

    match /users/{uid} {
      allow read:  if isWrtn();
      allow write: if false;
    }

    match /questions/{qid} {
      allow read: if isWrtn();

      allow create: if isWrtn()
        && request.resource.data.askerUid == request.auth.uid
        && request.resource.data.status == 'drafting';

      // Asker may modify body/text/scope while in drafting/rejected.
      // Status changes from client are explicitly forbidden — Cloud Functions
      // perform the transitions (drafting→review_requested, →approved, →rejected).
      allow update: if isOwnerUid(resource.data.askerUid)
        && resource.data.status in ['drafting', 'rejected']
        && request.resource.data.status == resource.data.status
        && request.resource.data.askerUid == resource.data.askerUid;

      allow delete: if false;

      match /drafts/{did} {
        allow read:  if isWrtn();
        allow create: if isOwnerUid(get(/databases/$(database)/documents/questions/$(qid)).data.askerUid)
          && get(/databases/$(database)/documents/questions/$(qid)).data.status in ['drafting', 'rejected'];
        allow update, delete: if false;
      }

      match /comments/{cid} {
        allow read: if isWrtn();
        allow create: if isWrtn()
          && request.resource.data.authorUid == request.auth.uid;
        allow update, delete: if isOwnerUid(resource.data.authorUid);
      }
    }

    match /qa-records/{qaId} {
      allow read: if isWrtn();
      allow write: if false; // Cloud Function only

      match /votes/{uid} {
        allow read: if isWrtn();
        allow create, update: if isOwnerUid(uid);
        allow delete: if isOwnerUid(uid);
      }
    }

    match /notifications/{nid} {
      allow read: if isWrtn();
      allow update: if isWrtn()
        && request.resource.data.diff(resource.data).affectedKeys().hasOnly(['readAt']);
      allow create, delete: if false;
    }

    match /rate-limits/{uid} {
      allow read, write: if false; // Cloud Function only
    }
  }
}
```

- [ ] **Step 2: Deploy**

```bash
npx firebase deploy --only firestore:rules
```

- [ ] **Step 3: Update indexes for owner queue + search**

In `firestore.indexes.json`, append:
```json
{
  "collectionGroup": "questions",
  "queryScope": "COLLECTION",
  "fields": [
    { "fieldPath": "status", "order": "ASCENDING" },
    { "fieldPath": "scope",  "order": "ASCENDING" },
    { "fieldPath": "updatedAt", "order": "DESCENDING" }
  ]
},
{
  "collectionGroup": "qa-records",
  "queryScope": "COLLECTION",
  "fields": [
    { "fieldPath": "tokens", "arrayConfig": "CONTAINS" },
    { "fieldPath": "lastVerifiedAt", "order": "DESCENDING" }
  ]
}
```

Deploy:
```bash
npx firebase deploy --only firestore:indexes
```

- [ ] **Step 4: Commit**

```bash
git add firestore.rules firestore.indexes.json
git commit -m "rules: tighten transitions; indexes for owner queue + qa search"
```

---

### Task 9: UI — owners loader

**Files:**
- Create: `src/lib/firebase/owners.ts`

- [ ] **Step 1: Write client-side owners fetch**

We mirror Cloud Function's loader, but the browser fetches the file from a public URL of the KB repo (raw.githubusercontent.com works for public repos; for private repos, expose via a Cloud Function `getOwners` callable instead).

For Phase 1, assume the KB repo is public (zach-wrtn/knowledge-base is public per its License field):

`src/lib/firebase/owners.ts`:
```ts
"use client";
import { useEffect, useState } from "react";

export type Scope = "global" | "ai-webtoon" | "free-tab" | "ugc-platform";
export interface OwnersDoc {
  schema_version: 1;
  scopes: Record<Scope, string[]>;
  admins: string[];
}

let cached: { at: number; doc: OwnersDoc | null } = { at: 0, doc: null };
const TTL = 5 * 60 * 1000;

export async function fetchOwners(): Promise<OwnersDoc> {
  if (cached.doc && Date.now() - cached.at < TTL) return cached.doc;
  const url = "https://raw.githubusercontent.com/zach-wrtn/knowledge-base/main/learning/qa-owners.yaml";
  const res = await fetch(url, { cache: "no-cache" });
  if (!res.ok) throw new Error(`owners fetch ${res.status}`);
  const text = await res.text();
  const yaml = await import("js-yaml");
  const doc = yaml.load(text) as OwnersDoc;
  cached = { at: Date.now(), doc };
  return doc;
}

export function useOwnedScopes(email?: string | null): Scope[] {
  const [scopes, setScopes] = useState<Scope[]>([]);
  useEffect(() => {
    if (!email) return;
    fetchOwners().then((doc) => {
      const owned: Scope[] = [];
      for (const s of ["global", "ai-webtoon", "free-tab", "ugc-platform"] as const) {
        const list = new Set([...(doc.scopes[s] ?? []), ...doc.admins]);
        if (list.has(email)) owned.push(s);
      }
      setScopes(owned);
    }).catch(() => setScopes([]));
  }, [email]);
  return scopes;
}
```

Install js-yaml on the app side:
```bash
npm install js-yaml
npm install -D @types/js-yaml
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/firebase/owners.ts package.json package-lock.json
git commit -m "ui: client-side owners loader from KB repo (5min cache)"
```

---

### Task 10: UI — review actions on question detail

**Files:**
- Modify: `src/app/q/[qid]/page.tsx`
- Create: `src/components/qa/review-actions.tsx`
- Modify: `src/lib/firebase/callables.ts`

- [ ] **Step 1: Add callables for review/approve/reject**

In `src/lib/firebase/callables.ts`, append:
```ts
export async function callRequestReview(qid: string) {
  const { app } = getFirebase();
  const fns = getFunctions(app, "asia-northeast3");
  const fn = httpsCallable<{ qid: string }, { ok: true }>(fns, "requestReview");
  await fn({ qid });
}

export async function callApproveAndCommit(qid: string) {
  const { app } = getFirebase();
  const fns = getFunctions(app, "asia-northeast3");
  const fn = httpsCallable<{ qid: string }, { qaId: string; githubUrl: string }>(fns, "approveAndCommit");
  return (await fn({ qid })).data;
}

export async function callRejectDraft(qid: string, comment: string) {
  const { app } = getFirebase();
  const fns = getFunctions(app, "asia-northeast3");
  const fn = httpsCallable<{ qid: string; comment: string }, { ok: true }>(fns, "rejectDraft");
  await fn({ qid, comment });
}
```

- [ ] **Step 2: Write review actions**

`src/components/qa/review-actions.tsx`:
```tsx
"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { callApproveAndCommit, callRejectDraft } from "@/lib/firebase/callables";

export function ReviewActions({ qid, onResult }: {
  qid: string;
  onResult: (msg: string) => void;
}) {
  const [busy, setBusy] = useState<"approve" | "reject" | null>(null);
  const [showReject, setShowReject] = useState(false);
  const [comment, setComment] = useState("");

  async function approve() {
    setBusy("approve");
    try {
      const r = await callApproveAndCommit(qid);
      onResult(`Committed as ${r.qaId} → ${r.githubUrl}`);
    } catch (e) {
      onResult(`Approve failed: ${(e as Error).message}`);
    } finally { setBusy(null); }
  }

  async function reject() {
    if (comment.trim().length < 5) { onResult("Comment must be ≥5 chars."); return; }
    setBusy("reject");
    try {
      await callRejectDraft(qid, comment);
      onResult("Returned to drafting with your comment.");
      setShowReject(false);
      setComment("");
    } catch (e) {
      onResult(`Reject failed: ${(e as Error).message}`);
    } finally { setBusy(null); }
  }

  return (
    <div className="space-y-3 rounded-lg border bg-amber-50/30 p-4">
      <div className="text-sm font-medium">Owner review</div>
      <div className="flex gap-2">
        <Button onClick={approve} disabled={busy !== null}>
          {busy === "approve" ? "Committing..." : "Approve & commit"}
        </Button>
        <Button variant="outline" onClick={() => setShowReject((v) => !v)} disabled={busy !== null}>
          {showReject ? "Cancel" : "Reject..."}
        </Button>
      </div>
      {showReject && (
        <div className="space-y-2">
          <Textarea
            placeholder="What needs to change before approval? (≥5 chars)"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            rows={3}
          />
          <Button onClick={reject} disabled={busy !== null}>
            {busy === "reject" ? "Rejecting..." : "Send rejection"}
          </Button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Wire into question detail page**

In `src/app/q/[qid]/page.tsx`, import and use:

Add imports:
```tsx
import { useOwnedScopes } from "@/lib/firebase/owners";
import { callRequestReview } from "@/lib/firebase/callables";
import { ReviewActions } from "@/components/qa/review-actions";
```

Inside the component body, after existing hooks:
```tsx
const ownedScopes = useOwnedScopes(user?.email ?? null);
const isOwner = q ? ownedScopes.includes(q.scope) : false;
const [actionMsg, setActionMsg] = useState<string | null>(null);

async function requestReview() {
  setErr(null);
  setBusy(true);
  try { await callRequestReview(qid); }
  catch (e) { setErr((e as Error).message); }
  finally { setBusy(false); }
}
```

In the JSX, after the `{draft && editing && ...}` block, add:
```tsx
{isAsker && q.status === "drafting" && draft && (
  <Button onClick={requestReview} disabled={busy} className="mt-2">
    {busy ? "Requesting..." : "Request review"}
  </Button>
)}
{isAsker && q.status === "review_requested" && (
  <p className="text-sm text-muted-foreground">Waiting on owner review.</p>
)}
{isAsker && q.status === "rejected" && (
  <p className="text-sm text-destructive">Owner rejected — see comments below; edit and re-request.</p>
)}
{isOwner && q.status === "review_requested" && q.askerUid !== user.uid && (
  <ReviewActions qid={qid} onResult={(m) => setActionMsg(m)} />
)}
{actionMsg && <p className="text-sm">{actionMsg}</p>}
{q.status === "approved" && q.approvedQaId && (
  <p className="text-sm">
    Approved as <code className="font-mono">{q.approvedQaId}</code>.
  </p>
)}
```

Also add a comments section that lists rejection comments — minimal:
```tsx
{/* Comments — minimal */}
<CommentsSection qid={qid} />
```

Define the component inline in the same file or extract:

```tsx
function CommentsSection({ qid }: { qid: string }) {
  const [items, setItems] = useState<{ id: string; body: string; authorEmail?: string; kind?: string }[]>([]);
  useEffect(() => {
    const { db } = getFirebase();
    const q = query(collection(db, `questions/${qid}/comments`), orderBy("createdAt", "asc"));
    return onSnapshot(q, (snap) => setItems(snap.docs.map((d) => ({ id: d.id, ...(d.data() as { body: string; authorEmail?: string; kind?: string }) }))));
  }, [qid]);
  if (!items.length) return null;
  return (
    <section className="space-y-2 rounded-lg border p-4">
      <div className="text-sm font-medium">Comments</div>
      {items.map((c) => (
        <div key={c.id} className="text-sm">
          <span className="font-mono text-xs">{c.authorEmail ?? "?"}</span>
          {c.kind === "rejection" && <span className="ml-2 rounded bg-rose-500/10 px-1 text-xs text-rose-700">rejected</span>}
          <div>{c.body}</div>
        </div>
      ))}
    </section>
  );
}
```

(Add the `query` import: `import { collection, doc, onSnapshot, query, orderBy, limit } from "firebase/firestore";` — it's already imported in this file from Plan 3; verify.)

- [ ] **Step 4: Build + run**

```bash
npm run build
npm run dev
```

Hand-verify: as asker, generate draft → Request review → status flips. Sign in as a different `@wrtn.io` account that's listed as owner in `qa-owners.yaml` → open the same /q/{qid} → see Approve & Reject buttons → Reject with comment → returns to drafting + comment shows. Iterate, request again, Approve → Slack message arrives, GitHub commit lands at `learning/qa/qa-{NNN}.md`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/firebase/callables.ts src/components/qa/review-actions.tsx src/app/q
git commit -m "ui: request-review + owner approve/reject + comments"
```

---

### Task 11: UI — owner review queue

**Files:**
- Create: `src/components/qa/review-queue.tsx`
- Create: `src/app/queue/page.tsx`
- Modify: `src/app/page.tsx` (add Review queue tile)

- [ ] **Step 1: Write queue component**

`src/components/qa/review-queue.tsx`:
```tsx
"use client";
import { useEffect, useState } from "react";
import { collection, onSnapshot, orderBy, query, where } from "firebase/firestore";
import { getFirebase } from "@/lib/firebase/client";
import { useOwnedScopes, type Scope } from "@/lib/firebase/owners";
import { useAuth } from "@/lib/firebase/auth-provider";
import Link from "next/link";
import type { QuestionDoc } from "@/types/qa";
import { Card, CardContent } from "@/components/ui/card";

export function ReviewQueue() {
  const { user } = useAuth();
  const scopes = useOwnedScopes(user?.email ?? null);
  const [items, setItems] = useState<(QuestionDoc & { id: string })[]>([]);

  useEffect(() => {
    if (!user || scopes.length === 0) { setItems([]); return; }
    const { db } = getFirebase();
    // 'in' query supports up to 30 values — we only have 4 scopes
    const q = query(
      collection(db, "questions"),
      where("status", "==", "review_requested"),
      where("scope", "in", scopes as Scope[]),
      orderBy("updatedAt", "desc"),
    );
    return onSnapshot(q, (snap) => {
      setItems(snap.docs
        .map((d) => ({ id: d.id, ...(d.data() as QuestionDoc) }))
        .filter((q) => q.askerUid !== user.uid)); // can't approve own
    });
  }, [user, scopes]);

  if (!user) return null;
  if (scopes.length === 0) return <p className="text-sm text-muted-foreground">You are not an owner of any scope.</p>;
  if (items.length === 0)  return <p className="text-sm text-muted-foreground">Queue empty. ✨</p>;

  return (
    <div className="space-y-2">
      {items.map((q) => (
        <Link key={q.id} href={`/q/${q.id}`}>
          <Card className="hover:bg-accent">
            <CardContent className="py-4">
              <div className="font-medium">{q.text}</div>
              <div className="mt-1 text-xs text-muted-foreground">
                scope: <span className="font-mono">{q.scope}</span>
              </div>
            </CardContent>
          </Card>
        </Link>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Write queue page**

`src/app/queue/page.tsx`:
```tsx
"use client";
import { useEffect } from "react";
import { useAuth } from "@/lib/firebase/auth-provider";
import { useRouter } from "next/navigation";
import { ReviewQueue } from "@/components/qa/review-queue";

export default function QueuePage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  useEffect(() => { if (!loading && !user) router.replace("/login"); }, [loading, user, router]);
  if (loading || !user) return null;
  return (
    <main className="mx-auto max-w-3xl p-6 space-y-3">
      <h1 className="text-2xl font-semibold">Review queue</h1>
      <ReviewQueue />
    </main>
  );
}
```

- [ ] **Step 3: Add tile on home**

In `src/app/page.tsx`, add a tile inside the grid:
```tsx
<Link href="/queue" className="rounded-lg border p-6 hover:bg-accent">
  <div className="text-lg font-medium">Review queue</div>
  <div className="text-sm text-muted-foreground">Owner approvals waiting</div>
</Link>
```

- [ ] **Step 4: Commit**

```bash
git add src/components/qa/review-queue.tsx src/app/queue src/app/page.tsx
git commit -m "ui: review queue page (filtered by signed-in user's owned scopes)"
```

---

### Task 12: UI — search approved Q&A

**Files:**
- Create: `src/components/qa/search-bar.tsx`
- Create: `src/app/search/page.tsx`
- Modify: `src/app/page.tsx`

- [ ] **Step 1: Write search component**

`src/components/qa/search-bar.tsx`:
```tsx
"use client";
import { useState } from "react";
import { Input } from "@/components/ui/input";
import { collection, getDocs, query, where, limit, orderBy } from "firebase/firestore";
import { getFirebase } from "@/lib/firebase/client";
import Link from "next/link";

interface Hit {
  qaId: string;
  questionText: string;
  scope: string;
  githubUrl: string;
}

export function SearchBar() {
  const [text, setText] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [busy, setBusy] = useState(false);

  async function search() {
    const tokens = tokenize(text);
    if (tokens.length === 0) { setHits([]); return; }
    setBusy(true);
    try {
      const { db } = getFirebase();
      // single-term Firestore "array-contains" — for multi-term, do per-term then intersect.
      const first = tokens[0]!;
      const snap = await getDocs(query(
        collection(db, "qa-records"),
        where("tokens", "array-contains", first),
        orderBy("lastVerifiedAt", "desc"),
        limit(20),
      ));
      const candidates = snap.docs.map((d) => ({ id: d.id, ...(d.data() as { tokens?: string[]; questionText: string; scope: string; githubUrl: string }) }));
      const filtered = candidates.filter((c) => tokens.every((t) => (c.tokens ?? []).includes(t)));
      setHits(filtered.slice(0, 10).map((c) => ({
        qaId: c.id, questionText: c.questionText, scope: c.scope, githubUrl: c.githubUrl,
      })));
    } finally { setBusy(false); }
  }

  return (
    <div className="space-y-3">
      <form onSubmit={(e) => { e.preventDefault(); search(); }} className="flex gap-2">
        <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="Search approved Q&A..." />
      </form>
      {busy && <p className="text-sm text-muted-foreground">Searching…</p>}
      {!busy && hits.length === 0 && text.length > 0 && <p className="text-sm text-muted-foreground">No matches.</p>}
      <ul className="space-y-2">
        {hits.map((h) => (
          <li key={h.qaId} className="rounded border p-3">
            <div className="text-sm font-medium">{h.questionText}</div>
            <div className="mt-1 flex gap-3 text-xs text-muted-foreground">
              <span className="font-mono">{h.qaId}</span>
              <span>scope: <span className="font-mono">{h.scope}</span></span>
              <a className="underline" href={h.githubUrl} target="_blank" rel="noreferrer">view in repo</a>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function tokenize(s: string): string[] {
  return s.toLowerCase()
    .replace(/[^a-z0-9가-힣\s\-_]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 2)
    .slice(0, 6);
}
```

- [ ] **Step 2: Write search page**

`src/app/search/page.tsx`:
```tsx
"use client";
import { useEffect } from "react";
import { useAuth } from "@/lib/firebase/auth-provider";
import { useRouter } from "next/navigation";
import { SearchBar } from "@/components/qa/search-bar";

export default function SearchPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  useEffect(() => { if (!loading && !user) router.replace("/login"); }, [loading, user, router]);
  if (loading || !user) return null;
  return (
    <main className="mx-auto max-w-3xl p-6 space-y-3">
      <h1 className="text-2xl font-semibold">Search Q&A</h1>
      <SearchBar />
    </main>
  );
}
```

- [ ] **Step 3: Add tile on home**

In `src/app/page.tsx`, add:
```tsx
<Link href="/search" className="rounded-lg border p-6 hover:bg-accent">
  <div className="text-lg font-medium">Search</div>
  <div className="text-sm text-muted-foreground">Find approved Q&A</div>
</Link>
```

- [ ] **Step 4: Commit**

```bash
git add src/components/qa/search-bar.tsx src/app/search src/app/page.tsx
git commit -m "ui: search approved Q&A by token intersection"
```

---

### Task 13: Submit-time duplicate suggestion

**Files:**
- Modify: `src/app/ask/page.tsx`

- [ ] **Step 1: Add similar-Q&A suggestions on the ask page**

In `src/app/ask/page.tsx`, add a debounced search that runs as the user types:

```tsx
import { collection, getDocs, query, where, limit, orderBy } from "firebase/firestore";
import { getFirebase } from "@/lib/firebase/client";
```

Add state:
```tsx
const [related, setRelated] = useState<{ qaId: string; questionText: string; scope: string }[]>([]);
```

Add an effect that fires when `text` changes (debounced 350ms):
```tsx
useEffect(() => {
  const t = text.trim();
  if (t.length < 5) { setRelated([]); return; }
  const id = setTimeout(async () => {
    const tokens = t.toLowerCase().replace(/[^a-z0-9가-힣\s]/g, " ").split(/\s+/).filter((x) => x.length >= 2).slice(0, 3);
    if (!tokens.length) return;
    const { db } = getFirebase();
    const snap = await getDocs(query(
      collection(db, "qa-records"),
      where("tokens", "array-contains", tokens[0]!),
      orderBy("lastVerifiedAt", "desc"),
      limit(5),
    ));
    setRelated(snap.docs.map((d) => ({
      qaId: d.id,
      questionText: (d.data() as { questionText: string }).questionText,
      scope: (d.data() as { scope: string }).scope,
    })));
  }, 350);
  return () => clearTimeout(id);
}, [text]);
```

Render below the question input:
```tsx
{related.length > 0 && (
  <div className="rounded border bg-accent/30 p-3 text-sm">
    <div className="mb-1 font-medium">Similar approved Q&A:</div>
    <ul className="space-y-1">
      {related.map((r) => (
        <li key={r.qaId}>
          <span className="font-mono text-xs mr-2">{r.qaId}</span>
          <span>{r.questionText}</span>
          <span className="ml-2 text-xs text-muted-foreground font-mono">[{r.scope}]</span>
        </li>
      ))}
    </ul>
  </div>
)}
```

- [ ] **Step 2: Hand-verify**

Run `npm run dev`. Sign in. Approve at least one Q&A first (use lifecycle from prior tasks). Now open `/ask` and start typing words from the approved question — suggestions should appear within ~350ms after pause.

- [ ] **Step 3: Commit**

```bash
git add src/app/ask/page.tsx
git commit -m "ui: similar Q&A suggestions on ask page (debounced)"
```

---

### Task 14: End-to-end lifecycle test (emulator)

**Files:**
- Create: `tests/e2e/full-lifecycle.spec.ts`

- [ ] **Step 1: Write the spec**

This test exercises ask → generate (mocked AI) → request review → approve. Mocking Anthropic at the function level requires running emulators with the function in dev mode and overriding the Anthropic SDK with a Vitest-style fake. For Phase 1 we keep this test as a manual checklist and rely on the unit tests already added.

`tests/e2e/full-lifecycle.spec.ts`:
```ts
import { test, expect } from "@playwright/test";

test.describe("full lifecycle (manual)", () => {
  test.skip(!process.env.E2E_FULL, "Set E2E_FULL=1 for the manual lifecycle test");

  test("asker creates → generates → requests review; owner approves; shows up in search", async ({ page }) => {
    await page.goto("/");
    // login flow expected to be handled by emulator-pre-set state per Plan 2 Task 11.
    // ... (manual test runs through UI; auto-driving SSO needs google service-account scaffolding)
    expect(true).toBe(true);
  });
});
```

The automated E2E for the full SSO flow is significant additional infrastructure. For Phase 1, the verification path is:

**Manual checklist (run after deploy):**
1. Asker A signs in → /ask → "When does free-tab end?" / scope=free-tab → Create question.
2. /q/{id} → Generate AI draft → wait → draft appears with confidence/sources.
3. Edit draft → Save → version bump.
4. Request review → status flips, Slack message posts.
5. Owner B (different `@wrtn.io`, listed in `qa-owners.yaml` for free-tab) signs in → /queue → sees the question.
6. Open question → Reject with comment → returns to drafting + comment visible to A.
7. A re-edits, requests review again → B Approves & commits.
8. Slack approval message arrives. Open `learning/qa/qa-{NNN}.md` in the KB repo — frontmatter + body matches.
9. /search → type a keyword from the question → finds the Q&A with link to the GitHub URL.
10. /ask → start typing the same question → similar-Q&A suggestion appears.

Document this checklist in the project README.

- [ ] **Step 2: Append to README.md**

Add a section "## Phase 1 manual test" to the project README with the 10-step checklist above.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/full-lifecycle.spec.ts README.md
git commit -m "test: phase 1 manual lifecycle checklist + skipped automated stub"
```

---

### Task 15: KB-side integration: confirm zzem-kb:read works

**Files:** none in `zzem-qa-wiki`; verification only.

- [ ] **Step 1: After at least one Q&A has been approved by the lifecycle test, in `zzem-knowledge-base`:**

```bash
cd ~/dev/work/zzem-knowledge-base
git pull
ls learning/qa/
npm run validate:learning
```

Expected: at least one `qa-{NNN}.md` exists; validators pass.

- [ ] **Step 2: Smoke-test the read skill**

Open a Claude Code session with the KB skills installed. Invoke:
```
zzem-kb:read type=qa scope=free-tab
```

Expected: returns the path to the approved Q&A in `learning/qa/`.

- [ ] **Step 3: Commit any KB-side housekeeping (if needed)**

If any path adjustments are needed in the read skill, commit them in the KB repo:

```bash
cd ~/dev/work/zzem-knowledge-base
git add skills/read/SKILL.md
git commit -m "skill(read): adjust qa filter wording after live test"
```

---

## Self-review notes

- **Spec coverage:**
  - §3 lifecycle: drafting → review_requested ✓ (Task 4), review_requested → approved ✓ (Task 6), review_requested → drafting (rejected) ✓ (Task 7), Slack notify on review request ✓, Slack notify on approval ✓.
  - §3 invariants: no repo write before approval ✓, repo monotonic from this tool ✓ (no delete/edit endpoints), drafts immutable ✓ (rules), votes/verify in Firestore (qa-records) ✓.
  - §6 errors: schema validation fail returns to drafting with audit trail ✓, GitHub SHA conflict retries up to 3 ✓, Slack failure non-blocking on approval, marker on review-request ✓, missing scope mapping → admin fallback ✓ (admins are unioned into every scope), self-approval blocked ✓ (Task 6).
  - §5 Phase 1 deliverables: ask/draft/edit/request review/owner approve/reject/commit ✓, Google SSO + rules ✓, qa-owners.yaml routing ✓, Slack notifications ✓, in-UI search ✓, zzem-kb:read for qa ✓ (Task 15).
- **Atomicity caveat in approveAndCommit:** the GitHub commit is not atomic with the Firestore batch. If GitHub succeeds but Firestore batch fails (rare — Firestore is highly available), there is a brief inconsistency window. Mitigation: the second batch operation only writes new docs (`qa-records/{qaId}` + question status flip), and a follow-up cron in Phase 3 reconciles by reading `learning/qa/` and ensuring `qa-records` exists for each. Phase 1 logs the path explicitly via `console.log` so operators can repair manually.
- **Owner queue scaling:** the `where('scope','in',scopes)` query scales fine with ≤ 10 scopes. If scope count grows beyond Firestore's `in` limit (currently 30), split into per-scope subscriptions.
- **Search quality:** token-intersection is rough; sufficient for ≤ 100 approved Q&A. Phase 2 adds embedding-backed similarity (planned). Phase 1's `tokens` field on `qa-records` is forward-compatible (we keep tokens, add embedding alongside in Phase 2).
- **`learning/qa-owners.yaml` is fetched directly from raw.githubusercontent.com** by the browser. If the KB repo becomes private, expose `getOwners` as a Cloud Function callable instead — both the loader code in `src/lib/firebase/owners.ts` and the import in `review-queue.tsx` switch over with no rule changes.
- **Rate limit collection** (`/rate-limits/{uid}`) is referenced by the Cloud Function but never read by the client; the rules deny all client access. Confirm via emulator: `firebase emulators:start --only firestore` then attempt a client read of `/rate-limits/test` — must return permission-denied.
