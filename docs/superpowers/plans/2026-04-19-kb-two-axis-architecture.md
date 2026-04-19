# KB Two-Axis Architecture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restructure zzem-knowledge-base into two clearly-separated axes (`learning/` for meta-knowledge, `products/` for product specs), add PRD + events schemas, migrate reflection `domain` to a closed enum, and update all validators/skills/CI to match.

**Architecture:** Single PR, 6 logical commits. Commits 1–3 reshape the filesystem and content; commits 4–5 update tooling; commit 6 updates docs. Each commit leaves `npm run validate` green so the tree is always shippable mid-review. TDD applies to the two new validators (§Task 13 and §Task 14) via fixture-driven tests.

**Tech Stack:** Node ≥20, AJV 2020 (`ajv/dist/2020.js`), `ajv-formats`, `js-yaml`, `gray-matter`. No new runtime deps.

**Spec:** `docs/superpowers/specs/2026-04-19-kb-two-axis-architecture-design.md`

---

## File Structure

### Moves (git mv, history preserved)

```
content/patterns/             → learning/patterns/
content/reflections/          → learning/reflections/
content/rubrics/              → learning/rubrics/
schemas/pattern.schema.json   → schemas/learning/pattern.schema.json
schemas/reflection.schema.json → schemas/learning/reflection.schema.json
schemas/rubric.schema.json    → schemas/learning/rubric.schema.json
```

### New files

```
schemas/products/prd.schema.json                    # axis 2 PRD schema
schemas/products/events.schema.json                 # axis 2 events schema
products/README.md                                  # axis 2 write guide
products/ai-webtoon/prd.md                          # skeleton
products/ai-webtoon/events.yaml                     # skeleton
products/free-tab/prd.md                            # skeleton
products/free-tab/events.yaml                       # skeleton
products/ugc-platform/prd.md                        # skeleton
products/ugc-platform/events.yaml                   # skeleton
scripts/validate-product-schemas.mjs                # new validator
scripts/validate-product-dir-enum.mjs               # new validator
tests/fixtures/valid-prd.md                         # new
tests/fixtures/invalid-prd-bad-product.md           # new
tests/fixtures/invalid-prd-missing-status.md        # new
tests/fixtures/valid-events.yaml                    # new
tests/fixtures/invalid-events-bad-name.yaml         # new
tests/fixtures/invalid-events-missing-trigger.yaml  # new
tests/fixtures/invalid-events-empty.yaml            # new
```

### Modified files

```
scripts/validate-pattern-schemas.mjs          # path constants
scripts/validate-filename-id-match.mjs        # path constants
scripts/validate-unique-ids.mjs               # path constants
scripts/validate-fixtures.mjs                 # schema path resolver
scripts/validate-markdown-frontmatter.mjs     # path constants (both)
scripts/validate-schema-backwards-compat.mjs  # path constants
package.json                                  # scripts block reorg
.github/workflows/validate.yml                # step names
skills/read/SKILL.md                          # type + path table
skills/write-pattern/SKILL.md                 # paths
skills/update-pattern/SKILL.md                # paths
skills/write-reflection/SKILL.md              # paths + domain enum
schemas/learning/reflection.schema.json       # enum added (after move)
learning/reflections/ai-webtoon.md            # domain value migration
README.md                                     # content type table
docs/superpowers/specs/2026-04-19-reflection-domain-enum-design.md  # already has superseded marker
```

---

# Commit 1 — migrate: content/ → learning/

## Task 1: Move content directories

**Files:**
- Move: `content/patterns/` → `learning/patterns/`
- Move: `content/reflections/` → `learning/reflections/`
- Move: `content/rubrics/` → `learning/rubrics/`

- [ ] **Step 1: Move with git mv (preserves history)**

```bash
cd /Users/zachryu/dev/work/zzem-knowledge-base
mkdir -p learning
git mv content/patterns learning/patterns
git mv content/reflections learning/reflections
git mv content/rubrics learning/rubrics
rmdir content
```

- [ ] **Step 2: Confirm moves**

Run: `ls learning/ && ! test -d content && echo "content/ gone"`
Expected: `patterns  reflections  rubrics` followed by `content/ gone`

## Task 2: Move schema files into schemas/learning/

**Files:**
- Move: `schemas/pattern.schema.json` → `schemas/learning/pattern.schema.json`
- Move: `schemas/reflection.schema.json` → `schemas/learning/reflection.schema.json`
- Move: `schemas/rubric.schema.json` → `schemas/learning/rubric.schema.json`

- [ ] **Step 1: Create subdir and move**

```bash
cd /Users/zachryu/dev/work/zzem-knowledge-base
mkdir -p schemas/learning
git mv schemas/pattern.schema.json schemas/learning/pattern.schema.json
git mv schemas/reflection.schema.json schemas/learning/reflection.schema.json
git mv schemas/rubric.schema.json schemas/learning/rubric.schema.json
```

- [ ] **Step 2: Update `$id` in each schema**

The `$id` URL includes the path; bring it in sync so AJV registration and external dereferencing remain consistent.

Edit `schemas/learning/pattern.schema.json` line 3:
- Old: `"$id": "https://zach-wrtn.github.io/knowledge-base/schemas/pattern.schema.json",`
- New: `"$id": "https://zach-wrtn.github.io/knowledge-base/schemas/learning/pattern.schema.json",`

Edit `schemas/learning/reflection.schema.json` line 3:
- Old: `"$id": "https://zach-wrtn.github.io/knowledge-base/schemas/reflection.schema.json",`
- New: `"$id": "https://zach-wrtn.github.io/knowledge-base/schemas/learning/reflection.schema.json",`

Edit `schemas/learning/rubric.schema.json` line 3 (run this first to get the exact current URL):
```bash
grep '"\$id"' schemas/learning/rubric.schema.json
```
Then change `schemas/rubric.schema.json` → `schemas/learning/rubric.schema.json` in the same pattern.

## Task 3: Update `validate-pattern-schemas.mjs` path constants

**Files:**
- Modify: `scripts/validate-pattern-schemas.mjs`

- [ ] **Step 1: Swap schema load path**

Edit `scripts/validate-pattern-schemas.mjs` line 12:
- Old:
  ```js
  JSON.parse(readFileSync(join(ROOT, "schemas", "pattern.schema.json"), "utf8"))
  ```
- New:
  ```js
  JSON.parse(readFileSync(join(ROOT, "schemas", "learning", "pattern.schema.json"), "utf8"))
  ```

- [ ] **Step 2: Swap default target directory**

Edit `scripts/validate-pattern-schemas.mjs` line 39:
- Old: `: join(ROOT, "content", "patterns");`
- New: `: join(ROOT, "learning", "patterns");`

