import { describe, expect, test } from "vitest";
import { readOutput, MAX_TEXT_BYTES, type ReadOutputDeps } from "./read-output.js";
import { createTokenCodec } from "./resume-token.js";
import { ScryError } from "./errors.js";

const E = "\u001b";
const SESSION = "sess-1";

type RawEvent = { seq: number; kind: string; payload_json: string };

function out(seq: number, data: string): RawEvent {
  return { seq, kind: "output", payload_json: JSON.stringify({ data }) };
}
function exit(seq: number): RawEvent {
  return { seq, kind: "exit", payload_json: JSON.stringify({ exitCode: 0, status: "completed" }) };
}
function page(events: RawEvent[], hasMore: boolean): unknown {
  const last = events[events.length - 1];
  return {
    events,
    nextCursor: last === undefined ? null : { afterSeq: last.seq },
    hasMore,
  };
}

/** Serves scripted pages keyed by the afterSeq the reader sends (null for fresh). */
function scriptedDeps(
  pages: Map<number | null, unknown>,
  session: { status: string; exitCode: number | null } = { status: "running", exitCode: null },
): ReadOutputDeps & { fetches: (number | null)[] } {
  const fetches: (number | null)[] = [];
  return {
    fetches,
    codec: createTokenCodec(),
    fetchEvents: (afterSeq) => {
      fetches.push(afterSeq);
      const p = pages.get(afterSeq);
      if (p === undefined) return Promise.resolve(page([], false));
      return Promise.resolve(p);
    },
    fetchSession: () => Promise.resolve(session),
    sleep: () => Promise.resolve(),
  };
}

function params(overrides: Partial<Parameters<typeof readOutput>[1]> = {}) {
  return { sessionId: SESSION, timeoutMs: 1_000, maxBytes: 1024 * 1024, ...overrides };
}

