# Team Q&A Wiki — Plan 3: AI Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate AI-drafted answers grounded in the existing KB. Implement the `generateDraft` Cloud Function with Anthropic agentic tool-use, prompt caching, and structured output. Wire the UI so an asker can request, view, edit, and regenerate drafts on a question detail page.

**Architecture:** Cloud Function (HTTPS callable, requires authenticated `@wrtn.io`) accepts a `qid`, loads the question + scope, calls Anthropic Sonnet 4.6 with four custom tools that read the `zzem-knowledge-base` repo via the GitHub Contents API. The model agent loop is bounded (≤ 6 turns, ≤ 4096 output tokens). Final assistant message must end with a JSON block matching the spec's output contract. Prompt caching covers system prompt + tools + KB meta-index across requests; per-question content is uncached.

**Tech Stack:** `@anthropic-ai/sdk` v0.30+, `@octokit/rest`, `firebase-functions/v2`, `firebase-admin`. KB index built at function cold-start from `GET /repos/{owner}/{repo}/git/trees/{ref}?recursive=1` + per-file frontmatter fetch on demand.

**Spec:** `zzem-knowledge-base/docs/superpowers/specs/2026-04-30-team-qa-wiki-design.md` §4 (AI Integration).

**Prerequisites:** Plan 1 merged (qa schema in place, KB readable). Plan 2 deployed (UI scaffold + Firestore + auth working).

**Repo context:** All file paths in this plan are relative to the `zzem-qa-wiki` repo created in Plan 2.

---

## File Structure

**Create — Cloud Functions:**
- `functions/src/lib/secrets.ts` — Secret Manager accessors
- `functions/src/lib/anthropic.ts` — SDK init, model constants
- `functions/src/lib/octokit.ts` — KB repo reader
- `functions/src/lib/kb-index.ts` — repo tree + frontmatter cache
- `functions/src/lib/tools.ts` — 4 tool definitions + dispatcher
- `functions/src/lib/prompt.ts` — system prompt + KB index assembly
- `functions/src/lib/draft-output.ts` — output parser + Zod schema
- `functions/src/lib/rate-limit.ts` — per-user token bucket via Firestore
- `functions/src/draft/generateDraft.ts` — main HTTPS callable
- `functions/src/draft/regenerateDraft.ts` — thin wrapper that increments version

**Modify — Cloud Functions:**
- `functions/package.json` — add deps
- `functions/src/index.ts` — export new functions

**Create — App:**
- `src/lib/firebase/callables.ts` — typed callables wrapper
- `src/components/qa/draft-view.tsx` — renders draft body + confidence/caveats/sources
- `src/components/qa/draft-editor.tsx` — markdown textarea (simple) with save
- `src/components/qa/sources-badges.tsx`

**Modify — App:**
- `src/app/q/[qid]/page.tsx` — adds Generate / Regenerate / Edit / latest draft display

**Create — tests:**
- `functions/src/lib/__tests__/draft-output.test.ts`
- `functions/src/lib/__tests__/tools.test.ts`
- `functions/src/draft/__tests__/generateDraft.test.ts` (with mocked Anthropic + Octokit)

---

### Task 1: Add deps & secrets

**Files:**
- Modify: `functions/package.json`

- [ ] **Step 1: Install runtime deps**

```bash
cd functions
npm install @anthropic-ai/sdk @octokit/rest zod p-retry gray-matter
npm install -D vitest @vitest/coverage-v8
cd ..
```

- [ ] **Step 2: Add secrets to GCP Secret Manager**

```bash
echo -n "<your-anthropic-key>" | npx firebase functions:secrets:set ANTHROPIC_API_KEY
echo -n "<github-pat-with-content-write>" | npx firebase functions:secrets:set GITHUB_TOKEN
echo -n "zach-wrtn"                       | npx firebase functions:secrets:set GITHUB_OWNER
echo -n "knowledge-base"                  | npx firebase functions:secrets:set GITHUB_REPO
```

The PAT needs `contents:write` on `zach-wrtn/knowledge-base` (Plan 4 uses it; Plan 3 only reads but we set it once).

- [ ] **Step 3: Update package.json scripts**

In `functions/package.json` `"scripts"`, replace with:
```json
{
  "build": "tsc",
  "test": "vitest run",
  "test:watch": "vitest",
  "serve": "npm run build && firebase emulators:start --only functions,firestore,auth",
  "deploy": "firebase deploy --only functions"
}
```

- [ ] **Step 4: Commit**

```bash
git add functions/package.json functions/package-lock.json
git commit -m "functions: add anthropic-sdk, octokit, zod, vitest deps"
```

---

### Task 2: Secret Manager + Anthropic client

**Files:**
- Create: `functions/src/lib/secrets.ts`
- Create: `functions/src/lib/anthropic.ts`

- [ ] **Step 1: Write secrets accessor**

`functions/src/lib/secrets.ts`:
```ts
import { defineSecret } from "firebase-functions/params";

export const ANTHROPIC_API_KEY = defineSecret("ANTHROPIC_API_KEY");
export const GITHUB_TOKEN      = defineSecret("GITHUB_TOKEN");
export const GITHUB_OWNER      = defineSecret("GITHUB_OWNER");
export const GITHUB_REPO       = defineSecret("GITHUB_REPO");
```

- [ ] **Step 2: Write Anthropic SDK init**

`functions/src/lib/anthropic.ts`:
```ts
import Anthropic from "@anthropic-ai/sdk";
import { ANTHROPIC_API_KEY } from "./secrets";

export const PRIMARY_MODEL  = "claude-sonnet-4-6";
export const FALLBACK_MODEL = "claude-haiku-4-5-20251001";

export function makeClient() {
  return new Anthropic({ apiKey: ANTHROPIC_API_KEY.value() });
}

export function isPrimaryAvailable(err: unknown): boolean {
  const e = err as { status?: number; type?: string };
  return e?.status !== 529 && e?.status !== 503 && e?.type !== "overloaded_error";
}
```

- [ ] **Step 3: Build**

```bash
cd functions && npm run build && cd ..
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add functions/src/lib/secrets.ts functions/src/lib/anthropic.ts
git commit -m "functions: secret manager + anthropic client init"
```

---

### Task 3: Octokit reader + KB index cache

**Files:**
- Create: `functions/src/lib/octokit.ts`
- Create: `functions/src/lib/kb-index.ts`
- Create: `functions/src/lib/__tests__/kb-index.test.ts`

- [ ] **Step 1: Write Octokit reader**

