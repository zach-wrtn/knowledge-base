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
const validateNotionPrds = loadSchema("notion-prds");
const validateActivePrd = loadSchema("active-prd");

function listProductDirs() {
  if (!existsSync(productsDir)) return [];
  return readdirSync(productsDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => join(productsDir, e.name));
}

let failed = 0;

for (const dir of listProductDirs()) {
  const product = basename(dir);

  // Overview: prd.md
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

  // Product-level: events.yaml
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

  // Nested feature PRDs: products/{product}/{slug}/prd.md
  for (const sub of readdirSync(dir, { withFileTypes: true })) {
    if (!sub.isDirectory()) continue;
    const featureDir = join(dir, sub.name);
    const featurePrdPath = join(featureDir, "prd.md");
    if (!existsSync(featurePrdPath)) {
      console.error(`FAIL  ${featureDir}: missing prd.md (every sub-dir under a product must contain prd.md)`);
      failed++;
      continue;
    }
    const fm = matter(readFileSync(featurePrdPath, "utf8")).data;
    if (Object.keys(fm).length === 0) {
      console.error(`FAIL  ${featurePrdPath}: no frontmatter`);
      failed++;
      continue;
    }
    if (!validateActivePrd(fm)) {
      console.error(`FAIL  ${featurePrdPath}: ${JSON.stringify(validateActivePrd.errors)}`);
      failed++;
      continue;
    }
    if (fm.kb_product !== product) {
      console.error(`FAIL  ${featurePrdPath}: kb_product "${fm.kb_product}" does not match parent directory "${product}"`);
      failed++;
    }
    if (fm.slug !== sub.name) {
      console.error(`FAIL  ${featurePrdPath}: slug "${fm.slug}" does not match containing directory "${sub.name}"`);
      failed++;
    }
  }
}

// notion-prds.yaml (optional top-level index)
const notionPrdsPath = join(productsDir, "notion-prds.yaml");
if (existsSync(notionPrdsPath)) {
  const doc = yaml.load(readFileSync(notionPrdsPath, "utf8"));
  if (!validateNotionPrds(doc)) {
    console.error(`FAIL  ${notionPrdsPath}: ${JSON.stringify(validateNotionPrds.errors)}`);
    failed++;
  }
}

if (failed > 0) {
  console.error(`${failed} product file(s) failed schema validation`);
  process.exit(1);
}
console.log("product schemas OK");
