import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import Ajv from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import matter from "gray-matter";

const ROOT = new URL("..", import.meta.url).pathname;
const ajv = new Ajv({ strict: false, allErrors: true });
addFormats(ajv);

function loadSchema(name) {
  return ajv.compile(JSON.parse(readFileSync(join(ROOT, "schemas", `${name}.schema.json`), "utf8")));
}

function collectMd(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith(".md") && !e.name.startsWith("."))
    .filter((e) => e.name !== "README.md")
    .map((e) => join(dir, e.name));
}

const targets = [
  { dir: join(ROOT, "content/rubrics"),      schema: loadSchema("rubric") },
  { dir: join(ROOT, "content/reflections"),  schema: loadSchema("reflection") },
];

let failed = 0;
for (const t of targets) {
  for (const file of collectMd(t.dir)) {
    const raw = readFileSync(file, "utf8");
    const parsed = matter(raw);
    if (Object.keys(parsed.data).length === 0) {
      console.error(`FAIL  ${file}: no frontmatter`);
      failed++;
      continue;
    }
    if (!t.schema(parsed.data)) {
      console.error(`FAIL  ${file}: ${JSON.stringify(t.schema.errors)}`);
      failed++;
    }
  }
}

if (failed > 0) process.exit(1);
console.log("markdown frontmatter OK");