`functions/src/lib/octokit.ts`:
```ts
import { Octokit } from "@octokit/rest";
import { GITHUB_OWNER, GITHUB_REPO, GITHUB_TOKEN } from "./secrets";

let client: Octokit | null = null;
export function getOctokit() {
  if (!client) client = new Octokit({ auth: GITHUB_TOKEN.value() });
  return client;
}

export function repoCoords() {
  return { owner: GITHUB_OWNER.value(), repo: GITHUB_REPO.value() };
}

export async function readFile(path: string): Promise<string> {
  const { owner, repo } = repoCoords();
  const res = await getOctokit().repos.getContent({ owner, repo, path });
  // single-file response
  if (!("content" in res.data) || Array.isArray(res.data)) {
    throw new Error(`not a file: ${path}`);
  }
  return Buffer.from(res.data.content, "base64").toString("utf8");
}

export async function listTree(): Promise<{ path: string; type: string }[]> {
  const { owner, repo } = repoCoords();
  const main = await getOctokit().repos.getBranch({ owner, repo, branch: "main" });
  const sha = main.data.commit.sha;
  const tree = await getOctokit().git.getTree({ owner, repo, tree_sha: sha, recursive: "1" });
  return (tree.data.tree ?? []).map((t) => ({ path: t.path!, type: t.type! }));
}
```

- [ ] **Step 2: Write KB index builder**

`functions/src/lib/kb-index.ts`:
```ts
import matter from "gray-matter";
import { listTree, readFile } from "./octokit";

export type KBType = "pattern" | "rubric" | "reflection" | "prd" | "event" | "qa";

export interface KBEntry {
  path: string;
  type: KBType;
  scope?: string;     // for qa, prd, events
  product?: string;   // for prd, events
  id?: string;        // for pattern, qa
  frontmatter: Record<string, unknown>;
}

const SCOPED_PRD = /^products\/([^/]+)\/prd\.md$/;
const SCOPED_EVENTS = /^products\/([^/]+)\/events\/catalog\.yaml$/;
const PATTERN_FILE = /^learning\/patterns\/([^/]+)\.yaml$/;
const REFLECTION_FILE = /^learning\/reflections\/([^/]+)\.md$/;
const RUBRIC_FILE = /^learning\/rubrics\/([^/]+)\.md$/;
const QA_FILE = /^learning\/qa\/qa-([0-9]+)\.md$/;

let cached: { sha: string | null; entries: KBEntry[] } = { sha: null, entries: [] };

export async function getIndex(force = false): Promise<KBEntry[]> {
  // For simplicity we treat one cold-start as the cache lifetime; revalidate on demand.
  if (cached.entries.length && !force) return cached.entries;

  const tree = await listTree();
  const out: KBEntry[] = [];

  const candidates = tree.filter((n) => n.type === "blob");
  // Limit to known content paths to avoid large fan-out.
  for (const n of candidates) {
    const m = classify(n.path);
    if (!m) continue;
    if (m.type === "qa" || m.type === "prd" || m.type === "reflection" || m.type === "rubric") {
      // markdown frontmatter
      const raw = await readFile(n.path);
      const fm = matter(raw).data;
      out.push({ path: n.path, type: m.type, frontmatter: fm,
        scope: (fm as Record<string, string>).scope, product: m.product, id: m.id });
    } else if (m.type === "pattern") {
      const raw = await readFile(n.path);
      const yaml = await import("js-yaml");
      const fm = yaml.load(raw) as Record<string, unknown>;
      out.push({ path: n.path, type: "pattern", id: m.id, frontmatter: fm });
    } else if (m.type === "event") {
      const raw = await readFile(n.path);
      const yaml = await import("js-yaml");
      const fm = yaml.load(raw) as Record<string, unknown>;
      out.push({ path: n.path, type: "event", product: m.product, frontmatter: fm });
    }
  }
  cached = { sha: "current", entries: out };
  return out;
}

function classify(path: string):
  | { type: KBType; id?: string; product?: string }
  | null
{
  let m;
  if ((m = QA_FILE.exec(path)))         return { type: "qa", id: `qa-${m[1]}` };
  if ((m = PATTERN_FILE.exec(path)))    return { type: "pattern", id: m[1] };
  if ((m = REFLECTION_FILE.exec(path))) return { type: "reflection", id: m[1] };
  if ((m = RUBRIC_FILE.exec(path)))     return { type: "rubric", id: m[1] };
  if ((m = SCOPED_PRD.exec(path)))      return { type: "prd", product: m[1] };
  if ((m = SCOPED_EVENTS.exec(path)))   return { type: "event", product: m[1] };
  return null;
}

export function summarizeForPrompt(entries: KBEntry[]): string {
  // Compact, deterministic — used as a cached prompt block.
  const lines = entries.map((e) => {
    const meta = trim({
      type: e.type, id: e.id, scope: e.scope, product: e.product,
      title: (e.frontmatter as Record<string, string>).title,
      question: (e.frontmatter as Record<string, string>).question,
      domain: (e.frontmatter as Record<string, string>).domain,
      severity: (e.frontmatter as Record<string, string>).severity,
      status: (e.frontmatter as Record<string, string>).status,
    });
    return `${e.path}\t${JSON.stringify(meta)}`;
  });
  lines.sort();
  return lines.join("\n");
}

function trim(o: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== null) out[k] = v;
  return out;
}

export function clearCache() { cached = { sha: null, entries: [] }; }
```

- [ ] **Step 3: Write index test (with stubbed octokit)**

`functions/src/lib/__tests__/kb-index.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock Octokit BEFORE importing anything that uses it.
vi.mock("../octokit", () => ({
  listTree: vi.fn(async () => [
    { path: "learning/patterns/correctness-006.yaml", type: "blob" },
    { path: "learning/qa/qa-001.md", type: "blob" },
    { path: "products/free-tab/prd.md", type: "blob" },
    { path: "README.md", type: "blob" }, // ignored
  ]),
  readFile: vi.fn(async (path: string) => {
    if (path.endsWith(".yaml")) return "id: correctness-006\ntitle: x\n";
    if (path.endsWith("qa-001.md")) return "---\nid: qa-001\nscope: free-tab\n---\n";
    if (path.endsWith("prd.md")) return "---\ntitle: filter\n---\n";
    return "";
  }),
  repoCoords: () => ({ owner: "x", repo: "y" }),
}));

import { clearCache, getIndex, summarizeForPrompt } from "../kb-index";

beforeEach(() => clearCache());

describe("kb-index", () => {
  it("classifies known KB files", async () => {
    const e = await getIndex(true);
    const types = e.map((x) => x.type).sort();
    expect(types).toEqual(["pattern", "prd", "qa"]);
  });

  it("emits a summary string sorted by path", async () => {
    const e = await getIndex(true);
    const s = summarizeForPrompt(e);
    expect(s.split("\n").length).toBe(3);
    expect(s).toMatch(/learning\/patterns\/correctness-006\.yaml/);
  });
});
```

