#!/usr/bin/env node
// Documentation check: the README sections required by the official
// submission guide exist, are non-empty, and appear in the specified order,
// and HACKATHON.md carries the pinned SHA and freeze tag.
// Source: https://hackathon.opencoven.ai/docs/submission-guide.html
// (verified Aug 4, 2026). Extra sections are permitted; the guide gives a
// minimum set, so this checks presence and relative order, not exclusivity.
// TODO markers are reported but only fail the check in release mode
// (COVEN_MCP_RELEASE_CHECK=true), which the freeze preflight sets.
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { relative } from "node:path";

/** Exact `##` headings required by the submission guide, in its order. */
const REQUIRED_SECTIONS = [
  "What it does",
  "Problem",
  "Why OpenCoven",
  "How OpenCoven was used",
  "Architecture",
  "Prerequisites",
  "Installation",
  "Configuration",
  "Run",
  "Test or verify",
  "Demo",
  "Known limitations",
  "Security and privacy",
  "License",
];

const readme = readFileSync("README.md", "utf8");
const sections = new Map();
const order = [];
const parts = readme.split(/^## /m).slice(1);
for (const part of parts) {
  const newline = part.indexOf("\n");
  const name = part.slice(0, newline).trim();
  sections.set(name, part.slice(newline + 1).trim());
  order.push(name);
}

let failed = false;

function docsFail(message) {
  console.error(`DOCS FAIL: ${message}`);
  failed = true;
}

function lineCount(path) {
  const content = readFileSync(path, "utf8");
  return content.split("\n").length - (content.endsWith("\n") ? 1 : 0);
}

// The guide's structure starts from `# Project Name`, so an H1 title is
// required too — a README that opens straight into `## What it does` is
// missing the project's own name.
if (!/^# \S/m.test(readme)) {
  console.error("DOCS FAIL: README is missing its `# Project Name` title");
  failed = true;
}

for (const name of REQUIRED_SECTIONS) {
  const body = sections.get(name);
  if (body === undefined) {
    console.error(`DOCS FAIL: README is missing section "## ${name}"`);
    failed = true;
  } else if (body.length === 0) {
    console.error(`DOCS FAIL: README section "## ${name}" is empty`);
    failed = true;
  }
}

// Extra sections are fine, but the required ones must keep the guide's
// relative order so a judge reading top to bottom sees the expected flow.
const presentInOrder = order.filter((name) => REQUIRED_SECTIONS.includes(name));
const expectedOrder = REQUIRED_SECTIONS.filter((name) => sections.has(name));
for (const [i, name] of presentInOrder.entries()) {
  if (name !== expectedOrder[i]) {
    console.error(
      `DOCS FAIL: section order deviates from the submission guide — expected "${expectedOrder[i]}" where "${name}" appears`,
    );
    failed = true;
    break;
  }
}

const hackathon = readFileSync("HACKATHON.md", "utf8");
if (!hackathon.includes("1fe9a744356ea3af6b47a3d497a483513b36eb15")) {
  console.error("DOCS FAIL: HACKATHON.md is missing the pinned upstream SHA");
  failed = true;
}
if (!hackathon.includes("august-hackathon-2026-final")) {
  console.error("DOCS FAIL: HACKATHON.md is missing the freeze tag name");
  failed = true;
}

// Keep verification claims and architecture metrics synchronized with the live
// repository. The suite is fast, and running it here prevents successful docs
// checks from blessing stale counts after tests or source files change.
const vitestSummary = JSON.parse(
  execFileSync(process.execPath, ["node_modules/vitest/vitest.mjs", "run", "--reporter=json"], {
    encoding: "utf8",
  }),
);
const liveTestCount = vitestSummary.numTotalTests;
const liveTestFiles = new Map(
  vitestSummary.testResults.map((result) => {
    const path = result.name.startsWith("/") ? relative(process.cwd(), result.name) : result.name;
    return [path, result.assertionResults.length];
  }),
);

function checkTestClaims(label, content) {
  const counts = [...content.matchAll(/(\d+) unit and contract tests/g)].map((match) =>
    Number(match[1]),
  );
  if (counts.length === 0) docsFail(`${label} is missing its unit-and-contract-test count`);
  for (const count of counts) {
    if (count !== liveTestCount) {
      docsFail(`${label} claims ${count} tests; Vitest reports ${liveTestCount}`);
    }
  }
}

const architectureJson = JSON.parse(readFileSync("docs/architecture.json", "utf8"));
const architectureHtml = readFileSync("docs/architecture.html", "utf8");
checkTestClaims("README.md", readme);
checkTestClaims("HACKATHON.md", hackathon);
checkTestClaims("docs/architecture.html", architectureHtml);

if (architectureJson.verification?.totalTests !== liveTestCount) {
  docsFail(
    `docs/architecture.json verification.totalTests is ${architectureJson.verification?.totalTests}; Vitest reports ${liveTestCount}`,
  );
}
if (architectureJson.metrics?.tests !== liveTestCount) {
  docsFail(
    `docs/architecture.json metrics.tests is ${architectureJson.metrics?.tests}; Vitest reports ${liveTestCount}`,
  );
}

const documentedTestFiles = new Map(
  architectureJson.verification?.testFiles?.map((entry) => [entry.file, entry.tests]) ?? [],
);
for (const [path, count] of liveTestFiles) {
  if (documentedTestFiles.get(path) !== count) {
    docsFail(
      `docs/architecture.json records ${documentedTestFiles.get(path) ?? "no count"} tests for ${path}; Vitest reports ${count}`,
    );
  }
}
for (const path of documentedTestFiles.keys()) {
  if (!liveTestFiles.has(path)) docsFail(`docs/architecture.json lists missing test file ${path}`);
}

const liveSourceFiles = new Map(
  readdirSync("src")
    .filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts"))
    .map((name) => [`src/${name}`, lineCount(`src/${name}`)]),
);
const liveSourceLoc = [...liveSourceFiles.values()].reduce((sum, count) => sum + count, 0);
const documentedModules = new Map(
  architectureJson.modules?.map((entry) => [entry.file, entry.loc]) ?? [],
);
for (const [path, count] of liveSourceFiles) {
  if (documentedModules.get(path) !== count) {
    docsFail(
      `docs/architecture.json records ${documentedModules.get(path) ?? "no LOC"} for ${path}; source has ${count}`,
    );
  }
  const htmlRow = `<tr><td class="mono">${path.slice(4)}</td><td class="num">${count}</td>`;
  if (!architectureHtml.includes(htmlRow)) {
    docsFail(`docs/architecture.html has stale or missing LOC for ${path}`);
  }
}
for (const path of documentedModules.keys()) {
  if (!liveSourceFiles.has(path))
    docsFail(`docs/architecture.json lists missing source module ${path}`);
}
if (architectureJson.metrics?.sourceLoc !== liveSourceLoc) {
  docsFail(
    `docs/architecture.json metrics.sourceLoc is ${architectureJson.metrics?.sourceLoc}; source has ${liveSourceLoc}`,
  );
}
const formattedSourceLoc = liveSourceLoc.toLocaleString("en-US");
if (!architectureHtml.includes(`<dt>Source LOC</dt><dd>${formattedSourceLoc}</dd>`)) {
  docsFail(`docs/architecture.html does not report the live source LOC ${formattedSourceLoc}`);
}

const liveCommitCount = Number(
  execFileSync("git", ["rev-list", "--count", "HEAD"], { encoding: "utf8" }).trim(),
);
if (architectureJson.metrics?.commits !== liveCommitCount) {
  docsFail(
    `docs/architecture.json metrics.commits is ${architectureJson.metrics?.commits}; Git reports ${liveCommitCount}`,
  );
}

const todoCount = (readme.match(/TODO/g) ?? []).length + (hackathon.match(/TODO/g) ?? []).length;
if (todoCount > 0) {
  if (process.env.COVEN_MCP_RELEASE_CHECK === "true") {
    console.error(`DOCS FAIL: ${todoCount} TODO markers remain at release time`);
    failed = true;
  } else {
    console.log(`DOCS NOTE: ${todoCount} TODO markers remain (allowed until freeze)`);
  }
}

if (failed) process.exit(1);
console.log(
  `DOCS OK: ${REQUIRED_SECTIONS.length} guide-required sections in order; ${liveTestCount} tests and architecture metrics current`,
);
