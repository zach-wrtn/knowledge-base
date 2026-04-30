import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import Ajv from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import yaml from "js-yaml";

const ROOT = new URL("..", import.meta.url).pathname;
const ajv = new Ajv({ strict: false, allErrors: true });
addFormats(ajv);

const schema = JSON.parse(
  readFileSync(join(ROOT, "schemas", "learning", "qa-owners.schema.json"), "utf8")
);
const validate = ajv.compile(schema);

const file = join(ROOT, "learning", "qa-owners.yaml");
if (!existsSync(file)) {
  console.error(`FAIL  ${file}: missing`);
  process.exit(1);
}

const doc = yaml.load(readFileSync(file, "utf8"));
if (!validate(doc)) {
  for (const err of validate.errors) {
    const path = err.instancePath || "(root)";
    console.error(`FAIL  ${file}: ${path} ${err.message}`);
  }
  process.exit(1);
}
console.log("qa-owners OK");