## Task 4: Update `validate-filename-id-match.mjs` path

**Files:**
- Modify: `scripts/validate-filename-id-match.mjs`

- [ ] **Step 1: Swap mainDir path**

Edit `scripts/validate-filename-id-match.mjs` line 14:
- Old: `return join(ROOT, "content", "patterns");`
- New: `return join(ROOT, "learning", "patterns");`

## Task 5: Update `validate-unique-ids.mjs` path

**Files:**
- Modify: `scripts/validate-unique-ids.mjs`

- [ ] **Step 1: Swap default dirs**

Edit `scripts/validate-unique-ids.mjs` line 33:
- Old:
  ```js
  : [join(ROOT, "content/patterns"), join(ROOT, "archived/patterns")];
  ```
- New:
  ```js
  : [join(ROOT, "learning/patterns"), join(ROOT, "archived/patterns")];
  ```

## Task 6: Update `validate-markdown-frontmatter.mjs` paths

**Files:**
- Modify: `scripts/validate-markdown-frontmatter.mjs`

- [ ] **Step 1: Swap loadSchema to use learning/ subdir**

Edit `scripts/validate-markdown-frontmatter.mjs` line 12:
- Old:
  ```js
  return ajv.compile(JSON.parse(readFileSync(join(ROOT, "schemas", `${name}.schema.json`), "utf8")));
  ```
- New:
  ```js
  return ajv.compile(JSON.parse(readFileSync(join(ROOT, "schemas", "learning", `${name}.schema.json`), "utf8")));
  ```

- [ ] **Step 2: Swap target dirs**

Edit `scripts/validate-markdown-frontmatter.mjs` lines 23-26:
- Old:
  ```js
  const targets = [
    { dir: join(ROOT, "content/rubrics"),      schema: loadSchema("rubric") },
    { dir: join(ROOT, "content/reflections"),  schema: loadSchema("reflection") },
  ];
  ```
- New:
  ```js
  const targets = [
    { dir: join(ROOT, "learning/rubrics"),      schema: loadSchema("rubric") },
    { dir: join(ROOT, "learning/reflections"),  schema: loadSchema("reflection") },
  ];
  ```

## Task 7: Update `validate-schema-backwards-compat.mjs` paths

**Files:**
- Modify: `scripts/validate-schema-backwards-compat.mjs`

- [ ] **Step 1: Swap schema loader to learning/ subdir**

Edit `scripts/validate-schema-backwards-compat.mjs` line 13:
- Old:
  ```js
  return ajv.compile(JSON.parse(readFileSync(join(ROOT, "schemas", `${name}.schema.json`), "utf8")));
  ```
- New:
  ```js
  return ajv.compile(JSON.parse(readFileSync(join(ROOT, "schemas", "learning", `${name}.schema.json`), "utf8")));
  ```

- [ ] **Step 2: Swap content paths in targets array**

Edit `scripts/validate-schema-backwards-compat.mjs` lines 23-27:
- Old:
  ```js
  const targets = [
    { dir: join(ROOT, "content/patterns"),     ext: ".yaml", validate: schema("pattern"),    loader: (f) => yaml.load(readFileSync(f, "utf8")) },
    { dir: join(ROOT, "content/rubrics"),      ext: ".md",   validate: schema("rubric"),     loader: (f) => matter(readFileSync(f, "utf8")).data },
    { dir: join(ROOT, "content/reflections"),  ext: ".md",   validate: schema("reflection"), loader: (f) => matter(readFileSync(f, "utf8")).data },
  ];
  ```
- New:
  ```js
  const targets = [
    { dir: join(ROOT, "learning/patterns"),     ext: ".yaml", validate: schema("pattern"),    loader: (f) => yaml.load(readFileSync(f, "utf8")) },
    { dir: join(ROOT, "learning/rubrics"),      ext: ".md",   validate: schema("rubric"),     loader: (f) => matter(readFileSync(f, "utf8")).data },
    { dir: join(ROOT, "learning/reflections"),  ext: ".md",   validate: schema("reflection"), loader: (f) => matter(readFileSync(f, "utf8")).data },
  ];
  ```

## Task 8: Update `validate-fixtures.mjs` schema path resolver

**Files:**
- Modify: `scripts/validate-fixtures.mjs`

- [ ] **Step 1: Swap schema path resolver**

Edit `scripts/validate-fixtures.mjs` line 9:
- Old: `const schemaPath = (name) => join(ROOT, "schemas", `${name}.schema.json`);`
- New: `const schemaPath = (name) => join(ROOT, "schemas", "learning", `${name}.schema.json`);`

(PRD/events schemas will be added in a later task with their own resolver path.)

## Task 9: Run full validate — verify commit 1 is green

- [ ] **Step 1: Run the aggregator**

Run: `cd /Users/zachryu/dev/work/zzem-knowledge-base && npm run validate`
Expected: all steps pass (schemas OK, content OK, skills OK, backcompat OK, install-skills test pass).

- [ ] **Step 2: If any failure, fix the specific path constant before proceeding**

Do NOT continue to commit until validate is green.

## Task 10: Commit 1

- [ ] **Step 1: Stage and commit**

```bash
cd /Users/zachryu/dev/work/zzem-knowledge-base
git add -A
git commit -m "$(cat <<'EOF'
migrate: content/ → learning/ (axis-1 grouping)

Reposition self-improving content (patterns, reflections, rubrics) under
a new learning/ top-level directory. Schemas move to schemas/learning/
with matching \$id updates. All validator path constants updated.

No behavior change; this commit leaves npm run validate green.

Part of Phase 2 two-axis restructure — see
docs/superpowers/specs/2026-04-19-kb-two-axis-architecture-design.md

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

# Commit 2 — schema: constrain reflection.domain to enum (absorbs Phase 1.2)

## Task 11: Tighten reflection schema + migrate ai-webtoon.md

**Files:**
- Modify: `schemas/learning/reflection.schema.json`
- Modify: `learning/reflections/ai-webtoon.md`

- [ ] **Step 1: Add enum to domain field**

Edit `schemas/learning/reflection.schema.json` line 10:
- Old: `    "domain":       { "type": "string" },`
- New: `    "domain":       { "enum": ["ai-webtoon", "free-tab", "ugc-platform", "infra"] },`

- [ ] **Step 2: Update legacy reflection file**

Edit `learning/reflections/ai-webtoon.md` line 3:
- Old: `domain: ai`
- New: `domain: ai-webtoon`

- [ ] **Step 3: Validate**

Run: `cd /Users/zachryu/dev/work/zzem-knowledge-base && npm run validate:content && npm run validate:backcompat`
Expected: both pass.

- [ ] **Step 4: Commit**

```bash
cd /Users/zachryu/dev/work/zzem-knowledge-base
git add schemas/learning/reflection.schema.json learning/reflections/ai-webtoon.md
git commit -m "$(cat <<'EOF'
schema: constrain reflection.domain to product/infra enum