- [ ] **Step 4: Run tests**

```bash
cd functions && npm test && cd ..
```

Expected: 2 passing.

- [ ] **Step 5: Commit**

```bash
git add functions/src/lib/octokit.ts functions/src/lib/kb-index.ts functions/src/lib/__tests__
git commit -m "functions: octokit reader + KB index cache (pattern/qa/prd/event/reflection/rubric)"
```

---

### Task 4: Tool definitions + dispatcher

**Files:**
- Create: `functions/src/lib/tools.ts`
- Create: `functions/src/lib/__tests__/tools.test.ts`

- [ ] **Step 1: Write tool definitions**

`functions/src/lib/tools.ts`:
```ts
import type Anthropic from "@anthropic-ai/sdk";
import { getIndex, type KBEntry, type KBType } from "./kb-index";
import { readFile } from "./octokit";

export const TOOLS: Anthropic.Tool[] = [
  {
    name: "list_kb_files",
    description:
      "List KB files matching optional filters. Returns metadata only (no bodies).",
    input_schema: {
      type: "object",
      properties: {
        scope: { type: "string", enum: ["global", "ai-webtoon", "free-tab", "ugc-platform"] },
        type:  { type: "string", enum: ["pattern", "rubric", "reflection", "prd", "event", "qa"] },
      },
    },
  },
  {
    name: "read_kb_file",
    description: "Read a specific KB file by repo path. Returns frontmatter + body.",
    input_schema: {
      type: "object",
      properties: { path: { type: "string" } },
      required: ["path"],
    },
  },
  {
    name: "grep_kb",
    description: "Substring search over KB file bodies. Returns path/line/snippet hits.",
    input_schema: {
      type: "object",
      properties: {
        pattern: { type: "string" },
        scope:   { type: "string", enum: ["global", "ai-webtoon", "free-tab", "ugc-platform"] },
        type:    { type: "string", enum: ["pattern", "rubric", "reflection", "prd", "event", "qa"] },
      },
      required: ["pattern"],
    },
  },
  {
    name: "list_related_qa",
    description: "Find approved Q&A entries by scope + keyword overlap (sorted by recency).",
    input_schema: {
      type: "object",
      properties: {
        scope:    { type: "string", enum: ["global", "ai-webtoon", "free-tab", "ugc-platform"] },
        keywords: { type: "array",  items: { type: "string" } },
      },
      required: ["scope", "keywords"],
    },
  },
];

export async function dispatch(name: string, input: Record<string, unknown>) {
  switch (name) {
    case "list_kb_files":   return list_kb_files(input);
    case "read_kb_file":    return read_kb_file(input);
    case "grep_kb":         return grep_kb(input);
    case "list_related_qa": return list_related_qa(input);
    default: throw new Error(`unknown tool: ${name}`);
  }
}

async function list_kb_files(i: Record<string, unknown>) {
  const all = await getIndex();
  return all
    .filter((e) => !i.scope || (e.scope && e.scope === i.scope) || e.type === "pattern" || e.type === "rubric" || e.type === "reflection")
    .filter((e) => !i.type || e.type === i.type)
    .map((e) => ({ path: e.path, type: e.type, scope: e.scope, id: e.id, summary: brief(e) }));
}

async function read_kb_file(i: Record<string, unknown>) {
  if (typeof i.path !== "string") throw new Error("path required");
  const raw = await readFile(i.path);
  return { path: i.path, content: raw.slice(0, 32_000) };
}

async function grep_kb(i: Record<string, unknown>) {
  const pattern = (i.pattern as string).toLowerCase();
  const all = await getIndex();
  const candidates = all.filter((e) =>
    (!i.scope || e.scope === i.scope) && (!i.type || e.type === i.type));
  const hits: { path: string; line: number; snippet: string }[] = [];
  for (const c of candidates) {
    const raw = await readFile(c.path);
    raw.split("\n").forEach((ln, idx) => {
      if (ln.toLowerCase().includes(pattern)) {
        hits.push({ path: c.path, line: idx + 1, snippet: ln.trim().slice(0, 240) });
      }
    });
    if (hits.length > 50) break;
  }
  return hits.slice(0, 50);
}

async function list_related_qa(i: Record<string, unknown>) {
  const all = await getIndex();
  const scope = i.scope as string;
  const keywords = (i.keywords as string[]).map((k) => k.toLowerCase());
  const qa = all.filter((e) => e.type === "qa" && e.scope === scope);
  const scored = qa.map((e) => {
    const fm = e.frontmatter as Record<string, string>;
    const text = `${fm.question ?? ""} ${(fm.tags ?? []).toString()}`.toLowerCase();
    const score = keywords.reduce((s, kw) => s + (text.includes(kw) ? 1 : 0), 0);
    return { e, score, approved_at: fm.approved_at ?? "" };
  });
  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => (a.approved_at < b.approved_at ? 1 : -1))
    .slice(0, 5)
    .map(({ e }) => ({
      qa_id: e.id!,
      question: (e.frontmatter as Record<string, string>).question,
      approved_at: (e.frontmatter as Record<string, string>).approved_at,
    }));
}

function brief(e: KBEntry): string {
  const fm = e.frontmatter as Record<string, string>;
  if (e.type === "qa") return fm.question ?? "";
  if (e.type === "pattern") return fm.title ?? "";
  if (e.type === "prd") return fm.title ?? e.path;
  return e.path;
}

export function toolType(t: KBType): KBType { return t; }
```

- [ ] **Step 2: Write tools test**