describe("readOutput", () => {
  test("drains hasMore pages to an exit and returns complete sanitized text", async () => {
    const deps = scriptedDeps(
      new Map<number | null, unknown>([
        [null, page([out(1, `${E}[32mhello`), out(2, " world\n")], true)],
        [2, page([out(3, "done\n"), exit(4)], false)],
      ]),
    );
    const result = await readOutput(deps, params());
    expect(result).toMatchObject({
      text: "hello world\ndone\n",
      lastSeq: 4,
      resumeToken: null,
      complete: true,
      truncated: false,
      stopReason: "complete",
      diagnostics: { malformedPayloads: 0, unknownEvents: 0 },
    });
    expect(deps.fetches).toEqual([null, 2]);
  });

  test("skips malformed payloads and counts them without failing", async () => {
    const deps = scriptedDeps(
      new Map<number | null, unknown>([
        [
          null,
          page(
            [
              out(1, "ok\n"),
              { seq: 2, kind: "output", payload_json: "not json{" },
              { seq: 3, kind: "output", payload_json: JSON.stringify({ nodata: true }) },
              exit(4),
            ],
            false,
          ),
        ],
      ]),
    );
    const result = await readOutput(deps, params());
    expect(result.text).toBe("ok\n");
    expect(result.diagnostics.malformedPayloads).toBe(2);
    expect(result.complete).toBe(true);
  });

  test("known non-output kinds are silent; unknown kinds are counted and skipped", async () => {
    const deps = scriptedDeps(
      new Map<number | null, unknown>([
        [
          null,
          page(
            [
              { seq: 1, kind: "input", payload_json: "{}" },
              { seq: 2, kind: "status", payload_json: "{}" },
              { seq: 3, kind: "kill", payload_json: "{}" },
              { seq: 4, kind: "mystery", payload_json: "{}" },
              out(5, "x\n"),
              exit(6),
            ],
            false,
          ),
        ],
      ]),
    );
    const result = await readOutput(deps, params());
    expect(result.text).toBe("x\n");
    expect(result.diagnostics.unknownEvents).toBe(1);
    expect(result.lastSeq).toBe(6);
  });

  test("timeout returns a resumable token that losslessly continues split ANSI/CR state", async () => {
    const codec = createTokenCodec();
    const callA = scriptedDeps(
      new Map<number | null, unknown>([[null, page([out(1, `line1\n10%\r20%${E}[3`)], false)]]),
    );
    callA.codec = codec;
    const a = await readOutput(callA, params({ timeoutMs: 0 }));
    expect(a).toMatchObject({ complete: false, truncated: false, stopReason: "timeout" });
    expect(a.text).toBe("line1\n");
    expect(a.lastSeq).toBe(1);
    expect(a.resumeToken).not.toBeNull();

    const callB = scriptedDeps(
      new Map<number | null, unknown>([[1, page([out(2, `1mdone${E}[0m\n`), exit(3)], false)]]),
    );
    callB.codec = codec;
    const b = await readOutput(callB, params({ resumeToken: a.resumeToken! }));
    expect(b.text).toBe("20%done\n");
    expect(b.complete).toBe(true);
    expect(callB.fetches).toEqual([1]);
  });

  test("a fresh timeoutMs:0 call with no events returns a valid pre-first-event token", async () => {
    const codec = createTokenCodec();
    const empty = scriptedDeps(new Map());
    empty.codec = codec;
    const a = await readOutput(empty, params({ timeoutMs: 0 }));
    expect(a.stopReason).toBe("timeout");
    expect(a.lastSeq).toBeNull();
    expect(a.resumeToken).not.toBeNull();

    const callB = scriptedDeps(
      new Map<number | null, unknown>([[null, page([out(1, "first\n"), exit(2)], false)]]),
    );
    callB.codec = codec;
    const b = await readOutput(callB, params({ resumeToken: a.resumeToken! }));
    expect(b.text).toBe("first\n");
    expect(callB.fetches).toEqual([null]);
  });

  test("maxBytes stops before the event that would burst the budget and resumes exactly", async () => {
    const codec = createTokenCodec();
    const callA = scriptedDeps(
      new Map<number | null, unknown>([
        [null, page([out(1, "aaaa\n"), out(2, "bbbb\n"), exit(3)], false)],
      ]),
    );
    callA.codec = codec;
    const a = await readOutput(callA, params({ maxBytes: 64 * 1024 }));
    expect(a.complete).toBe(true); // both lines fit a 64 KiB budget

    const tight = scriptedDeps(
      new Map<number | null, unknown>([
        [null, page([out(1, `${"a".repeat(60_000)}\n`), out(2, `${"b".repeat(60_000)}\n`), exit(3)], false)],
      ]),
    );
    tight.codec = codec;
    const t = await readOutput(tight, params({ maxBytes: 65_536 }));
    expect(t).toMatchObject({ complete: false, truncated: true, stopReason: "maxBytes" });
    expect(t.text).toBe(`${"a".repeat(60_000)}\n`);
    expect(t.lastSeq).toBe(1);

    const rest = scriptedDeps(
      new Map<number | null, unknown>([[1, page([out(2, `${"b".repeat(60_000)}\n`), exit(3)], false)]]),
    );
    rest.codec = codec;
    const r = await readOutput(rest, params({ maxBytes: 65_536, resumeToken: t.resumeToken! }));
    expect(r.text).toBe(`${"b".repeat(60_000)}\n`);
    expect(r.complete).toBe(true);
  });

  test("an empty page claiming hasMore is a cursor contract error, not an infinite loop", async () => {
    const deps = scriptedDeps(new Map<number | null, unknown>([[null, page([], true)]]));
    await expect(readOutput(deps, params())).rejects.toMatchObject({
      code: "UPSTREAM_ERROR",
      details: { kind: "cursor_regression" },
    });
  });

  test("non-increasing event sequences are a contract error", async () => {
    const deps = scriptedDeps(
      new Map<number | null, unknown>([[null, page([out(5, "a\n"), out(5, "b\n")], false)]]),
    );
    await expect(readOutput(deps, params())).rejects.toMatchObject({
      code: "UPSTREAM_ERROR",
      details: { kind: "cursor_regression" },
    });
  });

  test("caps a single call at 100 data pages with the pageLimit tuple", async () => {
    const pages = new Map<number | null, unknown>();
    pages.set(null, page([out(1, "x")], true));
    for (let seq = 1; seq < 300; seq++) pages.set(seq, page([out(seq + 1, "x")], true));
    const deps = scriptedDeps(pages);
    const result = await readOutput(deps, params());
    expect(result).toMatchObject({ complete: false, truncated: true, stopReason: "pageLimit" });
    expect(deps.fetches.length).toBe(100);
    expect(result.lastSeq).toBe(100);
    expect(result.resumeToken).not.toBeNull();
  });

  test("caps a single call at 10,000 consumed events", async () => {
    const big: RawEvent[] = [];
    for (let seq = 1; seq <= 6000; seq++) big.push({ seq, kind: "status", payload_json: "{}" });
    const big2: RawEvent[] = [];
    for (let seq = 6001; seq <= 12000; seq++) big2.push({ seq, kind: "status", payload_json: "{}" });
    const deps = scriptedDeps(
      new Map<number | null, unknown>([
        [null, page(big, true)],
        [6000, page(big2, true)],
      ]),
    );
    const result = await readOutput(deps, params());
    expect(result.stopReason).toBe("pageLimit");
    expect(result.lastSeq).toBe(10000);
  });

  test("a drained stream with a terminal session record completes and flushes the partial line", async () => {
    const deps = scriptedDeps(
      new Map<number | null, unknown>([[null, page([out(1, "no newline tail")], false)]]),
      { status: "killed", exitCode: null },
    );
    const result = await readOutput(deps, params());
    expect(result.text).toBe("no newline tail");
    expect(result).toMatchObject({ complete: true, stopReason: "complete", resumeToken: null });
  });

  test("a terminal flush that cannot fit maxBytes carries the pending line in the token", async () => {
    const codec = createTokenCodec();
    // 12,000-char pending line: legal state (24,000 UTF-16 bytes, under the
    // 32 KiB cap) but over the 8 KiB text budget, so the flush must be
    // deferred to the next call.
    const tail = "tail-without-newline".repeat(600);
    const callA = scriptedDeps(
      new Map<number | null, unknown>([[null, page([out(1, `head\n`), out(2, tail)], false)]]),
      { status: "completed", exitCode: 0 },
    );
    callA.codec = codec;
    const a = await readOutput(callA, params({ maxBytes: 8_192 }));
    expect(a).toMatchObject({ complete: false, truncated: true, stopReason: "maxBytes" });
    expect(a.text).toBe("head\n");
    expect(a.lastSeq).toBe(2); // the event was consumed; only its flush is deferred

    const callB = scriptedDeps(new Map(), { status: "completed", exitCode: 0 });
    callB.codec = codec;
    const b = await readOutput(callB, params({ resumeToken: a.resumeToken! }));
    expect(b.text).toBe(tail);
    expect(b.complete).toBe(true);
  });

  test("state too large with no text produced returns OUTPUT_STATE_TOO_LARGE with a token in details", async () => {
    const deps = scriptedDeps(
      new Map<number | null, unknown>([[null, page([out(1, "z".repeat(33_000))], false)]]),
    );
    try {
      await readOutput(deps, params());
      throw new Error("expected OUTPUT_STATE_TOO_LARGE");
    } catch (err) {
      expect(err).toBeInstanceOf(ScryError);
      expect((err as ScryError).code).toBe("OUTPUT_STATE_TOO_LARGE");
      expect(typeof (err as ScryError).details?.["resumeToken"]).toBe("string");
    }
  });

  test("state too large after text was produced returns the maxBytes tuple first", async () => {
    const deps = scriptedDeps(
      new Map<number | null, unknown>([
        [null, page([out(1, "some text\n"), out(2, "z".repeat(33_000))], false)],
      ]),
    );
    const result = await readOutput(deps, params());
    expect(result).toMatchObject({ stopReason: "maxBytes", truncated: true, complete: false });
    expect(result.text).toBe("some text\n");
    expect(result.lastSeq).toBe(1);
  });

  test("an event emitting more than the 1 MiB fresh budget in one line is state-too-large", async () => {
    const oneLine = `${"w".repeat(MAX_TEXT_BYTES + 10)}\n`;
    const deps = scriptedDeps(new Map<number | null, unknown>([[null, page([out(1, oneLine)], false)]]));
    await expect(readOutput(deps, params())).rejects.toMatchObject({
      code: "OUTPUT_STATE_TOO_LARGE",
    });
  });

  test("terminal status triggers one final drain so racing trailing events are not dropped", async () => {
    // Events 1-2 land between the reader's empty drain and its session fetch.
    let call = 0;
    const fetches: (number | null)[] = [];
    const deps: ReadOutputDeps = {
      codec: createTokenCodec(),
      fetchEvents: (afterSeq) => {
        call += 1;
        fetches.push(afterSeq);
        if (call === 1) return Promise.resolve(page([], false));
        return Promise.resolve(
          afterSeq === null ? page([out(1, "late output\n"), exit(2)], false) : page([], false),
        );
      },
      fetchSession: () => Promise.resolve({ status: "completed", exitCode: 0 }),
      sleep: () => Promise.resolve(),
    };
    const result = await readOutput(deps, params());
    expect(result.text).toBe("late output\n");
    expect(result.complete).toBe(true);
    expect(fetches.length).toBeGreaterThanOrEqual(2);
  });

  test("the deadline is honored while draining hasMore pages", async () => {
    const pages = new Map<number | null, unknown>();
    pages.set(null, page([out(1, "x\n")], true));
    for (let seq = 1; seq < 300; seq++) pages.set(seq, page([out(seq + 1, "x\n")], true));
    const deps = scriptedDeps(pages);
    const result = await readOutput(deps, params({ timeoutMs: 0 }));
    expect(result.stopReason).toBe("timeout");
    expect(deps.fetches.length).toBe(1);
  });

  test("an explicit afterSeq starts from that cursor with an empty parser", async () => {
    const deps = scriptedDeps(
      new Map<number | null, unknown>([[7, page([out(8, "after\n"), exit(9)], false)]]),
    );
    const result = await readOutput(deps, params({ afterSeq: 7 }));
    expect(result.text).toBe("after\n");
    expect(deps.fetches).toEqual([7]);
  });

  test("an already-aborted signal stops promptly without fetching", async () => {
    const deps = scriptedDeps(new Map<number | null, unknown>([[null, page([out(1, "x\n")], false)]]));
    const controller = new AbortController();
    controller.abort();
    await expect(readOutput(deps, params({ signal: controller.signal }))).rejects.toBeInstanceOf(
      ScryError,
    );
    expect(deps.fetches).toEqual([]);
  });
});
