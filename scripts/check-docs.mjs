#!/usr/bin/env node
// Documentation check: the README sections required by the official
// submission guide exist, are non-empty, and appear in the specified order,
// and HACKATHON.md carries the pinned SHA and freeze tag.
// Source: https://hackathon.opencoven.ai/docs/submission-guide.html
// (verified Aug 4, 2026). Extra sections are permitted; the guide gives a
// minimum set, so this checks presence and relative order, not exclusivity.
// TODO markers are reported but only fail the check in release mode
// (COVEN_MCP_RELEASE_CHECK=true), which the freeze preflight sets.
import { readFileSync } from "node:fs";

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
  `DOCS OK: ${REQUIRED_SECTIONS.length} guide-required sections present, non-empty, and in order`,
);
