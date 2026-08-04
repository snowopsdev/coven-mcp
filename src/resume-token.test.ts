import { createHmac, randomBytes } from "node:crypto";
import { describe, expect, test } from "vitest";
import { ScryError } from "./errors.js";
import { createTokenCodec, MAX_PENDING_RAW_BYTES, MAX_TOKEN_BYTES } from "./resume-token.js";

const SESSION = "sess-1234";

function expectInvalid(fn: () => unknown): ScryError {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(ScryError);
    expect((err as ScryError).code).toBe("INVALID_RESUME_TOKEN");
    return err as ScryError;
  }
  throw new Error("expected INVALID_RESUME_TOKEN");
}

describe("createTokenCodec", () => {
  test("round-trips state including a null cursor and raw pending ANSI text", () => {
    const codec = createTokenCodec();
    for (const state of [
      { sessionId: SESSION, afterSeq: null, pendingRaw: "" },
      { sessionId: SESSION, afterSeq: 0, pendingRaw: "partial \u001b[3" },
      { sessionId: SESSION, afterSeq: 4025, pendingRaw: "10%\r20%" },
    ]) {
      const token = codec.encode(state);
      expect(codec.decode(token, SESSION)).toEqual(state);
    }
  });

  test("tokens are opaque base64url.dot.base64url with no readable session content", () => {
    const codec = createTokenCodec();
    const token = codec.encode({ sessionId: SESSION, afterSeq: 7, pendingRaw: "secret output" });
    expect(token).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    expect(token).not.toContain("secret output");
  });

  test("a tampered token is rejected", () => {
    const codec = createTokenCodec();
    const token = codec.encode({ sessionId: SESSION, afterSeq: 7, pendingRaw: "x" });
    const flipped = (token[0] === "A" ? "B" : "A") + token.slice(1);
    expectInvalid(() => codec.decode(flipped, SESSION));
  });

  test("a token from another process (different secret) is rejected — restart invalidation", () => {
    const a = createTokenCodec();
    const b = createTokenCodec();
    const token = a.encode({ sessionId: SESSION, afterSeq: 1, pendingRaw: "" });
    expectInvalid(() => b.decode(token, SESSION));
  });

  test("a token bound to a different session is rejected", () => {
    const codec = createTokenCodec();
    const token = codec.encode({ sessionId: SESSION, afterSeq: 1, pendingRaw: "" });
    expectInvalid(() => codec.decode(token, "other-session"));
  });

  test("garbage tokens are rejected without throwing anything but ScryError", () => {
    const codec = createTokenCodec();
    for (const garbage of ["", "no-dot", "a.b.c", "!!.!!", "aGk.aGk"]) {
      expectInvalid(() => codec.decode(garbage, SESSION));
    }
  });

  test("an oversized token is rejected before signature verification", () => {
    const codec = createTokenCodec();
    const huge = `${"A".repeat(MAX_TOKEN_BYTES)}.AAAA`;
    const err = expectInvalid(() => codec.decode(huge, SESSION));
    expect(err.message).not.toContain("A".repeat(64));
  });

  test("an unsupported payload version is rejected even when correctly signed", () => {
    const secret = randomBytes(32);
    const codec = createTokenCodec(secret);
    const payload = JSON.stringify({ v: 2, sessionId: SESSION, afterSeq: 1, pendingRawB64: "" });
    const sig = createHmac("sha256", secret).update(payload).digest("base64url");
    const forged = `${Buffer.from(payload).toString("base64url")}.${sig}`;
    expectInvalid(() => codec.decode(forged, SESSION));
  });

  test("a signed payload with a negative or non-integer cursor is rejected", () => {
    const secret = randomBytes(32);
    const codec = createTokenCodec(secret);
    for (const afterSeq of [-1, 1.5, "7", Number.MAX_SAFE_INTEGER + 2]) {
      const payload = JSON.stringify({ v: 1, sessionId: SESSION, afterSeq, pendingRawB64: "" });
      const sig = createHmac("sha256", secret).update(payload).digest("base64url");
      const forged = `${Buffer.from(payload).toString("base64url")}.${sig}`;
      expectInvalid(() => codec.decode(forged, SESSION));
    }
  });

  test("pending state ending in a lone surrogate round-trips losslessly", () => {
    const codec = createTokenCodec();
    const state = { sessionId: SESSION, afterSeq: 3, pendingRaw: "emoji-split \uD83D" };
    const token = codec.encode(state);
    expect(codec.decode(token, SESSION)).toEqual(state);
  });

  test("pending state at the 32 KiB cap round-trips; beyond the cap encode refuses", () => {
    const codec = createTokenCodec();
    const atCap = "x".repeat(MAX_PENDING_RAW_BYTES / 2);
    const token = codec.encode({ sessionId: SESSION, afterSeq: 1, pendingRaw: atCap });
    expect(Buffer.byteLength(token, "utf8")).toBeLessThanOrEqual(MAX_TOKEN_BYTES);
    expect(codec.decode(token, SESSION).pendingRaw).toBe(atCap);

    expect(() =>
      codec.encode({ sessionId: SESSION, afterSeq: 1, pendingRaw: `${atCap}y` }),
    ).toThrowError(ScryError);
  });

  test("a signed payload whose decoded pending state exceeds the cap is rejected", () => {
    const secret = randomBytes(32);
    const codec = createTokenCodec(secret);
    const b64 = Buffer.from("x".repeat(MAX_PENDING_RAW_BYTES + 1)).toString("base64url");
    const payload = JSON.stringify({ v: 1, sessionId: SESSION, afterSeq: 1, pendingRawB64: b64 });
    const sig = createHmac("sha256", secret).update(payload).digest("base64url");
    const forged = `${Buffer.from(payload).toString("base64url")}.${sig}`;
    expectInvalid(() => codec.decode(forged, SESSION));
  });
});
