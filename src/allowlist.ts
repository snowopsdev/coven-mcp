import { realpathSync, statSync } from "node:fs";
import { isAbsolute } from "node:path";
import { ScryError } from "./errors.js";

/**
 * Startup configuration failure. Deliberately names the entry position but
 * never the value: env values must not be logged (FR-29), and this message
 * goes to stderr.
 */
export class AllowlistConfigError extends Error {
  constructor(position: number, reason: string) {
    super(`SCRY_ALLOWED_ROOTS entry #${position} ${reason}; fix the allowlist and restart`);
    this.name = "AllowlistConfigError";
  }
}

function canonicalDir(path: string): string | undefined {
  try {
    const canonical = realpathSync(path);
    return statSync(canonical).isDirectory() ? canonical : undefined;
  } catch {
    return undefined;
  }
}

/** Colon-separated absolute existing directories. Unset/empty ⇒ read-only mode. */
export function parseAllowedRoots(value: string | undefined): string[] {
  if (value === undefined || value === "") return [];
  return value.split(":").map((entry, index) => {
    const position = index + 1;
    if (entry === "") throw new AllowlistConfigError(position, "is empty");
    if (!isAbsolute(entry)) throw new AllowlistConfigError(position, "is not an absolute path");
    const canonical = canonicalDir(entry);
    if (canonical === undefined) {
      throw new AllowlistConfigError(position, "is not an existing directory");
    }
    return canonical;
  });
}

/** Path-component containment of canonical absolute paths, never string-prefix. */
export function isPathWithin(child: string, parent: string): boolean {
  if (child === parent) return true;
  const prefix = parent.endsWith("/") ? parent : `${parent}/`;
  return child.startsWith(prefix);
}

function deny(operation: string): ScryError {
  return new ScryError(
    "ROOT_NOT_ALLOWED",
    `${operation} denied: the project root is not in SCRY_ALLOWED_ROOTS ` +
      "(unset or empty means read-only mode)",
    false,
    { operation },
  );
}

/**
 * Canonicalizes a requested project root and requires it to sit inside an
 * allowed root. Missing paths, non-directories, canonicalization failures,
 * and symlink escapes all deny (fail closed). Returns the canonical path.
 */
export function authorizeProjectRoot(
  allowedRoots: readonly string[],
  projectRoot: string,
  operation: string,
): string {
  if (allowedRoots.length === 0) throw deny(operation);
  const canonical = canonicalDir(projectRoot);
  if (canonical === undefined) throw deny(operation);
  if (!allowedRoots.some((root) => isPathWithin(canonical, root))) throw deny(operation);
  return canonical;
}