Tightens domain from free-form string to closed enum:
[ai-webtoon, free-tab, ugc-platform, infra]. Migrates the one legacy
value (ai → ai-webtoon) in learning/reflections/ai-webtoon.md.

Absorbs Phase 1.2 scope previously specced in
docs/superpowers/specs/2026-04-19-reflection-domain-enum-design.md
(marked superseded).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

# Commit 3 — feat: add axis 2 (products) skeleton

## Task 12: Create product schemas

**Files:**
- Create: `schemas/products/prd.schema.json`
- Create: `schemas/products/events.schema.json`

- [ ] **Step 1: Write PRD schema**

```bash
mkdir -p /Users/zachryu/dev/work/zzem-knowledge-base/schemas/products
```

Create `schemas/products/prd.schema.json`:

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://zach-wrtn.github.io/knowledge-base/schemas/products/prd.schema.json",
  "title": "PRD (frontmatter only)",
  "type": "object",
  "additionalProperties": false,
  "required": ["product", "status", "last_updated", "schema_version"],
  "properties": {
    "product":        { "enum": ["ai-webtoon", "free-tab", "ugc-platform"] },
    "status":         { "enum": ["draft", "active", "archived"] },
    "owner":          { "type": "string" },
    "last_updated":   { "type": "string", "format": "date" },
    "related_sprints": {
      "type": "array",
      "items": { "type": "string", "pattern": "^[a-z0-9-]+$" }
    },
    "schema_version": { "const": 1 }
  }
}
```

- [ ] **Step 2: Write events schema**

Create `schemas/products/events.schema.json`:

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://zach-wrtn.github.io/knowledge-base/schemas/products/events.schema.json",
  "title": "Event design",
  "type": "object",
  "additionalProperties": false,
  "required": ["product", "last_updated", "events", "schema_version"],
  "properties": {
    "product":        { "enum": ["ai-webtoon", "free-tab", "ugc-platform"] },
    "owner":          { "type": "string" },
    "last_updated":   { "type": "string", "format": "date" },
    "events": {
      "type": "array",
      "minItems": 1,
      "items": {
        "type": "object",
        "additionalProperties": false,
        "required": ["name", "trigger", "properties"],
        "properties": {
          "name":       { "type": "string", "pattern": "^[a-z][a-z0-9_]+$" },
          "trigger":    { "type": "string", "minLength": 5 },
          "properties": {
            "type": "object",
            "additionalProperties": { "type": "string" }
          },
          "notes":      { "type": "string" }
        }
      }
    },
    "schema_version": { "const": 1 }
  }
}
```

## Task 13: Create product skeleton directories with valid stub content

**Files:**
- Create: `products/ai-webtoon/prd.md`
- Create: `products/ai-webtoon/events.yaml`
- Create: `products/free-tab/prd.md`
- Create: `products/free-tab/events.yaml`
- Create: `products/ugc-platform/prd.md`
- Create: `products/ugc-platform/events.yaml`

- [ ] **Step 1: Create directories**

```bash
cd /Users/zachryu/dev/work/zzem-knowledge-base
mkdir -p products/ai-webtoon products/free-tab products/ugc-platform
```

- [ ] **Step 2: Write ai-webtoon PRD stub**

Create `products/ai-webtoon/prd.md`:

```markdown
---
product: ai-webtoon
status: draft
last_updated: "2026-04-19"
schema_version: 1
---

# PRD — ai-webtoon

_Skeleton. Seed from `zzem-orchestrator/docs/prds/` or author anew in Phase 2.1._
```

- [ ] **Step 3: Write ai-webtoon events stub**

Create `products/ai-webtoon/events.yaml`:

```yaml
product: ai-webtoon
last_updated: "2026-04-19"
schema_version: 1
events:
  - name: placeholder_event
    trigger: "Remove when real events are added"
    properties: {}
    notes: "Stub to satisfy events schema minItems: 1. Replace in Phase 2.1+."
```

- [ ] **Step 4: Write free-tab PRD stub**

Create `products/free-tab/prd.md`:

```markdown
---
product: free-tab
status: draft
last_updated: "2026-04-19"
schema_version: 1
---

# PRD — free-tab

_Skeleton. Seed from `zzem-orchestrator/docs/prds/PRD-free-tab-filter-diversification.md` in Phase 2.1._
```

- [ ] **Step 5: Write free-tab events stub**

Create `products/free-tab/events.yaml`:

```yaml
product: free-tab
last_updated: "2026-04-19"
schema_version: 1
events:
  - name: placeholder_event
    trigger: "Remove when real events are added"
    properties: {}
    notes: "Stub to satisfy events schema minItems: 1. Replace in Phase 2.1+."
```

- [ ] **Step 6: Write ugc-platform PRD stub**

Create `products/ugc-platform/prd.md`:

```markdown
---
product: ugc-platform
status: draft
last_updated: "2026-04-19"
schema_version: 1
---

# PRD — ugc-platform

_Skeleton. Author in Phase 2.1._
```

- [ ] **Step 7: Write ugc-platform events stub**

Create `products/ugc-platform/events.yaml`:

```yaml
product: ugc-platform
last_updated: "2026-04-19"
schema_version: 1
events:
  - name: placeholder_event
    trigger: "Remove when real events are added"
    properties: {}
    notes: "Stub to satisfy events schema minItems: 1. Replace in Phase 2.1+."
```

## Task 14: Create products/README.md with axis-2 write guide

**Files:**
- Create: `products/README.md`

- [ ] **Step 1: Write guide**

Create `products/README.md`:

```markdown
# products/ (Axis 2: Product Specs)

Canonical per-product specs consumed by sprints. One folder per product; each
holds a single current-truth `prd.md` and `events.yaml`.

## Structure

```
products/
  ai-webtoon/    prd.md  events.yaml
  free-tab/      prd.md  events.yaml
  ugc-platform/  prd.md  events.yaml
