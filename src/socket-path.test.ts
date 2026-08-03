import { describe, expect, test } from "vitest";
import { resolveSocketPath } from "./socket-path.js";

describe("resolveSocketPath", () => {
  test("uses COVEN_SOCKET as a literal path when set", () => {
    const path = resolveSocketPath(
      { COVEN_SOCKET: "/run/custom.sock", COVEN_HOME: "/coven-home" },
      "/home/u",
    );
    expect(path).toBe("/run/custom.sock");
  });

  test("falls back to $COVEN_HOME/coven.sock when COVEN_SOCKET is unset", () => {
    const path = resolveSocketPath({ COVEN_HOME: "/coven-home" }, "/home/u");
    expect(path).toBe("/coven-home/coven.sock");
  });

  test("defaults to ~/.coven/coven.sock when neither variable is set", () => {
    const path = resolveSocketPath({}, "/home/u");
    expect(path).toBe("/home/u/.coven/coven.sock");
  });

  test("ignores empty-string variables instead of producing broken paths", () => {
    const path = resolveSocketPath({ COVEN_SOCKET: "", COVEN_HOME: "" }, "/home/u");
    expect(path).toBe("/home/u/.coven/coven.sock");
  });
});
