import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import Ajv from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import yaml from "js-yaml";
import matter from "gray-matter";

const ROOT = new URL("..", import.meta.url).pathname;
const ajv = new Ajv({ strict: false, allErrors: true });
addFormats(ajv);

function schema(name) {
  return ajv.compile(JSON.parse(readFileSync(join(ROOT, "schemas", `${name}.schema.json`), "utf8")));
}
function collect(dir, ext) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith(ext) && !e.name.startsWith("."))
    .filter((e) => e.name !== "README.md")
    .map((e) => join(dir, e.name));
}

const targets = [
  { dir: join(ROOT, "content/patterns"),     ext: ".yaml", validate: schema("pattern"),    loader: (f) => yaml.load(readFileSync(f, "utf8")) },
  { dir: join(ROOT, "content/rubrics"),      ext: ".md",   validate: schema("rubric"),     loader: (f) => matter(readFileSync(f, "utf8")).data },
  { dir: join(ROOT, "content/reflections"),  ext: ".md",   validate: schema("reflection"), loader: (f) => matter(readFileSync(f, "utf8")).data },
];

let failed = 0;
for (const t of targets) {
  for (const file of collect(t.dir, t.ext)) {
    const data = t.loader(file);
    if (!t.validate(data)) {
      console.error(`FAIL  ${file}: ${JSON.stringify(t.validate.errors)}`);
      failed++;
    }
  }
}

if (failed > 0) { console.error(`${failed} file(s) incompatible with current schemas`); process.exit(1); }
console.log("schema backwards-compat OK");