```

Product directory names MUST match the `product` enum in
`schemas/products/prd.schema.json` and `schemas/products/events.schema.json`.

## Authoring workflow

No write skill exists for axis-2 content (intentional — concurrent writes
haven't been observed). Edit the file with the Write tool, validate locally,
commit directly.

```bash
npm run validate:products   # or the full `npm run validate`
git add products/<product>/<file>
git commit -m "products(<product>): <short description>"
git push
```

## Field rules

### prd.md frontmatter

| field | required | notes |
|---|---|---|
| `product` | yes | must match the containing directory name |
| `status` | yes | `draft` \| `active` \| `archived` |
| `owner` | no | free-form |
| `last_updated` | yes | ISO date (`YYYY-MM-DD`) — update on every edit |
| `related_sprints` | no | array of sprint ids (e.g. `["free-tab-diversification"]`) |
| `schema_version` | yes | `1` for now |

Body is free-form markdown.

### events.yaml

| field | required | notes |
|---|---|---|
| `product` | yes | must match the containing directory name |
| `last_updated` | yes | ISO date |
| `events[].name` | yes | snake_case, starts with lowercase letter |
| `events[].trigger` | yes | ≥5 chars describing when the event fires |
| `events[].properties` | yes | object; values are type/description strings |
| `events[].notes` | no | free-form |
| `schema_version` | yes | `1` for now |

Minimum one event in `events[]`.

## Adding a new product

1. Open a PR that extends the `product` enum in **both** product schemas
2. Create the matching `products/<new-product>/` directory with stub files
3. CODEOWNERS review required (schema PR gate)
```

## Task 15: Run validate (expect products not yet validated — that's OK at this step)

- [ ] **Step 1: Confirm the existing validators still pass**

Run: `cd /Users/zachryu/dev/work/zzem-knowledge-base && npm run validate`
Expected: passes. The new `products/` and `schemas/products/` files aren't validated by any existing script, so their presence shouldn't affect anything.

- [ ] **Step 2: Commit**

```bash
cd /Users/zachryu/dev/work/zzem-knowledge-base
git add schemas/products/ products/
git commit -m "$(cat <<'EOF'
feat: add axis 2 (products) skeleton

Introduces the products/ top-level directory and schemas/products/ with
three product directories (ai-webtoon, free-tab, ugc-platform), each
seeded with minimal valid prd.md + events.yaml stubs. Adds
products/README.md with the axis-2 authoring guide.

Validators for these files land in the next commit.

Part of Phase 2 two-axis restructure — see
docs/superpowers/specs/2026-04-19-kb-two-axis-architecture-design.md

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

# Commit 4 — feat: add product validators + package.json reorg

## Task 16: Add PRD + events fixtures (TDD — these drive the new validators)

**Files:**
- Create: `tests/fixtures/valid-prd.md`
- Create: `tests/fixtures/invalid-prd-bad-product.md`
- Create: `tests/fixtures/invalid-prd-missing-status.md`
- Create: `tests/fixtures/valid-events.yaml`
- Create: `tests/fixtures/invalid-events-bad-name.yaml`
- Create: `tests/fixtures/invalid-events-missing-trigger.yaml`
- Create: `tests/fixtures/invalid-events-empty.yaml`

- [ ] **Step 1: Write valid PRD fixture**

Create `tests/fixtures/valid-prd.md`:

```markdown
---
product: ai-webtoon
status: active
owner: zach
last_updated: "2026-04-19"
related_sprints:
  - ai-webtoon
schema_version: 1
---

# PRD — ai-webtoon

Narrative body.
```

- [ ] **Step 2: Write invalid PRD — bad product (not in enum)**

Create `tests/fixtures/invalid-prd-bad-product.md`:

```markdown
---
product: bogus-product
status: active
last_updated: "2026-04-19"
schema_version: 1
---

Body.
```

- [ ] **Step 3: Write invalid PRD — missing required status**

Create `tests/fixtures/invalid-prd-missing-status.md`:

```markdown
---
product: free-tab
last_updated: "2026-04-19"
schema_version: 1
---

Body.
```

- [ ] **Step 4: Write valid events fixture**

Create `tests/fixtures/valid-events.yaml`:

```yaml
product: ai-webtoon
owner: zach
last_updated: "2026-04-19"
schema_version: 1
events:
  - name: onboarding_started
    trigger: "User lands on /onboarding"
    properties:
      source: "string — referrer host or 'direct'"
    notes: "First event fired on signup flow"
  - name: onboarding_completed
    trigger: "User reaches /onboarding/done"
    properties:
      duration_ms: "integer — total time in onboarding"
```

- [ ] **Step 5: Write invalid events — bad event name (PascalCase instead of snake_case)**

Create `tests/fixtures/invalid-events-bad-name.yaml`:

```yaml
product: ai-webtoon
last_updated: "2026-04-19"
schema_version: 1
events:
  - name: OnboardingStarted
    trigger: "User lands on /onboarding"
    properties: {}
```

- [ ] **Step 6: Write invalid events — missing trigger**

Create `tests/fixtures/invalid-events-missing-trigger.yaml`:

```yaml
product: ai-webtoon
last_updated: "2026-04-19"
schema_version: 1
events:
  - name: onboarding_started
    properties: {}
```

- [ ] **Step 7: Write invalid events — empty events array**

Create `tests/fixtures/invalid-events-empty.yaml`:

```yaml
product: ai-webtoon
last_updated: "2026-04-19"
schema_version: 1
events: []
```

## Task 17: Extend `validate-fixtures.mjs` to exercise product fixtures

**Files:**
- Modify: `scripts/validate-fixtures.mjs`

- [ ] **Step 1: Add product schema path resolver**

Edit `scripts/validate-fixtures.mjs` around line 9 — replace the single-line `schemaPath` with a lookup-aware version.

- Old:
  ```js
  const schemaPath = (name) => join(ROOT, "schemas", "learning", `${name}.schema.json`);
  ```
- New:
  ```js
  const SCHEMA_DIRS = {
    pattern: "learning", reflection: "learning", rubric: "learning",
    prd: "products",    events: "products",
  };
  const schemaPath = (name) => {
    const dir = SCHEMA_DIRS[name];
    if (!dir) throw new Error(`unknown schema: ${name}`);
    return join(ROOT, "schemas", dir, `${name}.schema.json`);
  };
  ```

- [ ] **Step 2: Add new cases to the `cases` array**

Edit `scripts/validate-fixtures.mjs` — extend the `cases` const (currently lines 30-37) to include product fixtures:

Old last entry:
```js
  { schema: "reflection",  fixture: "valid-reflection.md",                    expect: "valid", loader: loadFrontmatter },
];
```

New (replace the closing `];`):
```js
  { schema: "reflection",  fixture: "valid-reflection.md",                    expect: "valid", loader: loadFrontmatter },
  { schema: "prd",         fixture: "valid-prd.md",                           expect: "valid",   loader: loadFrontmatter },
  { schema: "prd",         fixture: "invalid-prd-bad-product.md",             expect: "invalid", loader: loadFrontmatter },
  { schema: "prd",         fixture: "invalid-prd-missing-status.md",          expect: "invalid", loader: loadFrontmatter },
  { schema: "events",      fixture: "valid-events.yaml",                      expect: "valid",   loader: loadYaml },
  { schema: "events",      fixture: "invalid-events-bad-name.yaml",           expect: "invalid", loader: loadYaml },
  { schema: "events",      fixture: "invalid-events-missing-trigger.yaml",    expect: "invalid", loader: loadYaml },
  { schema: "events",      fixture: "invalid-events-empty.yaml",              expect: "invalid", loader: loadYaml },
];
```

- [ ] **Step 3: Run fixtures test — expect 13 cases pass**

Run: `cd /Users/zachryu/dev/work/zzem-knowledge-base && npm run validate:schemas`
Expected: `All 13 cases passed`

If any invalid- fixture unexpectedly passes, recheck the schema against the fixture.

## Task 18: Write `validate-product-schemas.mjs`

**Files:**
- Create: `scripts/validate-product-schemas.mjs`

- [ ] **Step 1: Write the validator**

Create `scripts/validate-product-schemas.mjs`:

```js
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join, basename } from "node:path";
import Ajv from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import yaml from "js-yaml";
import matter from "gray-matter";

