#!/usr/bin/env node
// Documentation check (PLAN §6): the 15 required README sections exist and
// are non-empty, and HACKATHON.md carries the pinned SHA and freeze tag.
// TODO markers are reported but only fail the check in release mode
// (SCRY_RELEASE_CHECK=true), which the freeze preflight sets.
import { readFileSync } from "node:fs";

const REQUIRED_SECTIONS = [
  "Overview",
  "Why `scry`",
  "Prerequisites and supported platforms",
  "Install and build",
  "MCP client configuration",
  "Environment variables",
  "Tool reference",
  "Coven API compatibility and pinned SHA",
  "Security and privacy",
  "Verification and tests",
  "Live demo workflow",
  "Limitations / non-goals",
  "Troubleshooting",
  "Hackathon disclosure and upstream use",
  "License",
];

const readme = readFileSync("README.md", "utf8");
const sections = new Map();
const parts = readme.split(/^## /m).slice(1);
for (const part of parts) {
  const newline = part.indexOf("\n");
  sections.set(part.slice(0, newline).trim(), part.slice(newline + 1).trim());
}

let failed = false;
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

const hackathon = readFileSync("HACKATHON.md", "utf8");
if (!hackathon.includes("1fe9a744356ea3af6b47a3d497a483513b36eb15")) {
  console.error("DOCS FAIL: HACKATHON.md is missing the pinned upstream SHA");
  failed = true;
}
if (!hackathon.includes("july-hackathon-2026-final")) {
  console.error("DOCS FAIL: HACKATHON.md is missing the freeze tag name");
  failed = true;
}

const todoCount = (readme.match(/TODO/g) ?? []).length + (hackathon.match(/TODO/g) ?? []).length;
if (todoCount > 0) {
  if (process.env.SCRY_RELEASE_CHECK === "true") {
    console.error(`DOCS FAIL: ${todoCount} TODO markers remain at release time`);
    failed = true;
  } else {
    console.log(`DOCS NOTE: ${todoCount} TODO markers remain (allowed until freeze)`);
  }
}

if (failed) process.exit(1);
console.log(`DOCS OK: ${REQUIRED_SECTIONS.length}/15 required sections present and non-empty`);
