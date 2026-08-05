/**
 * Streaming PTY-output sanitizer (PRD FR-15/FR-17/FR-19).
 *
 * Model: raw input is scanned by a small terminal state machine; text is
 * emitted only when a newline is reached in ground state, so escape sequences
 * split across event chunks (and even newlines inside OSC strings) can never
 * leak. Carriage returns overwrite from the line start, so progress bars
 * collapse to their final visible state.
 *
 * The exported pending state is COMPACTED, not the raw suffix: it is the
 * current line's overwrite buffer (re-encoded as `line + "\r" + prefix` when
 * the cursor is mid-line) plus the raw bytes of any escape sequence still in
 * progress. Rescanning that representation reconstructs the machine state
 * exactly, which keeps resume tokens lossless while bounding state to ~2x the
 * logical line — CR-rewrite history and consumed escapes are not retained
 * (a progress bar rewriting one line for hours stays a few dozen bytes).
 * Stray C0/C1 controls and DEL are dropped, which also bounds JSON escaping
 * inflation of results to ~2x.
 */

export type Sanitizer = {
  /** Feed raw PTY text; returns newly emitted sanitized complete lines. */
  push(chunk: string): string;
  /** End of stream: emit the pending partial line, discarding an incomplete escape. */
  flush(): string;
  /** Compacted un-emitted state to carry across call boundaries (resume tokens). */
  pendingRaw(): string;
};

type ScanOutcome = { out: string; pending: string };

const ESC = "\u001b";
const BEL = "\u0007";
const ST = "\u009c";

function scan(raw: string, flushEnd: boolean): ScanOutcome {
  type State = "ground" | "escape" | "charset" | "csi" | "osc" | "oscEsc" | "str" | "strEsc";
  let state: State = "ground";
  let out = "";
  let buf: string[] = [];
  let pos = 0;
  // Index in `raw` where the escape sequence currently in progress began;
  // only meaningful while state !== "ground".
  let seqStart = -1;

  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i]!;
    const code = raw.charCodeAt(i);
    switch (state) {
      case "ground":
        if (ch === ESC) {
          state = "escape";
          seqStart = i;
        } else if (code === 0x9b) {
          state = "csi"; // 8-bit CSI introducer
          seqStart = i;
        } else if (code === 0x9d) {
          state = "osc"; // 8-bit OSC introducer
          seqStart = i;
        } else if (code === 0x90 || code === 0x98 || code === 0x9e || code === 0x9f) {
          state = "str"; // 8-bit DCS/SOS/PM/APC introducers
          seqStart = i;
        } else if (ch === "\n") {
          out += `${buf.join("")}\n`;
          buf = [];
          pos = 0;
        } else if (ch === "\r") {
          pos = 0;
        } else if (ch === "\t" || (code >= 0x20 && code !== 0x7f && (code < 0x80 || code > 0x9f))) {
          buf[pos] = ch;
          pos += 1;
        }
        // Remaining C0 controls, DEL, and other C1 controls are dropped.
        break;
      case "escape":
        if (ch === ESC)
          seqStart = i; // restart: abort the half-read sequence
        else if (ch === "[") state = "csi";
        else if (ch === "]") state = "osc";
        else if (ch === "P" || ch === "X" || ch === "^" || ch === "_") state = "str";
        else if (code >= 0x20 && code <= 0x2f) state = "charset";
        else state = "ground"; // two-char escape: ESC 7, ESC 8, ESC =, ...
        break;
      case "charset":
        if (ch === ESC) {
          state = "escape";
          seqStart = i;
        } else if (code < 0x20 || code > 0x2f) {
          state = "ground"; // final byte consumed
        }
        break;
      case "csi":
        if (ch === ESC) {
          state = "escape"; // abort malformed CSI instead of leaking its body
          seqStart = i;
        } else if (code >= 0x40 && code <= 0x7e) {
          state = "ground"; // final byte
        }
        break; // parameter and intermediate bytes are consumed silently
      case "osc":
        if (ch === BEL || ch === ST) state = "ground";
        else if (ch === ESC) state = "oscEsc";
        break;
      case "oscEsc":
        state = ch === "\\" || ch === ST ? "ground" : "osc";
        break;
      case "str": // DCS/SOS/PM/APC strings terminate on 7-bit or 8-bit ST
        if (ch === ST) state = "ground";
        else if (ch === ESC) state = "strEsc";
        break;
      case "strEsc":
        state = ch === "\\" || ch === ST ? "ground" : "str";
        break;
    }
  }

  if (flushEnd) {
    // An escape sequence in progress never reached `buf`, so it is discarded
    // simply by emitting what the ground state accumulated.
    return { out: out + buf.join(""), pending: "" };
  }
  const line = buf.join("");
  const lineRepr = pos === buf.length ? line : `${line}\r${buf.slice(0, pos).join("")}`;
  const escapeRepr = state === "ground" ? "" : raw.slice(seqStart);
  return { out, pending: lineRepr + escapeRepr };
}

export function createSanitizer(initialPendingRaw = ""): Sanitizer {
  let pending = initialPendingRaw;
  return {
    push(chunk: string): string {
      const result = scan(pending + chunk, false);
      pending = result.pending;
      return result.out;
    },
    flush(): string {
      const result = scan(pending, true);
      pending = "";
      return result.out;
    },
    pendingRaw: () => pending,
  };
}
