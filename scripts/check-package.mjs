#!/usr/bin/env node
// Package smoke check (PRD NFR-7): the tarball contains only intended
// runtime/docs/license files, the entry point is executable, and bin is wired.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const packOutput = JSON.parse(
  execFileSync("npm", ["pack", "--dry-run", "--json"], { encoding: "utf8" }),
);
const files = packOutput[0].files.map((f) => f.path);

const allowed = [
  /^dist\//,
  /^docs\/architecture\.(?:html|json)$/,
  /^docs\/architecture-preview\.png$/,
  /^README\.md$/,
  /^LICENSE$/,
  /^package\.json$/,
];
const unexpected = files.filter((p) => !allowed.some((re) => re.test(p)));
if (unexpected.length > 0) {
  console.error("PACKAGE FAIL: unexpected files in tarball:", unexpected.join(", "));
  process.exit(1);
}

const required = [
  "dist/index.js",
  "docs/architecture.html",
  "docs/architecture.json",
  "docs/architecture-preview.png",
  "README.md",
  "LICENSE",
  "package.json",
];
const missing = required.filter((r) => !files.includes(r));
if (missing.length > 0) {
  console.error("PACKAGE FAIL: missing required files:", missing.join(", "));
  process.exit(1);
}

const leaked = files.filter((p) => /\.test\.|\.map$/.test(p) === false && /test\//.test(p));
if (leaked.length > 0) {
  console.error("PACKAGE FAIL: test files leaked into tarball:", leaked.join(", "));
  process.exit(1);
}

const entry = readFileSync("dist/index.js", "utf8");
if (!entry.startsWith("#!/usr/bin/env node")) {
  console.error("PACKAGE FAIL: dist/index.js is missing its shebang");
  process.exit(1);
}

const pkg = JSON.parse(readFileSync("package.json", "utf8"));
if (pkg.bin?.["coven-mcp"] !== "dist/index.js") {
  console.error("PACKAGE FAIL: package.json bin does not point at dist/index.js");
  process.exit(1);
}
if (!/^>=22/.test(pkg.engines?.node ?? "")) {
  console.error("PACKAGE FAIL: engines.node must require Node >=22");
  process.exit(1);
}

console.log(`PACKAGE OK: ${files.length} files, entry point executable, bin and engines wired`);
