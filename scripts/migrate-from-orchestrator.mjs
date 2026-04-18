import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from "node:fs";
import { join, basename } from "node:path";
import yaml from "js-yaml";
import matter from "gray-matter";

const OLD_KB = process.env.OLD_KB;
if (!OLD_KB || !existsSync(OLD_KB)) {
  console.error("Set OLD_KB to the sprint-orchestrator/knowledge-base path.");
  process.exit(1);
}

const ROOT = new URL("..", import.meta.url).pathname;
const TARGET = {
  patterns:    join(ROOT, "content/patterns"),
  rubrics:     join(ROOT, "content/rubrics"),
  reflections: join(ROOT, "content/reflections"),
};
for (const d of Object.values(TARGET)) mkdirSync(d, { recursive: true });

function copyPatterns() {
  const src = join(OLD_KB, "patterns");
  const files = readdirSync(src).filter((f) => f.endsWith(".yaml") && f !== "README.yaml");
  for (const f of files) {
    if (f === "README.md" || f === "README.yaml") continue;
    const doc = yaml.load(readFileSync(join(src, f), "utf8"));
    if (!doc) { console.warn(`skip ${f}: empty`); continue; }
    if (doc.schema_version === undefined) doc.schema_version = 1;
    writeFileSync(join(TARGET.patterns, f), yaml.dump(doc, { lineWidth: 0 }));
    console.log(`pattern  ${f}`);
  }
}

function copyRubrics() {
  const src = join(OLD_KB, "rubrics");
  const files = readdirSync(src).filter((f) => /^v\d+\.md$/.test(f));
  // Sort by version ascending; latest = active
  files.sort((a, b) => parseInt(a.slice(1), 10) - parseInt(b.slice(1), 10));
  const latest = files.at(-1);

  for (const f of files) {
    const version = parseInt(f.slice(1), 10);
    const raw = readFileSync(join(src, f), "utf8");
    const existing = matter(raw);
    const body = existing.content || raw;
    const isActive = f === latest;
    const fm = {
      version,
      status: isActive ? "active" : "superseded",
      superseded_by: isActive ? null : version + 1,
      changelog: existing.data?.changelog || "",
      schema_version: 1,
    };
    const out = matter.stringify(body, fm);
    writeFileSync(join(TARGET.rubrics, f), out);
    console.log(`rubric   ${f} (${fm.status})`);
  }
}

function copyReflections() {
  const src = join(OLD_KB, "reflections");
  const files = readdirSync(src).filter((f) => f.endsWith(".md") && f !== "README.md");
  for (const f of files) {
    const sprintId = basename(f, ".md");
    const raw = readFileSync(join(src, f), "utf8");
    const existing = matter(raw);
    const body = existing.content || raw;
    const fm = {
      sprint_id: existing.data?.sprint_id || sprintId,
      domain: existing.data?.domain || sprintId.split("-").slice(0, -1).join("-") || sprintId,
      completed_at: existing.data?.completed_at || "2026-04-01T00:00:00+09:00",
      outcome: existing.data?.outcome || "pass",
      related_patterns: existing.data?.related_patterns || [],
      schema_version: 1,
    };
    if (!fm.related_patterns.length) delete fm.related_patterns;
    const out = matter.stringify(body, fm);
    writeFileSync(join(TARGET.reflections, f), out);
    console.log(`reflection ${f}`);
  }
}

copyPatterns();
copyRubrics();
copyReflections();

console.log("\nMigration complete. Review generated files, then run: npm run validate");