const ROOT = new URL("..", import.meta.url).pathname;
const productsDir = join(ROOT, "products");

const ajv = new Ajv({ strict: false, allErrors: true });
addFormats(ajv);

function loadSchema(name) {
  return ajv.compile(
    JSON.parse(readFileSync(join(ROOT, "schemas", "products", `${name}.schema.json`), "utf8"))
  );
}

const validatePrd = loadSchema("prd");
const validateEvents = loadSchema("events");

function listProductDirs() {
  if (!existsSync(productsDir)) return [];
  return readdirSync(productsDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => join(productsDir, e.name));
}

let failed = 0;

for (const dir of listProductDirs()) {
  const product = basename(dir);

  // prd.md
  const prdPath = join(dir, "prd.md");
  if (!existsSync(prdPath)) {
    console.error(`FAIL  ${dir}: missing prd.md`);
    failed++;
  } else {
    const fm = matter(readFileSync(prdPath, "utf8")).data;
    if (Object.keys(fm).length === 0) {
      console.error(`FAIL  ${prdPath}: no frontmatter`);
      failed++;
    } else if (!validatePrd(fm)) {
      console.error(`FAIL  ${prdPath}: ${JSON.stringify(validatePrd.errors)}`);
      failed++;
    } else if (fm.product !== product) {
      console.error(`FAIL  ${prdPath}: product field "${fm.product}" does not match directory "${product}"`);
      failed++;
    }
  }

  // events.yaml
  const eventsPath = join(dir, "events.yaml");
  if (!existsSync(eventsPath)) {
    console.error(`FAIL  ${dir}: missing events.yaml`);
    failed++;
  } else {
    const doc = yaml.load(readFileSync(eventsPath, "utf8"));
    if (!validateEvents(doc)) {
      console.error(`FAIL  ${eventsPath}: ${JSON.stringify(validateEvents.errors)}`);
      failed++;
    } else if (doc.product !== product) {
      console.error(`FAIL  ${eventsPath}: product field "${doc.product}" does not match directory "${product}"`);
      failed++;
    }
  }
}

if (failed > 0) {
  console.error(`${failed} product file(s) failed schema validation`);
  process.exit(1);
}
console.log("product schemas OK");
```

- [ ] **Step 2: Run against skeleton directories**

Run: `cd /Users/zachryu/dev/work/zzem-knowledge-base && node scripts/validate-product-schemas.mjs`
Expected: `product schemas OK`

## Task 19: Write `validate-product-dir-enum.mjs`

**Files:**
- Create: `scripts/validate-product-dir-enum.mjs`

- [ ] **Step 1: Write the validator**

Create `scripts/validate-product-dir-enum.mjs`:

```js
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const productsDir = join(ROOT, "products");

function loadProductEnum() {
  const schema = JSON.parse(
    readFileSync(join(ROOT, "schemas", "products", "prd.schema.json"), "utf8")
  );
  return schema.properties.product.enum;
}

const allowedDirs = new Set(loadProductEnum());

if (!existsSync(productsDir)) {
  console.log("(no products/ directory, skipping)");
  process.exit(0);
}

let failed = 0;

for (const entry of readdirSync(productsDir, { withFileTypes: true })) {
  if (entry.isDirectory()) {
    if (!allowedDirs.has(entry.name)) {
      console.error(
        `FAIL  products/${entry.name}: directory name not in product enum ` +
        `[${[...allowedDirs].join(", ")}]`
      );
      failed++;
    }
  }
  // files at products/ top level (e.g. README.md) are allowed, no check
}