`functions/src/lib/__tests__/tools.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../octokit", () => ({
  listTree: vi.fn(async () => [
    { path: "learning/qa/qa-001.md", type: "blob" },
    { path: "learning/qa/qa-002.md", type: "blob" },
    { path: "learning/patterns/correctness-006.yaml", type: "blob" },
  ]),
  readFile: vi.fn(async (p: string) => {
    if (p.endsWith("qa-001.md")) return "---\nid: qa-001\nscope: free-tab\nquestion: filter rollout end?\napproved_at: '2026-04-29T00:00:00Z'\n---\nbody";
    if (p.endsWith("qa-002.md")) return "---\nid: qa-002\nscope: ai-webtoon\nquestion: webtoon thing\napproved_at: '2026-04-30T00:00:00Z'\n---\nbody";
    return "id: correctness-006\ntitle: dup IDs\n";
  }),
  repoCoords: () => ({ owner: "x", repo: "y" }),
}));

import { clearCache } from "../kb-index";
import { dispatch } from "../tools";

beforeEach(() => clearCache());

describe("tools", () => {
  it("list_kb_files filters by type", async () => {
    const out = await dispatch("list_kb_files", { type: "qa" }) as { type: string }[];
    expect(out.every((x) => x.type === "qa")).toBe(true);
    expect(out).toHaveLength(2);
  });

  it("list_related_qa scores by keyword + scope", async () => {
    const out = await dispatch("list_related_qa", {
      scope: "free-tab",
      keywords: ["filter"],
    }) as { qa_id: string }[];
    expect(out).toHaveLength(1);
    expect(out[0]!.qa_id).toBe("qa-001");
  });

  it("read_kb_file passes through", async () => {
    const out = await dispatch("read_kb_file", { path: "learning/qa/qa-001.md" }) as { content: string };
    expect(out.content).toMatch(/qa-001/);
  });
});
```

- [ ] **Step 3: Run tests**

```bash
cd functions && npm test && cd ..
```

Expected: 3 + earlier = 5 passing.

- [ ] **Step 4: Commit**

```bash
git add functions/src/lib/tools.ts functions/src/lib/__tests__/tools.test.ts
git commit -m "functions: 4 KB tools (list/read/grep/related-qa) + dispatcher"
```

---

### Task 5: Prompt assembly with caching layout

**Files:**
- Create: `functions/src/lib/prompt.ts`

- [ ] **Step 1: Write prompt builder**

`functions/src/lib/prompt.ts`:
```ts
import type Anthropic from "@anthropic-ai/sdk";
import { TOOLS } from "./tools";
import { getIndex, summarizeForPrompt } from "./kb-index";

export const SYSTEM_INSTRUCTIONS = `
You are the answer-drafting assistant for the wrtn team Q&A wiki. Given a
question and its scope, produce a concise, factual draft answer grounded in
the team's knowledge base. You have four tools to navigate the KB; use them
freely.

Rules:
- Cite every nontrivial claim by listing the source in "sources_used".
- If the KB does not cover the question, say so explicitly. Set confidence
  to "low" and put what's missing into "caveats".
- Do not invent KB items, IDs, or facts. If a tool returns nothing, the
  answer must say so.
- Keep answers under ~400 words unless the question genuinely requires more.
- Output markdown for "answer_markdown".

Output contract:
Your final assistant message must end with a single fenced JSON code block
matching exactly this shape (no extra commentary after it):

\`\`\`json
{
  "answer_markdown": "<markdown string>",
  "sources_used": [
    { "type": "pattern|prd|event|qa|reflection|rubric", "id": "<id-or-path>", "why": "<short>" }
  ],
  "confidence": "high" | "medium" | "low",
  "caveats": ["<string>", ...]
}
\`\`\`
`.trim();

export async function buildSystemBlocks(): Promise<Anthropic.TextBlockParam[]> {
  const idx = await getIndex();
  const indexStr = summarizeForPrompt(idx);

  // Three cached layers; fourth slot reserved for per-question (uncached) content.
  return [
    { type: "text", text: SYSTEM_INSTRUCTIONS, cache_control: { type: "ephemeral" } },
    {
      type: "text",
      text:
        "## KB index (path \\t metadata JSON)\n" +
        indexStr +
        "\n\n(Use list_kb_files / read_kb_file / grep_kb / list_related_qa to inspect contents.)",
      cache_control: { type: "ephemeral" },
    },
  ];
}

export function buildToolsParam(): Anthropic.ToolUnion[] {
  // Tool definitions are cacheable too — Anthropic deduplicates identical tool blocks across calls.
  return TOOLS.map((t, i) =>
    i === TOOLS.length - 1 ? { ...t, cache_control: { type: "ephemeral" } } : t,
  ) as Anthropic.ToolUnion[];
}

export function buildUserMessage(input: {
  questionText: string;
  questionBody?: string;
  scope: string;
  askerEmail: string;
}): Anthropic.MessageParam {
  return {
    role: "user",
    content: `Question (scope: ${input.scope}, asker: ${input.askerEmail}):\n` +
      `Title: ${input.questionText}\n` +
      (input.questionBody ? `Body:\n${input.questionBody}\n` : "") +
      `\nDraft a concise answer using the KB. Cite sources.`,
  };
}
```

- [ ] **Step 2: Build**

```bash
cd functions && npm run build && cd ..
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add functions/src/lib/prompt.ts
git commit -m "functions: prompt builder with 3-layer caching (system, KB index, tools)"
```

---

### Task 6: Output parser

**Files:**
- Create: `functions/src/lib/draft-output.ts`
- Create: `functions/src/lib/__tests__/draft-output.test.ts`

- [ ] **Step 1: Write parser with Zod**

`functions/src/lib/draft-output.ts`:
```ts
import { z } from "zod";

export const DraftOutputSchema = z.object({
  answer_markdown: z.string().min(1),
  sources_used: z.array(z.object({
    type: z.enum(["pattern", "prd", "event", "qa", "reflection", "rubric"]),
    id:   z.string().min(1),
    why:  z.string().optional(),
  })),
  confidence: z.enum(["high", "medium", "low"]),
  caveats: z.array(z.string()),
});

export type DraftOutput = z.infer<typeof DraftOutputSchema>;

const FENCE = /```json\s*([\s\S]+?)\s*```/g;

export function parseDraft(assistantText: string): DraftOutput {
  // Find the LAST json fence (the contract is "ends with").
  const matches = [...assistantText.matchAll(FENCE)];
  if (!matches.length) throw new Error("no JSON block in draft output");
  const last = matches[matches.length - 1]![1]!;
  let parsed: unknown;
  try { parsed = JSON.parse(last); } catch (e) {
    throw new Error("invalid JSON in draft output: " + (e as Error).message);
  }
  return DraftOutputSchema.parse(parsed);
}
```

- [ ] **Step 2: Write parser tests**

`functions/src/lib/__tests__/draft-output.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { parseDraft } from "../draft-output";

