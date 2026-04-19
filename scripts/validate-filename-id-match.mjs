import { readFileSync, readdirSync } from "node:fs";
import { join, basename, extname } from "node:path";
import yaml from "js-yaml";

const ROOT = new URL("..", import.meta.url).pathname;

function collect(dir) {
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith(".yaml"))
    .map((e) => join(dir, e.name));
}

function mainDir() {
  return join(ROOT, "learning", "patterns");
}

function runOn(dir) {
  const files = collect(dir);
  let failed = 0;
  for (const file of files) {
    const expected = basename(file, extname(file));
    const doc = yaml.load(readFileSync(file, "utf8"));
    if (!doc || doc.id !== expected) {
      console.error(`FAIL  ${file}: id="${doc?.id}" does not match filename "${expected}"`);
      failed++;
    }
  }
  return failed;
}

const target = process.argv[2] ? join(ROOT, process.argv[2]) : mainDir();

let failed = 0;
try { failed = runOn(target); } catch (e) {
  if (e.code === "ENOENT") {
    console.log(`(no ${target}, skipping)`);
  } else { throw e; }
}

if (failed > 0) { console.error(`${failed} file(s) failed filename-id match`); process.exit(1); }
console.log("filename-id match OK");