if (failed > 0) {
  console.error(`${failed} invalid product directory name(s)`);
  process.exit(1);
}
console.log("product dir enum OK");
```

- [ ] **Step 2: Run**

Run: `cd /Users/zachryu/dev/work/zzem-knowledge-base && node scripts/validate-product-dir-enum.mjs`
Expected: `product dir enum OK`

- [ ] **Step 3: Negative check — create a bogus dir, verify failure, clean up**

```bash
cd /Users/zachryu/dev/work/zzem-knowledge-base
mkdir products/bogus
node scripts/validate-product-dir-enum.mjs
# expected: FAIL  products/bogus: directory name not in product enum [...]
rmdir products/bogus
node scripts/validate-product-dir-enum.mjs
# expected: product dir enum OK
```

## Task 20: Reorganize `package.json` scripts

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Rewrite the scripts block**

Edit `package.json` — replace the entire `scripts` object (lines 7-15 currently):

- Old:
  ```json
  "scripts": {
    "validate:schemas": "node scripts/validate-fixtures.mjs",
    "validate:content": "node scripts/validate-filename-id-match.mjs && node scripts/validate-unique-ids.mjs && node scripts/validate-pattern-schemas.mjs && node scripts/validate-markdown-frontmatter.mjs",
    "validate:skills": "node scripts/validate-skill-frontmatter.mjs",
    "validate:backcompat": "node scripts/validate-schema-backwards-compat.mjs",
    "test:install-skills": "bash tests/install-skills.test.sh",
    "validate": "npm run validate:schemas && npm run validate:content && npm run validate:skills && npm run validate:backcompat && npm run test:install-skills",
    "migrate": "node scripts/migrate-from-orchestrator.mjs"
  },
  ```
- New:
  ```json
  "scripts": {
    "validate:schemas": "node scripts/validate-fixtures.mjs",
    "validate:learning": "node scripts/validate-filename-id-match.mjs && node scripts/validate-unique-ids.mjs && node scripts/validate-pattern-schemas.mjs && node scripts/validate-markdown-frontmatter.mjs",
    "validate:products": "node scripts/validate-product-schemas.mjs && node scripts/validate-product-dir-enum.mjs",
    "validate:skills": "node scripts/validate-skill-frontmatter.mjs",
    "validate:backcompat": "node scripts/validate-schema-backwards-compat.mjs",
    "test:install-skills": "bash tests/install-skills.test.sh",
    "validate": "npm run validate:schemas && npm run validate:learning && npm run validate:products && npm run validate:skills && npm run validate:backcompat && npm run test:install-skills",
    "migrate": "node scripts/migrate-from-orchestrator.mjs"
  },
  ```

## Task 21: Update CI workflow step names

**Files:**
- Modify: `.github/workflows/validate.yml`

- [ ] **Step 1: Update the validate.yml step names**

Edit `.github/workflows/validate.yml` — replace the steps after `npm ci`:

- Old (lines 17-26):
  ```yaml
        - run: npm ci
        - run: npm run validate:schemas
        - run: npm run validate:content
        # test:install-skills runs here (not last) so CI fails fast on symlink
        # regressions before skill/backcompat checks. The npm `validate` aggregator
        # puts it last so local `npm run validate` surfaces content/skill failures
        # first without being masked by a HOME-sandbox test failure.
        - run: npm run test:install-skills
        - run: npm run validate:skills
        - run: npm run validate:backcompat
  ```
- New:
  ```yaml
        - run: npm ci
        - run: npm run validate:schemas
        - run: npm run validate:learning
        - run: npm run validate:products
        # test:install-skills runs here (not last) so CI fails fast on symlink
        # regressions before skill/backcompat checks. The npm `validate` aggregator
        # puts it last so local `npm run validate` surfaces content/skill failures
        # first without being masked by a HOME-sandbox test failure.
        - run: npm run test:install-skills
        - run: npm run validate:skills
        - run: npm run validate:backcompat
  ```

## Task 22: Verify aggregator runs clean, then commit 4

- [ ] **Step 1: Full validate**

Run: `cd /Users/zachryu/dev/work/zzem-knowledge-base && npm run validate`
Expected: every step passes.

- [ ] **Step 2: Commit**

```bash
cd /Users/zachryu/dev/work/zzem-knowledge-base
git add scripts/validate-product-schemas.mjs scripts/validate-product-dir-enum.mjs \
        scripts/validate-fixtures.mjs \
        tests/fixtures/valid-prd.md tests/fixtures/invalid-prd-*.md \
        tests/fixtures/valid-events.yaml tests/fixtures/invalid-events-*.yaml \
        package.json .github/workflows/validate.yml
git commit -m "$(cat <<'EOF'
feat: add product validators + package.json script reorg

Adds scripts/validate-product-schemas.mjs (validates products/*/prd.md
frontmatter and products/*/events.yaml plus directory/field consistency)
and scripts/validate-product-dir-enum.mjs (enforces top-level directory
names against the product enum).

Renames validate:content → validate:learning and adds validate:products
to the npm aggregator. Updates CI workflow to match. Extends
validate-fixtures.mjs with 7 new PRD/events test cases (3 valid-path,
4 invalid-path).

Part of Phase 2 two-axis restructure — see
docs/superpowers/specs/2026-04-19-kb-two-axis-architecture-design.md

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

# Commit 5 — feat(skills): extend read for axis 2 + update learning/ paths

## Task 23: Update `skills/read/SKILL.md`

**Files:**
- Modify: `skills/read/SKILL.md`

- [ ] **Step 1: Rewrite the Inputs and Steps sections**

Replace the entire file `skills/read/SKILL.md` with:

```markdown
---
name: zzem-kb:read
description: Query the KB by content type and filters. Returns file paths (caller reads content via Read tool). Use at Phase 2 Spec to load prior patterns/reflections, Phase 4 Evaluator to load the latest rubric, and anywhere you need a product's current PRD or event design.
---

# zzem-kb:read

## Inputs
- `type` — one of `pattern`, `rubric`, `reflection`, `prd`, `events` (required).
- Filters (optional, AND semantics):
  - For `pattern`: `category` (enum), `severity` (enum), `min_frequency` (integer).
  - For `rubric`: `status` (default `active`).
  - For `reflection`: `domain` (enum: `ai-webtoon | free-tab | ugc-platform | infra`), `limit` (integer, default 3, most-recent first by `completed_at`).
  - For `prd`: `product` (enum: `ai-webtoon | free-tab | ugc-platform`).
  - For `events`: `product` (enum: `ai-webtoon | free-tab | ugc-platform`).

## Preconditions
- `zzem-kb:sync` was invoked in this sprint phase. If not, invoke it first.

## Steps
1. **Resolve directory/glob**
   - `pattern` → `$ZZEM_KB_PATH/learning/patterns/*.yaml`
   - `rubric`  → `$ZZEM_KB_PATH/learning/rubrics/*.md`
   - `reflection` → `$ZZEM_KB_PATH/learning/reflections/*.md`
   - `prd` → `$ZZEM_KB_PATH/products/*/prd.md` (cross-product glob; filter by `product` if set)
   - `events` → `$ZZEM_KB_PATH/products/*/events.yaml` (cross-product glob; filter by `product` if set)

2. **List candidates**
   Glob as above.

3. **Filter client-side**
   Read each candidate, parse YAML (`.yaml`) or frontmatter (`.md`), apply filter predicate.
   - `pattern`: keep if `category`, `severity`, `frequency >= min_frequency` match.
   - `rubric`: keep if frontmatter `status` matches; sort descending by `version`; return top 1.
   - `reflection`: keep if `domain` matches; sort by `completed_at` desc; slice `limit`.
   - `prd`: keep if `product` matches (or return all when no filter).
   - `events`: keep if `product` matches (or return all when no filter).

4. **Return paths**
   Output a list of absolute file paths. The caller uses Read on each.

## Failure handling
- No matches → return empty list. Do not treat as error.
- Parse error on one file → log the specific file and skip it; continue.

## Verification (smoke)
- `type=pattern, category=correctness` → expect ≥3 files
- `type=prd, product=free-tab` → expect exactly 1 file (`products/free-tab/prd.md`)
- `type=events, product=ai-webtoon` → expect exactly 1 file
```

## Task 24: Update `skills/write-pattern/SKILL.md` paths

**Files:**
- Modify: `skills/write-pattern/SKILL.md`

- [ ] **Step 1: Swap glob in step 2**

Edit `skills/write-pattern/SKILL.md` line 32:
- Old: `   Glob: `content/patterns/{category}-*.yaml``
- New: `   Glob: `learning/patterns/{category}-*.yaml``

- [ ] **Step 2: Swap schema reference in step 3**

Edit `skills/write-pattern/SKILL.md` line 36:
- Old: `   Read: `schemas/pattern.schema.json``
- New: `   Read: `schemas/learning/pattern.schema.json``

- [ ] **Step 3: Swap write path in step 4**

Edit `skills/write-pattern/SKILL.md` line 39:
- Old: `   Write: `content/patterns/{id}.yaml``
- New: `   Write: `learning/patterns/{id}.yaml``

- [ ] **Step 4: Swap validate command name**

Edit `skills/write-pattern/SKILL.md` line 54:
- Old: `   npm run validate:content || { echo "validation failed; fix and re-run from step 4"; exit 1; }`
- New: `   npm run validate:learning || { echo "validation failed; fix and re-run from step 4"; exit 1; }`

- [ ] **Step 5: Swap git add path in step 6**

Edit `skills/write-pattern/SKILL.md` line 61:
- Old: `   git add content/patterns/{id}.yaml`
- New: `   git add learning/patterns/{id}.yaml`

- [ ] **Step 6: Swap verification path**

Edit `skills/write-pattern/SKILL.md` line 78:
- Old: `- File appears at `content/patterns/{id}.yaml`.`
- New: `- File appears at `learning/patterns/{id}.yaml`.`

## Task 25: Update `skills/update-pattern/SKILL.md` paths

**Files:**
- Modify: `skills/update-pattern/SKILL.md`

- [ ] **Step 1: Swap read path**

Edit `skills/update-pattern/SKILL.md` line 22:
- Old: `   Read: `content/patterns/{id}.yaml``
- New: `   Read: `learning/patterns/{id}.yaml``

- [ ] **Step 2: Swap validate command name**

Edit `skills/update-pattern/SKILL.md` line 32:
- Old: `   Bash: `cd "$ZZEM_KB_PATH" && npm run validate:content``
- New: `   Bash: `cd "$ZZEM_KB_PATH" && npm run validate:learning``

- [ ] **Step 3: Swap git add path**

Edit `skills/update-pattern/SKILL.md` line 38:
- Old: `   git add content/patterns/{id}.yaml`
- New: `   git add learning/patterns/{id}.yaml`

- [ ] **Step 4: Swap verification path**

Edit `skills/update-pattern/SKILL.md` line 53:
- Old: `Pick an existing pattern (say `correctness-001`), invoke with a test sprint id. Diff on `content/patterns/correctness-001.yaml` must show only `frequency` incremented and `last_seen` updated.`
- New: `Pick an existing pattern (say `correctness-001`), invoke with a test sprint id. Diff on `learning/patterns/correctness-001.yaml` must show only `frequency` incremented and `last_seen` updated.`

## Task 26: Update `skills/write-reflection/SKILL.md` paths + domain enum doc

**Files:**
- Modify: `skills/write-reflection/SKILL.md`

- [ ] **Step 1: Update domain field description**

Edit `skills/write-reflection/SKILL.md` line 10:
- Old: `- `domain` — required (e.g. `ai-webtoon`, `ugc-platform`).`
- New: `- `domain` — required. Must be one of: `ai-webtoon`, `free-tab`, `ugc-platform`, `infra`. See `schemas/learning/reflection.schema.json` for the source of truth.`

- [ ] **Step 2: Swap write path**

Edit `skills/write-reflection/SKILL.md` line 26:
- Old: `   Write: `content/reflections/{sprint_id}.md``
- New: `   Write: `learning/reflections/{sprint_id}.md``

- [ ] **Step 3: Swap validate command name**

Edit `skills/write-reflection/SKILL.md` line 44:
- Old: `   Bash: `cd "$ZZEM_KB_PATH" && npm run validate:content``
- New: `   Bash: `cd "$ZZEM_KB_PATH" && npm run validate:learning``

- [ ] **Step 4: Swap git add path**

Edit `skills/write-reflection/SKILL.md` line 50:
- Old: `   git add content/reflections/{sprint_id}.md`
- New: `   git add learning/reflections/{sprint_id}.md`

## Task 27: Run validate + commit 5

- [ ] **Step 1: Full validate** (includes validate:skills which parses skill frontmatter)

Run: `cd /Users/zachryu/dev/work/zzem-knowledge-base && npm run validate`
Expected: all steps pass.

- [ ] **Step 2: Commit**

```bash
cd /Users/zachryu/dev/work/zzem-knowledge-base
git add skills/
git commit -m "$(cat <<'EOF'
feat(skills): extend read for axis 2 + update learning/ paths

skills/read/SKILL.md: adds prd and events types with product filter,
updates path table to learning/* and products/*/*.