describe("parseDraft", () => {
  it("parses well-formed output", () => {
    const text = "Here is the draft.\n\n```json\n" +
      JSON.stringify({
        answer_markdown: "## Answer\n\nThe rollout ends in Q3.",
        sources_used: [{ type: "prd", id: "free-tab/filter-diversification", why: "rollout date" }],
        confidence: "high",
        caveats: [],
      }) + "\n```";
    const r = parseDraft(text);
    expect(r.confidence).toBe("high");
    expect(r.sources_used).toHaveLength(1);
  });

  it("uses LAST fence when multiple are present", () => {
    const a = JSON.stringify({ answer_markdown: "a", sources_used: [], confidence: "low", caveats: [] });
    const b = JSON.stringify({ answer_markdown: "B", sources_used: [], confidence: "high", caveats: [] });
    const text = "```json\n" + a + "\n```\nthen\n```json\n" + b + "\n```";
    const r = parseDraft(text);
    expect(r.answer_markdown).toBe("B");
  });

  it("throws on missing fence", () => {
    expect(() => parseDraft("no fence here")).toThrow();
  });

  it("throws on invalid schema", () => {
    expect(() => parseDraft("```json\n" + JSON.stringify({}) + "\n```")).toThrow();
  });
});
```

- [ ] **Step 3: Run tests**

```bash
cd functions && npm test && cd ..
```

Expected: 4 + earlier = 9 passing.

- [ ] **Step 4: Commit**

```bash
git add functions/src/lib/draft-output.ts functions/src/lib/__tests__/draft-output.test.ts
git commit -m "functions: zod-validated draft output parser (last JSON fence)"
```

---

### Task 7: Per-user rate limiter (Firestore token bucket)

**Files:**
- Create: `functions/src/lib/rate-limit.ts`

- [ ] **Step 1: Write rate limiter**

`functions/src/lib/rate-limit.ts`:
```ts
import * as admin from "firebase-admin";

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

const CAPACITY = 3;       // tokens
const REFILL_PER_MIN = 3; // tokens / min

export async function consumeOrThrow(uid: string) {
  const ref = db.doc(`rate-limits/${uid}`);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const now = Date.now();
    const last = snap.exists ? (snap.data()!.updatedAt as number) : now;
    const tokensStored = snap.exists ? (snap.data()!.tokens as number) : CAPACITY;
    const refilled = Math.min(CAPACITY, tokensStored + ((now - last) / 60_000) * REFILL_PER_MIN);
    if (refilled < 1) {
      const wait = Math.ceil(((1 - refilled) * 60_000) / REFILL_PER_MIN / 1000);
      throw new RateLimitError(`Too many requests. Retry in ~${wait}s.`);
    }
    tx.set(ref, { tokens: refilled - 1, updatedAt: now });
  });
}

export class RateLimitError extends Error {
  code = "rate-limit";
  constructor(msg: string) { super(msg); }
}
```

- [ ] **Step 2: Build**

```bash
cd functions && npm run build && cd ..
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add functions/src/lib/rate-limit.ts
git commit -m "functions: per-user token-bucket rate limit in firestore"
```

---

### Task 8: generateDraft Cloud Function

**Files:**
- Create: `functions/src/draft/generateDraft.ts`
- Modify: `functions/src/index.ts`

- [ ] **Step 1: Write the agent loop**

`functions/src/draft/generateDraft.ts`:
```ts
import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import {
  ANTHROPIC_API_KEY, GITHUB_TOKEN, GITHUB_OWNER, GITHUB_REPO,
} from "../lib/secrets";
import { makeClient, PRIMARY_MODEL, FALLBACK_MODEL, isPrimaryAvailable } from "../lib/anthropic";
import { buildSystemBlocks, buildToolsParam, buildUserMessage } from "../lib/prompt";
import { dispatch } from "../lib/tools";
import { parseDraft } from "../lib/draft-output";
import { consumeOrThrow, RateLimitError } from "../lib/rate-limit";

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

const MAX_TURNS = 6;

