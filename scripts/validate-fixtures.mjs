import { readFileSync } from "node:fs";
import { join } from "node:path";
import Ajv from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import yaml from "js-yaml";
import matter from "gray-matter";

const ROOT = new URL("..", import.meta.url).pathname;
const SCHEMA_DIRS = {
  pattern: "learning", reflection: "learning", rubric: "learning",
  prd: "products",    events: "products",    "notion-prds": "products",
  "active-prd": "products",
};
const schemaPath = (name) => {
  const dir = SCHEMA_DIRS[name];
  if (!dir) throw new Error(`unknown schema: ${name}`);
  return join(ROOT, "schemas", dir, `${name}.schema.json`);
};
const fixturePath = (name) => join(ROOT, "tests", "fixtures", name);

const ajv = new Ajv({ strict: false, allErrors: true });
addFormats(ajv);

function loadSchema(name) {
  return JSON.parse(readFileSync(schemaPath(name), "utf8"));
}

function loadYaml(fname) {
  return yaml.load(readFileSync(fixturePath(fname), "utf8"));
}

function loadFrontmatter(fname) {
  const raw = readFileSync(fixturePath(fname), "utf8");
  const parsed = matter(raw);
  if (Object.keys(parsed.data).length === 0) return null;
  return parsed.data;
}

const cases = [
  { schema: "pattern",     fixture: "valid-pattern.yaml",                     expect: "valid", loader: loadYaml },
  { schema: "pattern",     fixture: "invalid-pattern-missing-field.yaml",     expect: "invalid", loader: loadYaml },
  { schema: "pattern",     fixture: "invalid-pattern-bad-id.yaml",            expect: "invalid", loader: loadYaml },
  { schema: "rubric",      fixture: "valid-rubric.md",                        expect: "valid", loader: loadFrontmatter },
  { schema: "rubric",      fixture: "invalid-rubric-missing-frontmatter.md",  expect: "invalid", loader: loadFrontmatter },
  { schema: "reflection",  fixture: "valid-reflection.md",                    expect: "valid", loader: loadFrontmatter },
  { schema: "prd",         fixture: "valid-prd.md",                           expect: "valid",   loader: loadFrontmatter },
  { schema: "prd",         fixture: "invalid-prd-bad-product.md",             expect: "invalid", loader: loadFrontmatter },
  { schema: "prd",         fixture: "invalid-prd-missing-status.md",          expect: "invalid", loader: loadFrontmatter },
  { schema: "events",      fixture: "valid-events.yaml",                      expect: "valid",   loader: loadYaml },
  { schema: "events",      fixture: "invalid-events-bad-name.yaml",           expect: "invalid", loader: loadYaml },
  { schema: "events",      fixture: "invalid-events-missing-trigger.yaml",    expect: "invalid", loader: loadYaml },
  { schema: "events",      fixture: "invalid-events-empty.yaml",              expect: "invalid", loader: loadYaml },
  { schema: "notion-prds", fixture: "valid-notion-prds.yaml",                 expect: "valid",   loader: loadYaml },
  { schema: "notion-prds", fixture: "invalid-notion-prds-bad-db-id.yaml",     expect: "invalid", loader: loadYaml },
  { schema: "notion-prds", fixture: "invalid-notion-prds-missing-synced-at.yaml", expect: "invalid", loader: loadYaml },
  { schema: "active-prd",  fixture: "valid-active-prd.md",                    expect: "valid",   loader: loadFrontmatter },
  { schema: "active-prd",  fixture: "invalid-active-prd-wrong-status.md",     expect: "invalid", loader: loadFrontmatter },
  { schema: "active-prd",  fixture: "invalid-active-prd-bad-notion-id.md",    expect: "invalid", loader: loadFrontmatter },
  { schema: "active-prd",  fixture: "invalid-active-prd-missing-slug.md",     expect: "invalid", loader: loadFrontmatter },
];

const validators = {};
function getValidator(name) {
  if (!validators[name]) {
    const schema = loadSchema(name);
    validators[name] = ajv.compile(schema);
  }
  return validators[name];
}

let failed = 0;
for (const c of cases) {
  const validate = getValidator(c.schema);
  const data = c.loader(c.fixture);

  let ok;
  if (data === null) ok = false; // missing frontmatter
  else ok = validate(data);

  const result = ok ? "valid" : "invalid";
  const pass = result === c.expect;
  if (!pass) failed++;
  console.log(`${pass ? "PASS" : "FAIL"}  ${c.schema}  ${c.fixture}  expected=${c.expect}  got=${result}`);
  if (!pass && ok === false) console.log("      errors:", JSON.stringify(validate.errors));
}

if (failed > 0) {
  console.error(`\n${failed} case(s) failed`);
  process.exit(1);
} else {
  console.log(`\nAll ${cases.length} cases passed`);
}
