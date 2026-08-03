import { describe, expect, test } from "vitest";
import { normalizeHarnesses, normalizeListSessions, normalizeSessionRecord } from "./normalize.js";
import { ScryError } from "./errors.js";

/** Shape captured live from coven 0.0.34 on Aug 3, 2026 (pinned SHA in PLAN.md). */
const UPSTREAM_SESSION = {
  id: "64d318dc-bdd1-42fe-8c8f-08b945c64fec",
  project_root: "/work/app",
  harness: "claude",
  title: "Test session",
  status: "completed",
  exit_code: 0,
  archived_at: null,
  created_at: "2026-08-03T18:36:50.879857000Z",
  updated_at: "2026-08-03T18:37:05.482522000Z",
  conversation_id: null,
  familiar_id: "frost",
  labels: [],
  visibility: "private",
  external: false,
  transcript_path: null,
};

const UPSTREAM_HARNESSES = {
  scanned_at: "2026-08-03T19:36:42Z",
  coven_skills: [],
  harness_capabilities: [
    {
      harness_id: "codex",
      scanned_at: "2026-08-03T19:36:42Z",
      global_instructions: { present: true, path: "/home/u/.codex/AGENTS.md", byte_count: 0 },
      skills: [
        {
          id: "dependency-sweep",
          name: "dependency-sweep",
          source: "harness-native",
          harness_id: "codex",
          path: "/home/u/.codex/automations/dependency-sweep",
          tags: [],
        },
      ],
      plugins: [],
      warnings: [{ kind: "parse_error", path: "/home/u/x.toml", message: "could not parse" }],
    },
  ],
};

describe("normalizeSessionRecord", () => {
  test("converts the upstream snake_case record to the stable camelCase shape", () => {
    expect(normalizeSessionRecord(UPSTREAM_SESSION)).toEqual({
      id: "64d318dc-bdd1-42fe-8c8f-08b945c64fec",
      projectRoot: "/work/app",
      harness: "claude",
      status: "completed",
      title: "Test session",
      createdAt: "2026-08-03T18:36:50.879857000Z",
      updatedAt: "2026-08-03T18:37:05.482522000Z",
      familiarId: "frost",
      conversationId: null,
      exitCode: 0,
      archivedAt: null,
      labels: [],
      visibility: "private",
      external: false,
      transcriptPath: null,
    });
  });

  test("ignores additive upstream fields instead of forwarding them", () => {
    const normalized = normalizeSessionRecord({ ...UPSTREAM_SESSION, future_field: "x" });
    expect("futureField" in normalized).toBe(false);
    expect("future_field" in normalized).toBe(false);
  });

  test("rejects a record missing required fields with a bounded UPSTREAM_ERROR", () => {
    const { id: _id, ...withoutId } = UPSTREAM_SESSION;
    expect(() => normalizeSessionRecord(withoutId)).toThrowError(ScryError);
    try {
      normalizeSessionRecord(withoutId);
    } catch (err) {
      expect((err as ScryError).code).toBe("UPSTREAM_ERROR");
      expect((err as ScryError).details).toMatchObject({ kind: "invalid_session_record" });
    }
  });
});

describe("normalizeListSessions", () => {
  test("wraps the legacy bare array with nextCursor null and hasMore false", () => {
    const result = normalizeListSessions([UPSTREAM_SESSION]);
    expect(result.sessions).toHaveLength(1);
    expect(result.nextCursor).toBeNull();
    expect(result.hasMore).toBe(false);
  });

  test("normalizes the paginated envelope and derives hasMore from next_cursor", () => {
    const result = normalizeListSessions({
      sessions: [UPSTREAM_SESSION],
      next_cursor: "opaque-cursor",
    });
    expect(result.sessions[0]?.projectRoot).toBe("/work/app");
    expect(result.nextCursor).toBe("opaque-cursor");
    expect(result.hasMore).toBe(true);
  });

  test("an envelope with a null cursor means no further pages", () => {
    const result = normalizeListSessions({ sessions: [], next_cursor: null });
    expect(result.nextCursor).toBeNull();
    expect(result.hasMore).toBe(false);
  });
});

describe("normalizeHarnesses", () => {
  test("maps harness_capabilities to the stable HarnessSummary list", () => {
    const result = normalizeHarnesses(UPSTREAM_HARNESSES);
    expect(result.scannedAt).toBe("2026-08-03T19:36:42Z");
    expect(result.covenSkills).toEqual([]);
    expect(result.harnesses).toHaveLength(1);
    expect(result.harnesses[0]).toMatchObject({
      harnessId: "codex",
      scannedAt: "2026-08-03T19:36:42Z",
      globalInstructions: { present: true, path: "/home/u/.codex/AGENTS.md", byteCount: 0 },
      warnings: [{ kind: "parse_error", path: "/home/u/x.toml", message: "could not parse" }],
    });
    expect(result.harnesses[0]?.skills[0]).toMatchObject({
      id: "dependency-sweep",
      harnessId: "codex",
      tags: [],
    });
  });

  test("rejects a payload without harness_capabilities", () => {
    expect(() => normalizeHarnesses({ scanned_at: "x" })).toThrowError(ScryError);
  });
});
