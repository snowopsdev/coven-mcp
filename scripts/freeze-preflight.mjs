#!/usr/bin/env node
// Freeze preflight (PLAN.md §8). Read-only: it never commits, tags, or pushes.
// Automates every checklist item that can be checked mechanically and prints
// the ones that still need a human. Run before creating the freeze tag:
//
//   node scripts/freeze-preflight.mjs
//
// Exits non-zero if any automated check fails.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

const results = [];
let failed = false;

function check(name, fn) {
  try {
    const detail = fn();
    results.push({ ok: true, name, detail: detail ?? "" });
  } catch (err) {
    failed = true;
    results.push({ ok: false, name, detail: err.message });
  }
}

function sh(cmd, args, opts = {}) {
  // stderr is captured, not inherited: expected failures (a tag that does not
  // exist yet, git grep finding nothing) must not print noise above the report.
  return execFileSync(cmd, args, {
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
    ...opts,
  }).trim();
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

check("working tree is clean", () => {
  const status = sh("git", ["status", "--porcelain"]);
  assert(status === "", `uncommitted changes:\n${status}`);
  return "no uncommitted changes";
});

check("every commit is DCO signed off", () => {
  const commits = sh("git", ["log", "--format=%H"]).split("\n").filter(Boolean);
  const unsigned = commits.filter((sha) => {
    const body = sh("git", ["log", "-1", "--format=%B", sha]);
    return !/^Signed-off-by: /m.test(body);
  });
  assert(unsigned.length === 0, `${unsigned.length} commit(s) missing sign-off`);
  return `${commits.length} commits, all signed off`;
});

check("lockfile is committed", () => {
  const tracked = sh("git", ["ls-files", "package-lock.json"]);
  assert(tracked === "package-lock.json", "package-lock.json is not tracked");
  return "package-lock.json tracked";
});

check("LICENSE is unmodified MIT", () => {
  const license = readFileSync("LICENSE", "utf8");
  assert(license.startsWith("MIT License"), "LICENSE does not start with 'MIT License'");
  assert(
    license.includes('THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND'),
    "LICENSE is missing the standard MIT warranty disclaimer",
  );
  assert(/Copyright \(c\) \d{4} /.test(license), "LICENSE is missing a copyright line");
  return "standard MIT text with year and holder only";
});

/** git grep exits 1 when nothing matches, which is the success case here. */
function grepTracked(args) {
  try {
    return sh("git", ["grep", ...args]);
  } catch (err) {
    if (err.status === 1) return "";
    throw err;
  }
}

check("no paths from this machine in tracked files", () => {
  // Only this machine's real home is a portability hazard. Synthetic fixture
  // paths (/home/u, /Users/x) are deliberate test data, not leaks.
  const hits = grepTracked(["-nIF", "-e", homedir(), "--", "."]);
  assert(hits === "", `machine-local paths found:\n${hits.split("\n").slice(0, 5).join("\n")}`);
  return `no occurrences of this machine's home directory`;
});

check("no secret-like patterns in tracked files", () => {
  const hits = grepTracked([
    "-nIE",
    "(api[_-]?key|secret|passwd|password|token)[[:space:]]*[:=][[:space:]]*['\"][A-Za-z0-9_/+-]{16,}",
    "--",
    ".",
  ]);
  assert(hits === "", `possible secrets:\n${hits}`);
  return "no key/token assignments found";
});

check("no .env files tracked", () => {
  let tracked = "";
  try {
    tracked = sh("git", ["ls-files", "*.env", ".env*"]);
  } catch {
    tracked = "";
  }
  assert(tracked === "", `tracked env files: ${tracked}`);
  return "none";
});

check("release-mode docs check passes (no placeholders)", () => {
  execFileSync("node", ["scripts/check-docs.mjs"], {
    env: { ...process.env, SCRY_RELEASE_CHECK: "true" },
    stdio: "pipe",
  });
  return "all sections filled, no TODO markers";
});

check("clean clone builds and verifies", () => {
  const dir = mkdtempSync(join(tmpdir(), "scry-freeze-"));
  try {
    const clone = join(dir, "clone");
    sh("git", ["clone", "--quiet", process.cwd(), clone]);
    sh("npm", ["ci", "--silent"], { cwd: clone });
    execFileSync("npm", ["run", "verify"], {
      cwd: clone,
      stdio: "pipe",
      env: { ...process.env, SCRY_RELEASE_CHECK: "true" },
    });
    return "npm ci && npm run verify green from a fresh clone";
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

const TAG = process.env.SCRY_FREEZE_TAG ?? "july-hackathon-2026-final";
check(`tag ${TAG} (if present) points at HEAD`, () => {
  let target = "";
  try {
    target = sh("git", ["rev-list", "-n", "1", TAG]);
  } catch {
    return `not created yet — create it after this preflight passes`;
  }
  const head = sh("git", ["rev-parse", "HEAD"]);
  assert(target === head, `tag points at ${target.slice(0, 8)}, HEAD is ${head.slice(0, 8)}`);
  return `points at HEAD (${head.slice(0, 8)})`;
});

for (const r of results) {
  console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name}${r.detail ? ` — ${r.detail}` : ""}`);
}

console.log("\nStill requires a human (cannot be checked mechanically):");
console.log("  - Official brief re-verified: deadline, time zone, tag name, README requirements,");
console.log("    submission issue URL (PLAN.md §8 flags these as unconfirmed)");
console.log("  - Demo link opens in a logged-out browser");
console.log("  - Every README command re-run by hand from the clean clone");

process.exit(failed ? 1 : 0);
