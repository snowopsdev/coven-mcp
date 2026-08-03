import { describe, expect, test } from "vitest";
import { mkdirSync, mkdtempSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  AllowlistConfigError,
  authorizeProjectRoot,
  isPathWithin,
  parseAllowedRoots,
} from "./allowlist.js";
import { ScryError } from "./errors.js";

function tempTree(): { base: string; allowed: string; outside: string } {
  const base = mkdtempSync(join(tmpdir(), "scry-allow-"));
  const allowed = join(base, "work", "app");
  const outside = join(base, "work", "app2");
  mkdirSync(allowed, { recursive: true });
  mkdirSync(outside, { recursive: true });
  return { base, allowed, outside };
}

describe("parseAllowedRoots", () => {
  test("unset or empty means read-only mode (empty allowlist)", () => {
    expect(parseAllowedRoots(undefined)).toEqual([]);
    expect(parseAllowedRoots("")).toEqual([]);
  });

  test("parses colon-separated absolute existing directories into canonical roots", () => {
    const { allowed, outside } = tempTree();
    const roots = parseAllowedRoots(`${allowed}:${outside}`);
    expect(roots).toHaveLength(2);
    for (const root of roots) expect(root.startsWith("/")).toBe(true);
  });

  test("a relative entry fails fast, naming the entry position but not its value", () => {
    const { allowed } = tempTree();
    expect(() => parseAllowedRoots(`${allowed}:relative/path`)).toThrowError(AllowlistConfigError);
    try {
      parseAllowedRoots(`${allowed}:relative/path`);
    } catch (err) {
      expect((err as Error).message).toContain("entry #2");
      expect((err as Error).message).not.toContain("relative/path");
    }
  });

  test("a missing directory fails fast instead of being dropped", () => {
    const { base } = tempTree();
    expect(() => parseAllowedRoots(join(base, "does-not-exist"))).toThrowError(AllowlistConfigError);
  });
});

describe("isPathWithin", () => {
  test("containment is by path component, not string prefix", () => {
    expect(isPathWithin("/work/app/sub", "/work/app")).toBe(true);
    expect(isPathWithin("/work/app", "/work/app")).toBe(true);
    expect(isPathWithin("/work/app2", "/work/app")).toBe(false);
  });
});

describe("authorizeProjectRoot", () => {
  test("an empty allowlist denies with ROOT_NOT_ALLOWED naming SCRY_ALLOWED_ROOTS", () => {
    const { allowed } = tempTree();
    try {
      authorizeProjectRoot([], allowed, "coven_start_session");
      throw new Error("expected denial");
    } catch (err) {
      expect(err).toBeInstanceOf(ScryError);
      expect((err as ScryError).code).toBe("ROOT_NOT_ALLOWED");
      expect((err as ScryError).message).toContain("SCRY_ALLOWED_ROOTS");
      expect((err as ScryError).message).toContain("coven_start_session");
    }
  });

  test("returns the canonical path for a root inside the allowlist", () => {
    const { allowed } = tempTree();
    const roots = parseAllowedRoots(allowed);
    const canonical = authorizeProjectRoot(roots, allowed, "coven_start_session");
    expect(isPathWithin(canonical, roots[0]!)).toBe(true);
  });

  test("denies a sibling directory that shares the allowed root as a string prefix", () => {
    const { allowed, outside } = tempTree();
    const roots = parseAllowedRoots(allowed);
    expect(() => authorizeProjectRoot(roots, outside, "coven_start_session")).toThrowError(ScryError);
  });

  test("denies a symlink that escapes the allowed root", () => {
    const { base, allowed } = tempTree();
    const escape = join(allowed, "escape");
    symlinkSync(join(base, "work", "app2"), escape);
    const roots = parseAllowedRoots(allowed);
    expect(() => authorizeProjectRoot(roots, escape, "coven_start_session")).toThrowError(ScryError);
  });

  test("denies a missing path (fail closed) without echoing it", () => {
    const { allowed } = tempTree();
    const roots = parseAllowedRoots(allowed);
    const missing = join(allowed, "gone");
    try {
      authorizeProjectRoot(roots, missing, "coven_send_input");
      throw new Error("expected denial");
    } catch (err) {
      expect((err as ScryError).code).toBe("ROOT_NOT_ALLOWED");
      expect((err as ScryError).message).not.toContain(missing);
    }
  });
});
