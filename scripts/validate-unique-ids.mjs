import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import yaml from "js-yaml";

const ROOT = new URL("..", import.meta.url).pathname;

function collectYaml(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith(".yaml"))
    .map((e) => join(dir, e.name));
}

function runOn(dirs) {
  const byId = new Map();
  for (const dir of dirs) {
    for (const file of collectYaml(dir)) {
      const id = yaml.load(readFileSync(file, "utf8"))?.id;
      if (!id) { console.error(`FAIL  ${file}: missing .id`); continue; }
      const existing = byId.get(id);
      if (existing) {
        console.error(`FAIL  duplicate id "${id}" in:\n    ${existing}\n    ${file}`);
        return 1;
      }
      byId.set(id, file);
    }
  }
  return 0;
}

const dirs = process.argv.length > 2
  ? process.argv.slice(2).map((p) => join(ROOT, p))
  : [join(ROOT, "learning/patterns"), join(ROOT, "archived/patterns")];

if (runOn(dirs) > 0) process.exit(1);
console.log(`unique ids OK (${dirs.length} dir(s) checked)`);
