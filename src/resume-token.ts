import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { ScryError } from "./errors.js";

/**
 * Signed resume tokens (PRD FR-17): base64url(payload JSON) + "." +
 * base64url(HMAC-SHA-256(payload)). Payload is
 * { v: 1, sessionId, afterSeq: number | null, pendingRawB64 }.
 * Tokens are integrity-protected but NOT encrypted — they carry raw session
 * output state, so they are never logged, and error messages never include
 * token contents (only a validation reason category).
 */

export const MAX_PENDING_RAW_BYTES = 32 * 1024;
export const MAX_TOKEN_BYTES = 64 * 1024;
export const TOKEN_VERSION = 1;

export type TokenState = {
  sessionId: string;
  afterSeq: number | null;
  pendingRaw: string;
};

export type TokenCodec = {
  encode(state: TokenState): string;
  decode(token: string, expectedSessionId: string): TokenState;
};

function invalid(reason: string): ScryError {
  return new ScryError("INVALID_RESUME_TOKEN", `Resume token rejected: ${reason}`, false, {
    reason,
  });
}

const B64URL_RE = /^[A-Za-z0-9_-]+$/;

export function createTokenCodec(secret: Buffer = randomBytes(32)): TokenCodec {
  function sign(payload: string): Buffer {
    return createHmac("sha256", secret).update(payload, "utf8").digest();
  }

  return {
    encode(state: TokenState): string {
      // utf16le, not utf8: pending state can legally end in a lone surrogate
      // (a chunk split inside an emoji), which utf8 would corrupt to U+FFFD.
      const pendingBytes = Buffer.from(state.pendingRaw, "utf16le");
      if (pendingBytes.length > MAX_PENDING_RAW_BYTES) {
        // The reader must stop before state grows past the bound (FR-18);
        // reaching this is a scry bug, not a user error.
        throw new ScryError("INTERNAL_ERROR", "Resume state exceeded its bound", false);
      }
      // Key order is fixed so the signed bytes are canonical.
      const payload = JSON.stringify({
        v: TOKEN_VERSION,
        sessionId: state.sessionId,
        afterSeq: state.afterSeq,
        pendingRawB64: pendingBytes.toString("base64url"),
      });
      return `${Buffer.from(payload, "utf8").toString("base64url")}.${sign(payload).toString("base64url")}`;
    },

    decode(token: string, expectedSessionId: string): TokenState {
      if (typeof token !== "string" || token.length === 0) throw invalid("empty");
      if (Buffer.byteLength(token, "utf8") > MAX_TOKEN_BYTES) throw invalid("oversized");
      const parts = token.split(".");
      if (parts.length !== 2 || !B64URL_RE.test(parts[0]!) || !B64URL_RE.test(parts[1]!)) {
        throw invalid("malformed");
      }
      const payload = Buffer.from(parts[0]!, "base64url").toString("utf8");
      const expected = sign(payload);
      const provided = Buffer.from(parts[1]!, "base64url");
      if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
        throw invalid("bad_signature");
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(payload);
      } catch {
        throw invalid("malformed");
      }
      if (typeof parsed !== "object" || parsed === null) throw invalid("malformed");
      const record = parsed as Record<string, unknown>;
      if (record["v"] !== TOKEN_VERSION) throw invalid("unsupported_version");
      if (record["sessionId"] !== expectedSessionId) throw invalid("wrong_session");
      const afterSeq = record["afterSeq"];
      if (
        afterSeq !== null &&
        (typeof afterSeq !== "number" || !Number.isSafeInteger(afterSeq) || afterSeq < 0)
      ) {
        throw invalid("bad_cursor");
      }
      const pendingRawB64 = record["pendingRawB64"];
      if (typeof pendingRawB64 !== "string" || !(pendingRawB64 === "" || B64URL_RE.test(pendingRawB64))) {
        throw invalid("malformed");
      }
      const pendingBytes = Buffer.from(pendingRawB64, "base64url");
      if (pendingBytes.length > MAX_PENDING_RAW_BYTES) throw invalid("state_too_large");
      if (pendingBytes.length % 2 !== 0) throw invalid("malformed");
      return {
        sessionId: expectedSessionId,
        afterSeq: afterSeq as number | null,
        pendingRaw: pendingBytes.toString("utf16le"),
      };
    },
  };
}
