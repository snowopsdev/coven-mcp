import { describe, expect, test } from "vitest";
import { createSanitizer } from "./sanitizer.js";

const ESC = "\u001b";

describe("createSanitizer", () => {
  test("emits complete lines and keeps the partial line pending", () => {
    const s = createSanitizer();
    expect(s.push("hello\nwor")).toBe("hello\n");
    expect(s.pendingRaw()).toBe("wor");
    expect(s.push("ld\n")).toBe("world\n");
    expect(s.pendingRaw()).toBe("");
  });

  test("strips SGR color sequences", () => {
    const s = createSanitizer();
    expect(s.push(`${ESC}[31mred${ESC}[0m\n`)).toBe("red\n");
  });

  test("strips private-mode CSI sequences seen live (ESC[?2004h, ESC[>4m, ESC[<u)", () => {
    const s = createSanitizer();
    expect(s.push(`${ESC}[?2004h${ESC}[>4m${ESC}[<uok\n`)).toBe("ok\n");
  });

  test("strips two-char escapes and charset designation (ESC7, ESC8, ESC(B)", () => {
    const s = createSanitizer();
    expect(s.push(`${ESC}7${ESC}[r${ESC}8${ESC}(Bdone\n`)).toBe("done\n");
  });

  test("strips OSC terminated by BEL and by ST", () => {
    const s = createSanitizer();
    expect(s.push(`${ESC}]0;window title\u0007after\n`)).toBe("after\n");
    expect(s.push(`${ESC}]8;;http://x${ESC}\\link\n`)).toBe("link\n");
  });

  test("a newline inside an OSC string does not split the line", () => {
    const s = createSanitizer();
    expect(s.push(`${ESC}]0;ti\ntle\u0007text\n`)).toBe("text\n");
  });

  test("an escape sequence split across pushes cannot leak", () => {
    const s = createSanitizer();
    expect(s.push(`${ESC}[3`)).toBe("");
    expect(s.push("1mred\n")).toBe("red\n");
  });

  test("carriage return overwrites from the line start (true overwrite, not truncate)", () => {
    const s = createSanitizer();
    expect(s.push("abcdef\rXY\n")).toBe("XYcdef\n");
  });

  test("progress-bar rewrites collapse to the final state", () => {
    const s = createSanitizer();
    expect(s.push("10%\r20%\r100%\n")).toBe("100%\n");
  });

  test("CRLF is a plain line ending", () => {
    const s = createSanitizer();
    expect(s.push("foo\r\nbar\r\n")).toBe("foo\nbar\n");
  });

  test("drops stray C0 controls and DEL but keeps tabs", () => {
    const s = createSanitizer();
    expect(s.push("a\u000fb\u0007c\u007fd\te\n")).toBe("abcd\te\n");
  });

  test("resuming from exported pendingRaw reproduces the unsplit output exactly", () => {
    const full = `${ESC}[32mpartial line ${ESC}[0mwith\rP tail\nnext\n`;
    const reference = createSanitizer();
    const referenceOut = reference.push(full);

    for (let split = 1; split < full.length; split++) {
      const a = createSanitizer();
      const outA = a.push(full.slice(0, split));
      const b = createSanitizer(a.pendingRaw());
      const outB = b.push(full.slice(split));
      expect(outA + outB).toBe(referenceOut);
      expect(b.pendingRaw()).toBe(reference.pendingRaw());
    }
  });

  test("flush emits the pending partial line without a trailing newline", () => {
    const s = createSanitizer();
    s.push("no newline here");
    expect(s.flush()).toBe("no newline here");
    expect(s.pendingRaw()).toBe("");
  });

  test("flush discards an incomplete trailing escape sequence", () => {
    const s = createSanitizer();
    s.push(`foo${ESC}[3`);
    expect(s.flush()).toBe("foo");
  });

  test("flush applies the final carriage-return rewrite", () => {
    const s = createSanitizer();
    s.push("abc\rX");
    expect(s.flush()).toBe("Xbc");
  });

  test("flush on an empty sanitizer returns nothing", () => {
    const s = createSanitizer();
    expect(s.flush()).toBe("");
  });

  test("carriage-return rewrites compact pending state instead of accumulating raw history", () => {
    const s = createSanitizer();
    for (let i = 0; i < 2000; i++) s.push(" 45% [====>   ]\r");
    expect(Buffer.byteLength(s.pendingRaw(), "utf8")).toBeLessThan(256);
    expect(s.flush()).toBe(" 45% [====>   ]");
  });

  test("fully consumed escape sequences do not linger in pending state", () => {
    const s = createSanitizer();
    for (let i = 0; i < 1000; i++) s.push(`${ESC}[31mX${ESC}[0m`);
    expect(s.pendingRaw().length).toBeLessThan(2100);
    expect(s.flush()).toBe("X".repeat(1000));
  });

  test("compacted pending state resumes CR-overwrite lines identically", () => {
    const a = createSanitizer();
    a.push("abcdef\rXY");
    const b = createSanitizer(a.pendingRaw());
    const ref = createSanitizer();
    expect(b.push("Z!\n")).toBe(ref.push("abcdef\rXYZ!\n"));
  });

  test("drops C1 controls and honors 8-bit CSI/OSC introducers", () => {
    const s = createSanitizer();
    expect(s.push("a\u009b31mb\u0085c\n")).toBe("abc\n");
    expect(s.push("x\u009d0;title\u0007y\n")).toBe("xy\n");
  });

  test.each([
    ["OSC", "\u009d"],
    ["DCS", "\u0090"],
    ["SOS", "\u0098"],
    ["PM", "\u009e"],
    ["APC", "\u009f"],
  ])("C1 ST terminates an 8-bit %s string", (_name, introducer) => {
    const s = createSanitizer();
    expect(s.push(`before${introducer}hidden\u009cafter\n`)).toBe("beforeafter\n");
    expect(s.pendingRaw()).toBe("");
  });

  test.each([
    ["OSC", `${ESC}]`],
    ["DCS", `${ESC}P`],
    ["SOS", `${ESC}X`],
    ["PM", `${ESC}^`],
    ["APC", `${ESC}_`],
  ])("C1 ST terminates a 7-bit %s string", (_name, introducer) => {
    const s = createSanitizer();
    expect(s.push(`before${introducer}hidden\u009cafter\n`)).toBe("beforeafter\n");
    expect(s.pendingRaw()).toBe("");
  });

  test.each([
    ["OSC", "\u009d"],
    ["DCS", "\u0090"],
    ["SOS", "\u0098"],
    ["PM", "\u009e"],
    ["APC", "\u009f"],
  ])("C1 ST terminates an 8-bit %s string after ESC", (_name, introducer) => {
    const s = createSanitizer();
    expect(s.push(`before${introducer}hidden${ESC}\u009cafter\n`)).toBe("beforeafter\n");
    expect(s.pendingRaw()).toBe("");
  });

  test("C1 ST remains lossless across every pending-state split", () => {
    const full = `A\u009dtitle\u009cB\u0090payload${ESC}\u009cC\n`;
    const reference = createSanitizer();
    const referenceOut = reference.push(full);

    expect(referenceOut).toBe("ABC\n");
    for (let split = 1; split < full.length; split++) {
      const a = createSanitizer();
      const outA = a.push(full.slice(0, split));
      const b = createSanitizer(a.pendingRaw());
      const outB = b.push(full.slice(split));
      expect(outA + outB).toBe(referenceOut);
      expect(b.pendingRaw()).toBe(reference.pendingRaw());
    }
  });

  test("an ESC inside an unfinished CSI restarts the sequence instead of leaking its body", () => {
    const s = createSanitizer();
    expect(s.push(`${ESC}[31${ESC}[32mGreen\n`)).toBe("Green\n");
  });

  test("DCS strings terminate only on ST, so an embedded BEL does not leak the payload", () => {
    const s = createSanitizer();
    expect(s.push(`${ESC}P1;2|payload\u0007rest${ESC}\\after\n`)).toBe("after\n");
  });

  test("handles empty pushes and multi-line chunks", () => {
    const s = createSanitizer();
    expect(s.push("")).toBe("");
    expect(s.push("a\nb\nc")).toBe("a\nb\n");
    expect(s.pendingRaw()).toBe("c");
  });
});
