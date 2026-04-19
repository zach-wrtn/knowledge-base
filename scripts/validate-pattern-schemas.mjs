import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import Ajv from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import yaml from "js-yaml";

const ROOT = new URL("..", import.meta.url).pathname;

const ajv = new Ajv({ strict: false, allErrors: true });
addFormats(ajv);
const validate = ajv.compile(
  JSON.parse(readFileSync(join(ROOT, "schemas", "learning", "pattern.schema.json"), "utf8"))
);

function collectYaml(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith(".yaml"))
    .map((e) => join(dir, e.name));
}

function runOn(dir) {
  let failed = 0;
  for (const file of collectYaml(dir)) {
    const doc = yaml.load(readFileSync(file, "utf8"));
    if (!validate(doc)) {
      for (const err of validate.errors) {
        const path = err.instancePath || "(root)";
        console.error(`FAIL  ${file}: ${path} ${err.message}`);
      }
      failed++;
    }
  }
  return failed;
}

const target = process.argv[2]
  ? join(ROOT, process.argv[2])
  : join(ROOT, "learning", "patterns");

const failed = runOn(target);
if (failed > 0) {
  console.error(`${failed} pattern file(s) failed schema validation`);
  process.exit(1);
}
console.log(`pattern schemas OK (${target})`);
