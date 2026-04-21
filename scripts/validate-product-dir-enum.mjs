import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const productsDir = join(ROOT, "products");

function loadProductEnum() {
  const schema = JSON.parse(
    readFileSync(join(ROOT, "schemas", "products", "prd.schema.json"), "utf8")
  );
  return schema.properties.product.enum;
}

const allowedDirs = new Set(loadProductEnum());

if (!existsSync(productsDir)) {
  console.log("(no products/ directory, skipping)");
  process.exit(0);
}

let failed = 0;

for (const entry of readdirSync(productsDir, { withFileTypes: true })) {
  if (entry.isDirectory()) {
    if (!allowedDirs.has(entry.name)) {
      console.error(
        `FAIL  products/${entry.name}: directory name not in product enum ` +
        `[${[...allowedDirs].join(", ")}]`
      );
      failed++;
    }
  }
  // files at products/ top level (e.g. README.md) are allowed, no check
  // sub-directories (products/{product}/{slug}/) are validated by validate-product-schemas.mjs
}

if (failed > 0) {
  console.error(`${failed} invalid product directory name(s)`);
  process.exit(1);
}
console.log("product dir enum OK");
