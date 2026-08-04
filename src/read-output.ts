import { ScryError } from "./errors.js";
import { createSanitizer, type Sanitizer } from "./sanitizer.js";
import { MAX_PENDING_RAW_BYTES, type TokenCodec } from "./resume-token.js";

/**
 * Bounded polling reader for session events (PRD §6.3, FR-11..FR-20).
 *
 * Pages are drained while `hasMore`; the reader only sleeps when no newer
 * event is available. Output events flow through the streaming sanitizer with
 * try-before-commit budgeting: an event is only consumed once its emitted
 * text fits `maxBytes` and its pending state fits the 32 KiB token bound, so
 * every successful stop leaves a token positioned exactly at the last
 * represented event.
 */

export const MAX_TEXT_BYTES = 1024 * 1024;
export const PAGE_LIMIT = 100;
export const EVENT_LIMIT = 10_000;
export const POLL_INTERVAL_MS = 150;
export const EVENTS_PAGE_SIZE = 100;

export type ReadOutputDeps = {
  /** Fetch one events page (limit 100) after the given cursor (null = from start). */
  fetchEvents: (afterSeq: number | null) => Promise<unknown>;
  /** Fetch the authoritative session record for the terminal check. */
  fetchSession: () => Promise<{ status: string; exitCode: number | null }>;
  codec: TokenCodec;
  now?: () => number;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
};

export type ReadOutputParams = {
  sessionId: string;
  afterSeq?: number;
  resumeToken?: string;
  timeoutMs: number;
  maxBytes: number;
  signal?: AbortSignal;
};

export type ReadOutputResult = {
  text: string;
  lastSeq: number | null;
  resumeToken: string | null;
  complete: boolean;
  truncated: boolean;
  stopReason: "complete" | "timeout" | "maxBytes" | "pageLimit";
  diagnostics: { malformedPayloads: number; unknownEvents: number };
};

const SILENT_KINDS = new Set(["input", "status", "kill"]);
const TERMINAL_STATUSES = new Set([
  "completed",
  "failed",
  "killed",
  "exited",
  "errored",
  "error",
  "cancelled",
  "canceled",
  "stopped",
  "done",
]);

type RawEvent = { seq: number; kind: string; payloadJson: string | undefined };
type EventsPage = { events: RawEvent[]; hasMore: boolean };

function contractError(kind: string, message: string): ScryError {
  return new ScryError("UPSTREAM_ERROR", message, false, { kind });
}

function normalizeEventsPage(raw: unknown): EventsPage {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw contractError("invalid_events_page", "Events response has an unexpected shape");
  }
  const record = raw as Record<string, unknown>;
  const events = record["events"];
  if (!Array.isArray(events)) {
    throw contractError("invalid_events_page", "Events response has an unexpected shape");
  }
  return {
    events: events.map((entry): RawEvent => {
      if (typeof entry !== "object" || entry === null) {
        throw contractError("invalid_event_schema", "Event entry has an unexpected shape");
      }
      const event = entry as Record<string, unknown>;
      const seq = event["seq"];
      const kind = event["kind"];
      if (typeof seq !== "number" || !Number.isSafeInteger(seq) || seq < 0 || typeof kind !== "string") {
        throw contractError("invalid_event_schema", "Event entry has an unexpected shape");
      }
      return {
        seq,
        kind,
        payloadJson: typeof event["payload_json"] === "string" ? event["payload_json"] : undefined,
      };
    }),
    hasMore: record["hasMore"] === true,
  };
}

function defaultSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(done, ms);
    function done(): void {
      clearTimeout(timer);
      signal?.removeEventListener("abort", done);
      resolve();
    }
    signal?.addEventListener("abort", done, { once: true });
  });
}