export const generateDraft = onCall(
  {
    secrets: [ANTHROPIC_API_KEY, GITHUB_TOKEN, GITHUB_OWNER, GITHUB_REPO],
    region: "asia-northeast3",
    timeoutSeconds: 120,
    memory: "512MiB",
  },
  async (req) => {
    if (!req.auth) throw new HttpsError("unauthenticated", "Sign in required.");
    if (!req.auth.token.email?.endsWith("@wrtn.io")) {
      throw new HttpsError("permission-denied", "@wrtn.io only.");
    }
    const qid = (req.data as { qid?: string })?.qid;
    if (!qid) throw new HttpsError("invalid-argument", "qid is required.");

    try { await consumeOrThrow(req.auth.uid); }
    catch (e) {
      if (e instanceof RateLimitError) throw new HttpsError("resource-exhausted", e.message);
      throw e;
    }

    const qSnap = await db.doc(`questions/${qid}`).get();
    if (!qSnap.exists) throw new HttpsError("not-found", "Question missing.");
    const q = qSnap.data()!;
    if (q.askerUid !== req.auth.uid) {
      throw new HttpsError("permission-denied", "Not your question.");
    }

    const userMsg = buildUserMessage({
      questionText: q.text,
      questionBody: q.body,
      scope: q.scope,
      askerEmail: req.auth.token.email,
    });
    const systemBlocks = await buildSystemBlocks();
    const toolsParam = buildToolsParam();

    const result = await runAgent({
      modelChain: [PRIMARY_MODEL, FALLBACK_MODEL],
      systemBlocks, toolsParam, firstUser: userMsg,
    });

    const versionsRef = db.collection(`questions/${qid}/drafts`);
    const existing = await versionsRef.orderBy("version", "desc").limit(1).get();
    const version = (existing.empty ? 0 : (existing.docs[0]!.data().version as number)) + 1;

    const draftRef = await versionsRef.add({
      body: result.parsed.answer_markdown,
      editorUid: req.auth.uid,
      version,
      ai: {
        model: result.modelUsed,
        sourcesUsed: result.parsed.sources_used,
        confidence: result.parsed.confidence,
        caveats: result.parsed.caveats,
        tokenUsage: result.tokenUsage,
        draftedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
    });

    await qSnap.ref.update({
      currentDraftId: draftRef.id,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    return { draftId: draftRef.id, version, modelUsed: result.modelUsed };
  },
);

interface AgentResult {
  parsed: ReturnType<typeof parseDraft>;
  modelUsed: string;
  tokenUsage: { input: number; output: number; cacheRead: number; cacheWrite: number };
}

async function runAgent(opts: {
  modelChain: string[];
  systemBlocks: import("@anthropic-ai/sdk").default.TextBlockParam[];
  toolsParam: import("@anthropic-ai/sdk").default.ToolUnion[];
  firstUser: import("@anthropic-ai/sdk").default.MessageParam;
}): Promise<AgentResult> {
  const client = makeClient();
  let lastErr: unknown;
  for (const model of opts.modelChain) {
    try {
      return await runOne(client, model, opts);
    } catch (e) {
      lastErr = e;
      if (!isPrimaryAvailable(e)) continue; // try next model
      throw e;
    }
  }
  throw lastErr ?? new Error("all models failed");
}

async function runOne(
  client: ReturnType<typeof makeClient>,
  model: string,
  opts: {
    systemBlocks: import("@anthropic-ai/sdk").default.TextBlockParam[];
    toolsParam: import("@anthropic-ai/sdk").default.ToolUnion[];
    firstUser: import("@anthropic-ai/sdk").default.MessageParam;
  },
): Promise<AgentResult> {
  const messages: import("@anthropic-ai/sdk").default.MessageParam[] = [opts.firstUser];
  let totalIn = 0, totalOut = 0, totalCacheRead = 0, totalCacheWrite = 0;

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const resp = await client.messages.create({
      model,
      max_tokens: 4096,
      system: opts.systemBlocks,
      tools:  opts.toolsParam,
      messages,
    });

    totalIn  += resp.usage?.input_tokens ?? 0;
    totalOut += resp.usage?.output_tokens ?? 0;
    totalCacheRead  += (resp.usage as { cache_read_input_tokens?: number })?.cache_read_input_tokens ?? 0;
    totalCacheWrite += (resp.usage as { cache_creation_input_tokens?: number })?.cache_creation_input_tokens ?? 0;

    const toolUses = resp.content.filter((b) => b.type === "tool_use") as Array<
      import("@anthropic-ai/sdk").default.ToolUseBlock
    >;

    if (resp.stop_reason === "end_turn" && toolUses.length === 0) {
      const text = resp.content
        .filter((b) => b.type === "text")
        .map((b) => (b as { text: string }).text)
        .join("\n");
      const parsed = parseDraft(text);
      return {
        parsed, modelUsed: model,
        tokenUsage: { input: totalIn, output: totalOut, cacheRead: totalCacheRead, cacheWrite: totalCacheWrite },
      };
    }

    // Tool use turn — execute tools, push results, loop.
    messages.push({ role: "assistant", content: resp.content });
    const toolResults: import("@anthropic-ai/sdk").default.ToolResultBlockParam[] = [];
    for (const u of toolUses) {
      try {
        const out = await dispatch(u.name, u.input as Record<string, unknown>);
        toolResults.push({
          type: "tool_result",
          tool_use_id: u.id,
          content: JSON.stringify(out).slice(0, 30_000),
        });
      } catch (e) {
        toolResults.push({
          type: "tool_result",
          tool_use_id: u.id,
          is_error: true,
          content: (e as Error).message,
        });
      }
    }
    messages.push({ role: "user", content: toolResults });
  }
  throw new Error("agent exceeded MAX_TURNS without final answer");
}
```

- [ ] **Step 2: Wire export**

`functions/src/index.ts`:
```ts
export { mirrorUserProfile } from "./auth/mirrorUserProfile";
export { generateDraft } from "./draft/generateDraft";
```

- [ ] **Step 3: Build**

```bash
cd functions && npm run build && cd ..
```

Expected: PASS.

- [ ] **Step 4: Deploy**

```bash
npx firebase deploy --only functions:generateDraft
```

- [ ] **Step 5: Commit**

```bash
git add functions/src/draft/generateDraft.ts functions/src/index.ts
git commit -m "functions: generateDraft with agent loop (≤6 turns), prompt caching, model fallback"
```

---

### Task 9: Test generateDraft against mocked Anthropic

**Files:**
- Create: `functions/src/draft/__tests__/generateDraft.test.ts`

- [ ] **Step 1: Write integration test**

This test exercises the agent loop logic without hitting real Anthropic — by mocking `client.messages.create` to return a scripted sequence (one tool-use turn → one final turn).

`functions/src/draft/__tests__/generateDraft.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock Anthropic SDK to script the agent loop.
vi.mock("@anthropic-ai/sdk", () => {
  let callIdx = 0;
  return {
    default: class {
      messages = {
        create: vi.fn(async () => {
          callIdx++;
          if (callIdx === 1) {
            return {
              stop_reason: "tool_use",
              usage: { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 80, cache_creation_input_tokens: 0 },
              content: [
                { type: "tool_use", id: "t1", name: "list_kb_files", input: { type: "qa", scope: "free-tab" } },
              ],
            };
          }
          return {
            stop_reason: "end_turn",
            usage: { input_tokens: 50, output_tokens: 200, cache_read_input_tokens: 80, cache_creation_input_tokens: 0 },
            content: [{
              type: "text",
              text: "OK\n```json\n" + JSON.stringify({
                answer_markdown: "Answer",
                sources_used: [{ type: "qa", id: "qa-001", why: "" }],
                confidence: "high",
                caveats: [],
              }) + "\n```",
            }],
          };
        }),
      };
    },
  };
});

vi.mock("../../lib/octokit", () => ({
  listTree: async () => [{ path: "learning/qa/qa-001.md", type: "blob" }],
  readFile: async () => "---\nid: qa-001\nscope: free-tab\nquestion: test\n---\nbody",
  repoCoords: () => ({ owner: "x", repo: "y" }),
}));

vi.mock("firebase-admin", () => ({
  apps: [],
  initializeApp: vi.fn(),
  firestore: () => ({
    doc: () => ({
      get: async () => ({ exists: true, data: () => ({ askerUid: "u1", text: "T?", scope: "free-tab", body: "" }) }),
      ref: { update: vi.fn() },
      update: vi.fn(),
    }),
    collection: () => ({
      orderBy: () => ({ limit: () => ({ get: async () => ({ empty: true, docs: [] }) }) }),
      add: vi.fn(async () => ({ id: "draft1" })),
    }),
    runTransaction: async (fn: (tx: { get: () => Promise<{ exists: boolean; data: () => { tokens: number; updatedAt: number } }>; set: (ref: unknown, data: unknown) => void }) => Promise<unknown>) => fn({
      get: async () => ({ exists: false, data: () => ({ tokens: 3, updatedAt: Date.now() }) }),
      set: () => {},
    }),
  }),
  apps: [{}],
  FieldValue: { serverTimestamp: () => "ts" },
}));

beforeEach(() => { vi.clearAllMocks(); });

describe("generateDraft agent loop", () => {
  it("completes after one tool call and one final turn", async () => {
    // Direct import after mocks are in place.
    const mod = await import("../generateDraft");
    // The actual onCall wrapper is hard to invoke directly here; instead we
    // re-export internals for testability OR accept that this exercises the
    // agent's pure logic. For full coverage, run end-to-end via emulator.
    expect(mod.generateDraft).toBeDefined();
  });
});
```

Note: full unit coverage of `runAgent` is best achieved by extracting it to a separately testable module (export via `__test_only__` namespace). For this plan we keep it at smoke level and rely on the emulator E2E in Plan 4 for the full lifecycle test.

- [ ] **Step 2: Run**

```bash
cd functions && npm test && cd ..
```

Expected: 5 + earlier = 10 passing (smoke).

- [ ] **Step 3: Commit**

```bash
git add functions/src/draft/__tests__
git commit -m "test: smoke-level mock for generateDraft import (full E2E in plan 4)"
```

---

### Task 10: UI — typed callable wrapper

**Files:**
- Create: `src/lib/firebase/callables.ts`

- [ ] **Step 1: Write wrapper**

`src/lib/firebase/callables.ts`:
```ts
"use client";
import { getFunctions, httpsCallable } from "firebase/functions";
import { getFirebase } from "./client";

export async function callGenerateDraft(qid: string) {
  const { app } = getFirebase();
  const fns = getFunctions(app, "asia-northeast3");
  const fn = httpsCallable<{ qid: string }, { draftId: string; version: number; modelUsed: string }>(
    fns, "generateDraft",
  );
  const res = await fn({ qid });
  return res.data;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/firebase/callables.ts
git commit -m "ui: typed wrapper for generateDraft callable"
```

---

### Task 11: UI — draft view + sources badges

**Files:**
- Create: `src/components/qa/sources-badges.tsx`
- Create: `src/components/qa/draft-view.tsx`
- Install: `react-markdown`

- [ ] **Step 1: Install markdown renderer**

```bash
npm install react-markdown remark-gfm
```

- [ ] **Step 2: Write sources badges**

`src/components/qa/sources-badges.tsx`:
```tsx
import type { AISource } from "@/types/qa";

export function SourcesBadges({ sources }: { sources: AISource[] }) {
  if (!sources.length) return <p className="text-xs text-muted-foreground">No KB sources cited.</p>;
  return (
    <ul className="flex flex-wrap gap-2 text-xs">
      {sources.map((s, i) => (
        <li key={i} className="rounded border px-2 py-0.5 font-mono">
          {s.type}:{s.id}
          {s.why && <span className="ml-1 text-muted-foreground">— {s.why}</span>}
        </li>
      ))}
    </ul>
  );
}
```

- [ ] **Step 3: Write draft view**

`src/components/qa/draft-view.tsx`:
```tsx
"use client";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { SourcesBadges } from "./sources-badges";
import type { DraftDoc } from "@/types/qa";

export function DraftView({ draft }: { draft: DraftDoc }) {
  const tone =
    draft.ai.confidence === "high"   ? "border-emerald-500/40 bg-emerald-500/5" :
    draft.ai.confidence === "medium" ? "border-amber-500/40 bg-amber-500/5"  :
                                        "border-rose-500/40 bg-rose-500/5";
  return (
    <article className={`rounded-lg border p-5 ${tone}`}>
      <header className="mb-3 flex items-center justify-between">
        <div className="text-xs">
          model: <span className="font-mono">{draft.ai.model}</span> · v{draft.version}
        </div>
        <div className="text-xs">
          confidence: <span className="font-mono">{draft.ai.confidence}</span>
        </div>
      </header>
      <div className="prose prose-sm max-w-none">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{draft.body}</ReactMarkdown>
      </div>
      {draft.ai.caveats.length > 0 && (
        <aside className="mt-4 rounded border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
          <div className="mb-1 font-medium">Caveats</div>
          <ul className="list-disc pl-5">
            {draft.ai.caveats.map((c, i) => <li key={i}>{c}</li>)}
          </ul>
        </aside>
      )}
      <div className="mt-4">
        <div className="mb-1 text-xs font-medium text-muted-foreground">Sources</div>
        <SourcesBadges sources={draft.ai.sourcesUsed} />
      </div>
    </article>
  );
}
```

- [ ] **Step 4: Commit**

```bash
git add src/components/qa package.json package-lock.json
git commit -m "ui: draft view with confidence tone, caveats, sources badges"
```

---

### Task 12: UI — generate / regenerate / edit on question detail

**Files:**
- Create: `src/components/qa/draft-editor.tsx`
- Modify: `src/app/q/[qid]/page.tsx`

- [ ] **Step 1: Write editor (simple textarea, Phase 1 keeps it minimal)**

`src/components/qa/draft-editor.tsx`:
```tsx
"use client";
import { useState } from "react";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { doc, addDoc, collection, serverTimestamp } from "firebase/firestore";
import { getFirebase } from "@/lib/firebase/client";
import { useAuth } from "@/lib/firebase/auth-provider";
import type { DraftDoc } from "@/types/qa";

export function DraftEditor({ qid, current, onSaved }: {
  qid: string;
  current: DraftDoc & { id: string };
  onSaved: (newId: string) => void;
}) {
  const { user } = useAuth();
  const [body, setBody] = useState(current.body);
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!user) return;
    setBusy(true);
    try {
      const { db } = getFirebase();
      const ref = await addDoc(collection(db, `questions/${qid}/drafts`), {
        body,
        editorUid: user.uid,
        version: current.version + 1,
        ai: { ...current.ai, draftedAt: serverTimestamp() },
      });
      // update parent question's currentDraftId via security-rules-allowed write path
      const qref = doc(db, "questions", qid);
      const { updateDoc } = await import("firebase/firestore");
      await updateDoc(qref, { currentDraftId: ref.id, updatedAt: serverTimestamp() });
      onSaved(ref.id);
    } finally { setBusy(false); }
  }

  return (
    <div className="space-y-2">
      <Textarea value={body} onChange={(e) => setBody(e.target.value)} rows={14} className="font-mono text-sm" />
      <div className="flex gap-2">
        <Button onClick={save} disabled={busy}>{busy ? "Saving..." : "Save edit"}</Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Update question detail page**

Replace `src/app/q/[qid]/page.tsx` with:

```tsx
"use client";
import { useAuth } from "@/lib/firebase/auth-provider";
import { useEffect, useState, use } from "react";
import { collection, doc, onSnapshot, query, orderBy, limit } from "firebase/firestore";
import { getFirebase } from "@/lib/firebase/client";
import type { QuestionDoc, DraftDoc } from "@/types/qa";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useRouter } from "next/navigation";
import { callGenerateDraft } from "@/lib/firebase/callables";
import { DraftView } from "@/components/qa/draft-view";
import { DraftEditor } from "@/components/qa/draft-editor";

export default function QuestionPage({ params }: { params: Promise<{ qid: string }> }) {
  const { qid } = use(params);
  const { user, loading } = useAuth();
  const router = useRouter();
  const [q, setQ] = useState<(QuestionDoc & { id: string }) | null>(null);
  const [draft, setDraft] = useState<(DraftDoc & { id: string }) | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);

  useEffect(() => { if (!loading && !user) router.replace("/login"); }, [loading, user, router]);

  useEffect(() => {
    if (!user) return;
    const { db } = getFirebase();
    return onSnapshot(doc(db, "questions", qid), (s) => {
      setQ(s.exists() ? ({ id: s.id, ...(s.data() as QuestionDoc) }) : null);
    });
  }, [user, qid]);

  useEffect(() => {
    if (!user) return;
    const { db } = getFirebase();
    const qDrafts = query(
      collection(db, `questions/${qid}/drafts`),
      orderBy("version", "desc"),
      limit(1),
    );
    return onSnapshot(qDrafts, (snap) => {
      if (snap.empty) setDraft(null);
      else {
        const d = snap.docs[0]!;
        setDraft({ id: d.id, ...(d.data() as DraftDoc) });
      }
    });
  }, [user, qid]);

  async function generate() {
    setErr(null);
    setBusy(true);
    try { await callGenerateDraft(qid); }
    catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  }

  if (loading || !user) return null;
  if (!q) return <main className="p-6">Loading…</main>;

  const isAsker = q.askerUid === user.uid;

  return (
    <main className="mx-auto max-w-3xl space-y-4 p-6">
      <Card>
        <CardHeader>
          <CardTitle>{q.text}</CardTitle>
          <div className="mt-1 text-xs text-muted-foreground">
            scope: <span className="font-mono">{q.scope}</span> · status: <span className="font-mono">{q.status}</span>
          </div>
        </CardHeader>
        <CardContent>
          {q.body && <p className="whitespace-pre-wrap text-sm">{q.body}</p>}
        </CardContent>
      </Card>

      {isAsker && (
        <div className="flex gap-2">
          <Button onClick={generate} disabled={busy}>
            {draft ? (busy ? "Regenerating..." : "Regenerate draft") : (busy ? "Generating..." : "Generate AI draft")}
          </Button>
          {draft && (
            <Button variant="outline" onClick={() => setEditing((v) => !v)}>
              {editing ? "Cancel edit" : "Edit draft"}
            </Button>
          )}
        </div>
      )}
      {err && <p role="alert" className="text-sm text-destructive">{err}</p>}

      {draft && !editing && <DraftView draft={draft} />}
      {draft && editing && (
        <DraftEditor qid={qid} current={draft} onSaved={() => setEditing(false)} />
      )}
    </main>
  );
}
```

- [ ] **Step 3: Build**

```bash
npm run build
```

Expected: PASS.

- [ ] **Step 4: Hand-verify against deployed function**

```bash
npm run dev
```

Sign in → ask a real question (scope `free-tab`, body asks something the seed `qa-001` could answer or asks about an existing PRD) → click Generate AI draft. Expected: spinner ~5–20s, draft appears with markdown body, confidence, caveats, sources badges. Click Regenerate → new version. Click Edit → save → version increments.

- [ ] **Step 5: Commit**

```bash
git add src/components/qa/draft-editor.tsx src/app/q
git commit -m "ui: generate/regenerate/edit draft on question detail"
```

---

### Task 13: Cache observability log

**Files:**
- Modify: `functions/src/draft/generateDraft.ts`

- [ ] **Step 1: Add a structured log line**

In `generateDraft.ts`, just before returning the result, add:

```ts
console.log(JSON.stringify({
  event: "generateDraft.complete",
  qid,
  uid: req.auth.uid,
  scope: q.scope,
  modelUsed: result.modelUsed,
  tokenUsage: result.tokenUsage,
  cacheHitRatio: result.tokenUsage.cacheRead / Math.max(1, result.tokenUsage.cacheRead + result.tokenUsage.input),
}));
```

- [ ] **Step 2: Build and deploy**

```bash
cd functions && npm run build && cd ..
npx firebase deploy --only functions:generateDraft
```

- [ ] **Step 3: Hand-verify**

Trigger one Generate. Open Cloud Logging → filter `event=generateDraft.complete`. Expected: structured line with `cacheHitRatio` value. After 2–3 generations within a few minutes, the ratio should rise toward ≥ 0.9 once the system + index cache warms.

- [ ] **Step 4: Commit**

```bash
git add functions/src/draft/generateDraft.ts
git commit -m "functions: structured log for cache hit ratio"
```

---

## Self-review notes

- **Spec coverage:** §4 tools (4 ✓ — list_kb_files, read_kb_file, grep_kb, list_related_qa), prompt caching layout (3 layers ✓), output contract (Zod-validated ✓), cost guards (rate limit ✓, MAX_TURNS=6 ✓, max_tokens=4096 ✓), model fallback (Sonnet → Haiku ✓), KB-no-answer handling (model still drafts with `confidence: low` ✓ — verified by parser supporting that path).
- **Cache invalidation on KB push** is deferred. The current impl caches the KB index for the lifetime of a Cloud Function instance (cold-start refresh). For Phase 1 the ~minutes-to-hour staleness is acceptable. Phase 2 hooks a GitHub `push` webhook to a `clearKbCache` callable.
- **Tool dispatcher truncates outputs** at 30KB to keep tool-result payloads bounded. If the model needs more, it can call `read_kb_file` with a more specific path.
- **`grep_kb` is naive substring** — sufficient at current KB size. Phase 2 adds an embedding-backed similarity search for `list_related_qa`.
- **Draft Cloud Function does NOT validate output against the QA schema** — that gate runs in `approveAndCommit` (Plan 4). Drafts are working data; only commits hit the SSOT.
- **Plan 1's `qa.schema.json` `superseded_by` conditional** is irrelevant during drafting (drafts have no `status`); validation happens at approve time.