skills/write-pattern, update-pattern, write-reflection: content/* →
learning/*; validate:content → validate:learning. write-reflection
additionally documents the domain enum values (Phase 1.2 carryover).

Part of Phase 2 two-axis restructure — see
docs/superpowers/specs/2026-04-19-kb-two-axis-architecture-design.md

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

# Commit 6 — docs: README update

## Task 28: Update README.md

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Update the Skills section to mention axis 2**

Edit `README.md` lines 17-27 — replace the Skills section:

- Old:
  ```markdown
  ## Skills (agent interface)

  | Skill | Purpose |
  |-------|---------|
  | `zzem-kb:sync` | Pull latest KB state |
  | `zzem-kb:read` | Query by type/category/severity/domain |
  | `zzem-kb:write-pattern` | Create a new defect pattern |
  | `zzem-kb:update-pattern` | Bump frequency / last_seen of an existing pattern |
  | `zzem-kb:write-reflection` | Record a sprint retrospective |

  Each skill's `SKILL.md` is the authoritative protocol; agents invoke them via the Skill tool.
  ```
- New:
  ```markdown
  ## Skills (agent interface)

  | Skill | Purpose |
  |-------|---------|
  | `zzem-kb:sync` | Pull latest KB state |
  | `zzem-kb:read` | Query any content type (pattern/rubric/reflection/prd/events) |
  | `zzem-kb:write-pattern` | Create a new defect pattern (axis 1) |
  | `zzem-kb:update-pattern` | Bump frequency / last_seen of an existing pattern (axis 1) |
  | `zzem-kb:write-reflection` | Record a sprint retrospective (axis 1) |

  Axis-2 content (PRD, events) is authored with the Write tool directly — no
  dedicated skill. See `products/README.md` for the workflow.

  Each skill's `SKILL.md` is the authoritative protocol; agents invoke them via the Skill tool.
  ```

- [ ] **Step 2: Rewrite the Content types table to reflect both axes**

Edit `README.md` lines 29-35 — replace the Content types section:

- Old:
  ```markdown
  ## Content types

  | Type | Directory | Schema | Filename |
  |------|-----------|--------|----------|
  | pattern | `content/patterns/` | `schemas/pattern.schema.json` | `{category}-{NNN}.yaml` |
  | rubric | `content/rubrics/` | `schemas/rubric.schema.json` | `v{N}.md` |
  | reflection | `content/reflections/` | `schemas/reflection.schema.json` | `{sprint-id}.md` |
  ```
- New:
  ```markdown
  ## Content types

  Two axes: `learning/` (self-improving meta-knowledge) and `products/` (per-product specs).

  ### Axis 1 — `learning/`

  | Type | Directory | Schema | Filename |
  |------|-----------|--------|----------|
  | pattern | `learning/patterns/` | `schemas/learning/pattern.schema.json` | `{category}-{NNN}.yaml` |
  | rubric | `learning/rubrics/` | `schemas/learning/rubric.schema.json` | `v{N}.md` |
  | reflection | `learning/reflections/` | `schemas/learning/reflection.schema.json` | `{sprint-id}.md` |

  ### Axis 2 — `products/`

  | Type | Directory | Schema | Filename |
  |------|-----------|--------|----------|
  | prd | `products/{product}/` | `schemas/products/prd.schema.json` | `prd.md` |
  | events | `products/{product}/` | `schemas/products/events.schema.json` | `events.yaml` |

  `{product}` ∈ `{ai-webtoon, free-tab, ugc-platform}`. See `products/README.md`
  for authoring.
  ```

## Task 29: Run final validate + commit 6

- [ ] **Step 1: Full validate (should remain green)**

Run: `cd /Users/zachryu/dev/work/zzem-knowledge-base && npm run validate`
Expected: all green.

- [ ] **Step 2: Commit**

```bash
cd /Users/zachryu/dev/work/zzem-knowledge-base
git add README.md
git commit -m "$(cat <<'EOF'
docs: update README for two-axis architecture

Splits Content types table into Axis 1 (learning/) and Axis 2
(products/). Adds products/README.md reference for axis-2 authoring
(no dedicated skill).

Final commit in Phase 2 restructure — see
docs/superpowers/specs/2026-04-19-kb-two-axis-architecture-design.md

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

## Task 30: Open the PR

- [ ] **Step 1: Push branch (if not on main locally)**

```bash
cd /Users/zachryu/dev/work/zzem-knowledge-base
git log --oneline -8
# confirm the 6 commits are stacked in order
git push origin HEAD
```

- [ ] **Step 2: Open PR via gh**

```bash
gh pr create --title "Phase 2: KB two-axis architecture (learning/ + products/)" --body "$(cat <<'EOF'
## Summary

- Restructures the repo into two clearly-separated axes: `learning/` (self-improving meta-knowledge) and `products/` (per-product specs).
- Tightens `reflection.domain` to a closed enum, migrates the one legacy value, and absorbs the Phase 1.2 spec.
- Adds PRD + events schemas and skeleton content for the three current products.
- Adds two product validators and reorganizes the npm aggregator (`validate:content` → `validate:learning`; new `validate:products`).

Spec: `docs/superpowers/specs/2026-04-19-kb-two-axis-architecture-design.md`

## Commits

1. `migrate: content/ → learning/` — paths + schema moves + validator path constants
2. `schema: constrain reflection.domain to enum` — absorbs Phase 1.2
3. `feat: add axis 2 (products) skeleton` — 3 product dirs + schemas/products/ + products/README.md
4. `feat: add product validators + package.json script reorg` — 2 new validators + fixtures + CI step rename
5. `feat(skills): extend read for axis 2 + update learning/ paths` — read gains prd/events types
6. `docs: update README for two-axis architecture`

## Test plan

- [x] `npm run validate` green at every commit
- [x] Negative check: bogus directory under `products/` fails the dir-enum validator
- [x] Negative check: PRD with missing `status` frontmatter fails PRD schema validator
- [x] Negative check: events with PascalCase `name` fails events schema validator

## Follow-up (Phase 2.1, separate PR)

- Update orchestrator `scripts/kb-bootstrap.sh` + `.claude/skills/sprint/knowledge-base.md` path references from `content/` to `learning/`. Must land within minutes of this PR merging to avoid broken bootstrap.
- Seed `products/free-tab/prd.md` from `zzem-orchestrator/docs/prds/PRD-free-tab-filter-diversification.md`.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-Review (completed inline)

### Spec coverage

| Spec section | Task(s) |
|---|---|
| §1 Directory structure | Tasks 1, 2, 13 |
| §2 PRD schema | Task 12 step 1 |
| §2 Events schema | Task 12 step 2 |
| §2 filename ↔ product consistency | Task 18 (inside `validate-product-schemas.mjs`) |
| §3 `domain` vs `product` split | Tasks 11, 12 (enum in both schemas) |
| §3 domain migration (ai → ai-webtoon) | Task 11 step 2 |
| §3 Phase 1.2 superseded marker | Already applied in previous commit (`abfc030`); Task 11 commit message references it |
| §4 sync unchanged | (no task needed) |
| §4 read extended | Task 23 |
| §4 write-pattern/update-pattern/write-reflection path updates | Tasks 24, 25, 26 |
| §4 no axis-2 write skill | (intentionally absent) |
| §4 products/README.md | Task 14 |
| §5 validator path updates | Tasks 3–8 |
| §5 validate-product-schemas.mjs | Task 18 |
| §5 validate-product-dir-enum.mjs | Task 19 |
| §5 package.json reorg | Task 20 |
| §5 CI step rename | Task 21 |
| §5 fixtures | Tasks 16, 17 |
| §6 6-commit plan | Commits 1–6 in tasks; commit 1 = Tasks 1–10, commit 2 = Task 11, commit 3 = Tasks 12–15, commit 4 = Tasks 16–22, commit 5 = Tasks 23–27, commit 6 = Tasks 28–29 |
| §7 out-of-scope items | (intentionally absent from this plan) |

No gaps.

### Placeholder scan

Every step contains concrete code, paths, and expected output. No "TBD" / "handle edge cases" / "similar to Task N" anywhere.

### Type consistency

- `domain` enum appears in 3 places: `schemas/learning/reflection.schema.json` (Task 11), `skills/write-reflection/SKILL.md` (Task 26), `skills/read/SKILL.md` (Task 23). All use `ai-webtoon, free-tab, ugc-platform, infra`.
- `product` enum appears in 4 places: `schemas/products/prd.schema.json` (Task 12), `schemas/products/events.schema.json` (Task 12), `products/README.md` (Task 14), `skills/read/SKILL.md` (Task 23). All use `ai-webtoon, free-tab, ugc-platform` (no `infra`).
- `validate:learning` and `validate:products` are named consistently across `package.json` (Task 20), `.github/workflows/validate.yml` (Task 21), and skill files (Tasks 24, 25, 26).
- `schemas/learning/<name>.schema.json` path form used consistently across validators (Tasks 3–8).
- `schemas/products/<name>.schema.json` used consistently in Tasks 12, 17, 18, 19.