export async function readOutput(deps: ReadOutputDeps, params: ReadOutputParams): Promise<ReadOutputResult> {
  const now = deps.now ?? Date.now;
  const sleep = deps.sleep ?? defaultSleep;
  const diagnostics = { malformedPayloads: 0, unknownEvents: 0 };

  if (params.afterSeq !== undefined && params.resumeToken !== undefined) {
    throw new ScryError("INVALID_INPUT", "afterSeq and resumeToken are mutually exclusive", false);
  }

  let afterSeq: number | null;
  let sanitizer: Sanitizer;
  if (params.resumeToken !== undefined) {
    const state = deps.codec.decode(params.resumeToken, params.sessionId);
    afterSeq = state.afterSeq;
    sanitizer = createSanitizer(state.pendingRaw);
  } else {
    afterSeq = params.afterSeq ?? null;
    sanitizer = createSanitizer();
  }

  let text = "";
  let textBytes = 0;
  let lastSeq: number | null = afterSeq;
  let pagesWithData = 0;
  let eventsConsumed = 0;
  let terminalSeen = false;
  const deadline = now() + params.timeoutMs;

  const token = (): string =>
    deps.codec.encode({ sessionId: params.sessionId, afterSeq, pendingRaw: sanitizer.pendingRaw() });

  const stop = (
    stopReason: "timeout" | "maxBytes" | "pageLimit",
    pending?: { afterSeq: number | null; pendingRaw: string },
  ): ReadOutputResult => ({
    text,
    lastSeq,
    resumeToken:
      pending === undefined
        ? token()
        : deps.codec.encode({
            sessionId: params.sessionId,
            afterSeq: pending.afterSeq,
            pendingRaw: pending.pendingRaw,
          }),
    complete: false,
    truncated: stopReason !== "timeout",
    stopReason,
    diagnostics,
  });

  const completeResult = (): ReadOutputResult | null => {
    // FR-19: flush is trialed first; if it cannot fit the remaining budget the
    // pending line stays in the token and this stop becomes maxBytes instead.
    const trial = createSanitizer(sanitizer.pendingRaw());
    const flushed = trial.flush();
    if (textBytes + Buffer.byteLength(flushed, "utf8") > params.maxBytes) return null;
    text += flushed;
    return {
      text,
      lastSeq,
      resumeToken: null,
      complete: true,
      truncated: false,
      stopReason: "complete",
      diagnostics,
    };
  };

  const checkAbort = (): void => {
    if (params.signal?.aborted) {
      throw new ScryError("INTERNAL_ERROR", "Request cancelled", false);
    }
  };

  for (;;) {
    checkAbort();
    if (pagesWithData >= PAGE_LIMIT || eventsConsumed >= EVENT_LIMIT) {
      return stop("pageLimit");
    }

    const page = normalizeEventsPage(await deps.fetchEvents(afterSeq));
    if (page.events.length === 0 && page.hasMore) {
      throw contractError("cursor_regression", "Daemon reported more events but returned none");
    }
    if (page.events.length > 0) pagesWithData += 1;

    for (const event of page.events) {
      if (afterSeq !== null && event.seq <= afterSeq) {
        throw contractError("cursor_regression", "Event sequence did not advance");
      }

      if (event.kind === "output") {
        let data: string | undefined;
        if (event.payloadJson === undefined) {
          diagnostics.malformedPayloads += 1;
        } else {
          try {
            const payload: unknown = JSON.parse(event.payloadJson);
            const candidate = (payload as Record<string, unknown>)["data"];
            if (typeof candidate === "string") data = candidate;
            else diagnostics.malformedPayloads += 1;
          } catch {
            diagnostics.malformedPayloads += 1;
          }
        }
        if (data !== undefined) {
          const snapshotPending = sanitizer.pendingRaw();
          const emitted = sanitizer.push(data);
          const emittedBytes = Buffer.byteLength(emitted, "utf8");
          // Pending state is measured as the token stores it (utf16le).
          const pendingBytes = Buffer.byteLength(sanitizer.pendingRaw(), "utf16le");
          if (textBytes + emittedBytes > params.maxBytes || pendingBytes > MAX_PENDING_RAW_BYTES) {
            // Revert: the event stays unconsumed and the token points at the
            // prior event with the prior parser state (FR-18).
            sanitizer = createSanitizer(snapshotPending);
            const fitsFresh = emittedBytes <= MAX_TEXT_BYTES && pendingBytes <= MAX_PENDING_RAW_BYTES;
            if (!fitsFresh && textBytes === 0) {
              throw new ScryError(
                "OUTPUT_STATE_TOO_LARGE",
                "Session output exceeds the maximum text or pending-state bounds",
                false,
                { resumeToken: token() },
              );
            }
            return stop("maxBytes");
          }
          text += emitted;
          textBytes += emittedBytes;
        }
      } else if (event.kind === "exit") {
        afterSeq = event.seq;
        lastSeq = event.seq;
        eventsConsumed += 1;
        return completeResult() ?? stop("maxBytes");
      } else if (!SILENT_KINDS.has(event.kind)) {
        diagnostics.unknownEvents += 1;
      }

      afterSeq = event.seq;
      lastSeq = event.seq;
      eventsConsumed += 1;
      if (eventsConsumed >= EVENT_LIMIT) return stop("pageLimit");
    }

    if (page.hasMore) {
      // FR-16: the deadline bounds even a firehose drain.
      if (now() >= deadline) return stop("timeout");
      continue;
    }

    // A terminal session completes only after one further drain came back
    // empty, so events racing the session fetch are not silently dropped.
    if (terminalSeen) return completeResult() ?? stop("maxBytes");
    const session = await deps.fetchSession();
    if (session.exitCode !== null || TERMINAL_STATUSES.has(session.status)) {
      terminalSeen = true;
      continue;
    }
    if (now() >= deadline) return stop("timeout");
    await sleep(Math.min(POLL_INTERVAL_MS, Math.max(1, deadline - now())), params.signal);
  }
}
