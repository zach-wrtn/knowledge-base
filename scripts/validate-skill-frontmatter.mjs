import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import matter from "gray-matter";

const ROOT = new URL("..", import.meta.url).pathname;
const skillsDir = join(ROOT, "skills");

if (!existsSync(skillsDir)) {
  console.log("(no skills/ directory yet, skipping)");
  process.exit(0);
}

let failed = 0;
for (const entry of readdirSync(skillsDir, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const file = join(skillsDir, entry.name, "SKILL.md");
  if (!existsSync(file)) {
    console.error(`FAIL  ${file}: missing`);
    failed++;
    continue;
  }
  const fm = matter(readFileSync(file, "utf8")).data;
  if (!fm.name || !fm.description) {
    console.error(`FAIL  ${file}: missing name or description`);
    failed++;
    continue;
  }
  if (!String(fm.name).startsWith("zzem-kb:")) {
    console.error(`FAIL  ${file}: name must start with "zzem-kb:" (got "${fm.name}")`);
    failed++;
  }
}

if (failed > 0) process.exit(1);
console.log("skill frontmatter OK");
