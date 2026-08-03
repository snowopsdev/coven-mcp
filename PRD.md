# PRD — `scry`

**An MCP server that bridges the Coven daemon to any stdio-capable MCP client.**

| | |
| --- | --- |
| Status | Design reviewed — implementation not started; daemon handshake verified Aug 3, 2026 |
| Owner | snow (solo) |
| Derived from | `PLAN.md` |
| Coven baseline | `1fe9a744356ea3af6b47a3d497a483513b36eb15` (`coven 0.0.34` locally) |
| MCP comparison | Public org view on Aug 3: `coven-reach@07f5c9d`, `coven-codeflow@5fd9df1` |
| Ship deadline | Provisional: Fri Aug 7 2026, 23:59 EDT; official brief must be rechecked |
| License | MIT (unmodified) |

---

## 1. Problem

Coven is a local-first agent runtime. It manages familiars, sessions, harnesses, and memory behind a documented HTTP-over-Unix-socket API (`coven.daemon.v1`).

OpenCoven already contains MCP technology: `coven-reach` is a standalone stdio MCP server for filesystem and web operations, while `coven-codeflow` can consume local and remote MCP servers. Neither provides an MCP tool surface over the Coven daemon's session lifecycle, event stream, harness capability manifests, or memory listing.

The consequence: a developer already working inside Claude Desktop, Cursor, or another stdio-capable MCP client cannot see or drive their Coven sessions without leaving that client. Coven's state is invisible to the tools people actually work in.

## 2. Solution

A standalone MCP server, `scry`, that exposes the Coven daemon as MCP tools over stdio. Point any stdio-capable MCP client at it and Coven's sessions, harnesses, output, and memory listing become first-class tools in that client — with no changes to Coven itself.

**Positioning:** additive, not duplicative. `scry` does not compete with `coven-reach`'s filesystem/web tools or `coven-codeflow`'s MCP client. It adapts the existing local daemon contract into lifecycle and observability tools. `coven-familiar-spec` lists an MCP server registry as intent; `coven-harness-capabilities` lists cross-harness MCP exposure as an explicit current non-goal.

## 3. Users

| User | Need | Served by |
| --- | --- | --- |
| **Coven user inside an MCP client** (primary) | See and drive Coven sessions without context-switching | All tools |
| **Coven user debugging a stuck session** | Inspect session state and output without the Cave GUI | Read tools |
| **Hackathon judge** | Verify the package deterministically, then run the live workflow when Coven prerequisites are present | Demo + `verify` script |

The judge is a real user with real requirements. Design for them explicitly.

## 4. Goals / Non-goals

### Goals

- G1 — Any standards-compliant, stdio-capable MCP client can list, inspect, start, drive, and kill Coven sessions.
- G2 — Session output is retrievable in readable form (ANSI-stripped, reassembled).
- G3 — Safe by default: write operations denied unless explicitly allowlisted.
- G4 — A judge runs build/package checks and the fake-daemon workflow from a clean clone in under 10 minutes; the separately timed live workflow runs after documented Coven/harness prerequisites are present.
- G5 — Honest scope: every limitation documented rather than hidden.

### Non-goals

For v1, state these plainly in README:

- N1 — Token-level streaming. No push transport exists on the socket; `coven-relay` is a stub that accepts the WebSocket upgrade and immediately closes.
- N2 — Windows. Named-pipe transport is undocumented; source-only.
- N3 — Semantic memory search. `coven-memory` is a separate binary, not reachable over the socket, and clients are explicitly forbidden from opening its database directly.
- N4 — Hub, scheduler, and travel routes.
- N5 — `POST /actions`. Exactly one action id exists today (`coven.capabilities.refresh`).
- N6 — Claims. `coven claim` is CLI-only; there is no API route.

## 5. Success metrics

| # | Metric | Target |
| --- | --- | --- |
| M1 | Tools callable from a real MCP client against a live daemon | 100% of shipped tools |
| M2 | Clean-clone → build/package + fake-daemon verification | ≤10 min |
| M3 | Test suite from clean clone | green, no credentials required |
| M4 | Write ops blocked outside allowlist | 100% |
| M5 | Secrets in repo | zero |
| M6 | Required README sections present and non-empty | 15/15 |
| M7 | MCP stdout protocol contamination | zero non-JSON-RPC writes |
| M8 | Event response size | always bounded; resumable when truncated or timed out |
| M9 | Live demo after prerequisites | ≤5 min |

## 6. Functional requirements

### 6.1 Connection & handshake

- **FR-1** — Resolve socket path from `COVEN_SOCKET` → `$COVEN_HOME/coven.sock` → `~/.coven/coven.sock`, in that order. `COVEN_SOCKET` is a literal path; `COVEN_HOME` is a directory.
- **FR-2** — `coven_health` calls `GET /api/v1/health` without requiring a prior handshake. It is a diagnostic exception to FR-31: socket/HTTP/schema failure returns `isError: false` with `HealthResult { reachable: false, ok: false, error }`; a valid daemon response returns `reachable: true` and its normalized fields even when the named version is incompatible. Other tools use error results.
- **FR-3** — Before each non-health call, perform (or reuse a short-lived result from) the health check. Require `ok === true`, `apiVersion === "coven.daemon.v1"`, and the named capability required when health advertises one (`sessions` or `events` at minimum); unflagged v1 routes still require strict success-schema validation. The cache TTL is 1,500ms for success and failure alike, and concurrent gate checks share a single in-flight health request. A required capability is satisfied only when its advertised value is exactly `true`; string values are diagnostic and do not satisfy the gate. A failed cache entry MUST NOT prevent recovery after the daemon starts or restarts.
- **FR-4** — Register all nine MCP tools regardless of daemon state so MCP discovery remains stable. On mismatch or a missing capability, non-health tools return descriptive, fail-closed tool errors; they do not disappear and do not silently degrade.
- **FR-5** — MUST NOT use `GET /api/v1/api-version` for the version check. Docs state it is a legacy route-family diagnostic and not proof of `coven.daemon.v1` support.
- **FR-6** — If the socket is absent or unreachable, return an actionable error naming `coven daemon start`. Distinguish this from HTTP, JSON, version, and capability failures.
- **FR-7** — Every socket request has a 2s connection timeout and a 5s per-request response timeout (also bounded by the remaining `read_output` deadline), sends `Connection: close`, validates status and the JSON content shape, rejects outbound bodies over the daemon's 4 MiB Unix-socket cap, and rejects inbound bodies over 4 MiB. Timed-out requests are aborted and cleaned up.

### 6.2 Tool surface

Write-gated tools are marked **[W]** and require allowlist approval (§6.4). All routes below are under `/api/v1`; path parameters are URI-encoded. MCP inputs and outputs use camelCase even when the daemon returns snake_case.

| Tool | Input | Route | Stable MCP output |
| --- | --- | --- | --- |
| `coven_health` | — | `GET /health` | `{ reachable, ok, apiVersion?, covenVersion?, capabilities?, error? }` |
| `coven_list_harnesses` | — | `GET /capabilities/harnesses` | `{ harnesses, covenSkills, scannedAt }` |
| `coven_list_sessions` | `{ limit?, cursor?, includeArchived? }` | `GET /sessions` | `{ sessions, nextCursor, hasMore }` regardless of upstream array/envelope shape |
| `coven_get_session` | `{ sessionId }` | `GET /sessions/:id` | `{ session }` with a normalized `SessionRecord` |
| `coven_start_session` **[W]** | `{ projectRoot, cwd?, harness, prompt, model?, title? }` | `POST /sessions` | `{ session }` (the daemon returns a full record) |
| `coven_send_input` **[W]** | `{ sessionId, data }` | `GET /sessions/:id`, then `POST /sessions/:id/input` | `{ ok, accepted }` |
| `coven_kill_session` **[W]** | `{ sessionId }` | `GET /sessions/:id`, then `POST /sessions/:id/kill` | `{ ok, accepted }` |
| `coven_read_output` | `{ sessionId, afterSeq?, resumeToken?, timeoutMs?, maxBytes? }` | `GET /sessions/:id/events` | `{ text, lastSeq, resumeToken, complete, truncated, stopReason, diagnostics }` |
| `coven_list_memory` | — | `GET /memory` | `{ entries }`; excerpts blank by default and available only under the policy below |

- **FR-8** — Every tool description MUST state its authority level, side effects, and whether it can expose local metadata/content. The description is the LLM's primary signal about what a tool does. Tools also declare MCP tool annotations: `readOnlyHint: true` on the six read tools, and `destructiveHint: true` on `coven_kill_session`. Annotations are advisory hints, never a substitute for the §6.4 allowlist.
- **FR-9** — `coven_list_memory` MUST be documented as a **file lister, not search or full-content read**. The daemon route enumerates Markdown files and includes a bounded excerpt (currently the first paragraph, up to 200 characters), so blindly forwarding it is content disclosure. `scry` blanks excerpts by default. Only `SCRY_INCLUDE_MEMORY_EXCERPTS=true` enables forwarding, and `revealRequired === true` or any non-null classification other than `public` still forces a blank excerpt with `excerptRedacted: true`. `excerptRedacted` is `true` exactly when `scry` blanked a non-empty daemon-provided excerpt (default-off mode or forced redaction); it is `false` when the daemon itself returned an empty excerpt or the excerpt was forwarded. The route has no query capability; do not advertise unsupported `familiarId` or `limit` filters.
- **FR-10** — Validate every tool input before I/O: reject unknown fields, strings outside their stated size bounds, non-integer cursors/limits, invalid timeout/byte bounds, NUL bytes, and malformed session ids. Validation failures return the `INVALID_INPUT` error (§6.5) naming the offending field and constraint, never echoing oversized or binary values. Never interpolate an unencoded id into a route.

Stable normalized shapes (additive optional fields are allowed):

```ts
type HealthCapabilities = Record<string, boolean | string>;

type HealthResult = {
  reachable: boolean;
  ok: boolean;
  apiVersion?: string;
  covenVersion?: string;
  capabilities?: HealthCapabilities;
  error?: ScryToolError;
};

type SessionRecord = {
  id: string;
  projectRoot: string;
  harness: string;
  status: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  familiarId: string | null;
  conversationId: string | null;
  exitCode: number | null;
  archivedAt: string | null;
  labels: string[];
  visibility: string;
  external: boolean;
  transcriptPath: string | null;
};

type HarnessSkill = {
  id: string;
  name: string;
  source: string;
  harnessId: string;
  path: string;
  description?: string;
  version?: string;
  tags: string[];
};

type HarnessPlugin = {
  id: string;
  name: string;
  source: string;
  harnessId: string;
  kind: string;
  enabled: boolean;
  transport?: string;
  command?: string;
  args?: string[];
};

type CapabilityWarning = {
  kind: string;
  path: string;
  message: string;
};

type HarnessSummary = {
  harnessId: string;
  globalInstructions: {
    present: boolean;
    path?: string; // may be an absolute local path
    byteCount?: number;
  };
  plugins: HarnessPlugin[];
  skills: HarnessSkill[];
  warnings: CapabilityWarning[];
  scannedAt: string;
};

type CovenSkill = {
  id: string;
  name: string;
  owner: string;
  category: string;
  tags: string[];
  score: number;
  effectiveRate: number;
  appliedRate: number;
  completionRate: number;
  fallbackRate: number;
  version: string;
  description: string;
};

type MemoryEntry = {
  id: string;
  familiarId: string;
  title: string;
  path: string; // daemon-provided relative path, never an absolute path
  updatedAt: string;
  updatedAtIso: string;
  excerpt: string; // blank unless excerpt policy permits disclosure
  excerptRedacted: boolean;
  source: { kind: string; label: string };
  privacyClassification?: string | null;
  revealRequired?: boolean | null;
  verificationState: string;
};

type ScryToolError = {
  code: string;
  message: string;
  retryable: boolean;
  details?: Record<string, unknown>;
};

type ListHarnessesResult = {
  harnesses: HarnessSummary[];
  covenSkills: CovenSkill[];
  scannedAt: string; // aggregate scan time; each harness has its own scan time
};

type ListSessionsResult = {
  sessions: SessionRecord[];
  nextCursor: string | null;
  hasMore: boolean; // derived as nextCursor !== null
};

type SessionResult = { session: SessionRecord };
type AckResult = { ok: boolean; accepted: boolean };
type MemoryListResult = { entries: MemoryEntry[] };

type ReadOutputResult = {
  text: string;
  lastSeq: number | null;
  resumeToken: string | null;
  complete: boolean;
  truncated: boolean;
  stopReason: "complete" | "timeout" | "maxBytes" | "pageLimit";
  diagnostics: { malformedPayloads: number; unknownEvents: number };
};
```

The table maps to these exact wrappers: `coven_health → HealthResult`, `coven_list_harnesses → ListHarnessesResult`, `coven_list_sessions → ListSessionsResult`, get/start → `SessionResult`, input/kill → `AckResult`, output → `ReadOutputResult`, and memory → `MemoryListResult`. Parsers ignore additive upstream fields but do not forward fields outside these normalized types.

`coven_list_sessions.limit` defaults to 100 and is constrained to 1–1000; `includeArchived` defaults to `false`; `cursor` is the opaque upstream string and is capped at 4 KiB. `timeoutMs` defaults to 30,000 and is constrained to 0–120,000; `maxBytes` defaults to 1 MiB and is constrained to 64 KiB–1 MiB. `afterSeq` is a non-negative safe integer. `afterSeq` and `resumeToken` are mutually exclusive. A `resumeToken` is capped at 64 KiB, and the complete serialized `coven_read_output` result is capped at 4 MiB.

String bounds are UTF-8 bytes: `sessionId` 1–256 and limited to `[A-Za-z0-9._:-]`; `harness` 1–128 and limited to `[A-Za-z0-9._-]`; `projectRoot`/`cwd` 1–4096; `model` 1–256; `title` 0–512; `prompt` and `data` 1 byte–1 MiB. The fully serialized POST body must also remain below 4 MiB. All strings reject NUL; filesystem paths are additionally validated by §6.4. `coven_send_input.data` is forwarded to the PTY **verbatim**: `scry` never appends a newline or otherwise rewrites it, and the tool description states that callers must include a trailing newline when they intend to submit a line.

For `coven_list_sessions`, build query parameters with `URLSearchParams`: always send decimal `limit` (100 when omitted), send `includeArchived` as lowercase `true`/`false`, and include the opaque `cursor` only when provided. This deliberately selects the upstream paginated envelope; the parser still accepts the legacy bare array in contract fixtures and normalizes it with `nextCursor: null` and `hasMore: false`.

### 6.3 Event reading — `coven_read_output`

The hardest component. Requirements derived from the documented API and source-verified behavior:

- **FR-11** — Poll canonical `GET /api/v1/sessions/:id/events` with `URLSearchParams`. Always send `limit=100`. On a fresh call with neither input cursor, omit `afterSeq`; with explicit `afterSeq`, send its decimal form; with `resumeToken`, verify it and send the token payload's `afterSeq` in decimal only when non-null. A null token cursor means no event has been consumed and also omits the parameter. Never send a blank cursor. Advance via `nextCursor.afterSeq`. The global `/events?sessionId=` alias is not used in v1.
- **FR-12** — Follow `hasMore` immediately until the current page set is drained; only sleep when no newer event is available. Treat a missing/regressing cursor as a contract error instead of looping forever. Cap one tool call at 100 pages / 10,000 consumed events. Reaching either cap returns the successful `pageLimit` tuple from FR-18 with a token at the last consumed event.
- **FR-13** — `payload_json` is a **JSON string**, not an object. It requires a second parse. Malformed payloads MUST be skipped and increment `diagnostics.malformedPayloads`; they are not fatal and are not silently treated as output.
- **FR-14** — Handle event kinds `output`, `input`, `status`, `exit`. These are source-derived. Unknown kinds MUST be ignored gracefully and increment `diagnostics.unknownEvents`.
- **FR-15** — `output.data` is raw PTY text: ANSI escapes, carriage returns, partial lines, and escape sequences split across event chunks. Concatenate through a streaming state machine (or concatenate before stripping) so split ANSI sequences cannot leak; normalize carriage-return behavior deterministically.
- **FR-16** — Terminate on an `exit`/terminal session, `timeoutMs`, `maxBytes`, or the page/event cap (`pageLimit`). `complete` means an exit was observed or, after the event page is drained, the authoritative session record is terminal. Timeout returns `complete: false`; byte/page exhaustion also returns `truncated: true`.
- **FR-17** — Lossless continuation uses `base64url(canonical JSON payload) + "." + base64url(HMAC-SHA-256(payload))`, where the payload is `{ v: 1, sessionId, afterSeq: number | null, pendingRawB64 }` and the signature key is a random 256-bit per-process secret. Null `afterSeq` is the explicit pre-first-event state; therefore a fresh `timeoutMs: 0` result can return a valid non-null token without inventing a sentinel, skipping, or duplicating the first event. Tokens are opaque and integrity-protected but **not encrypted**; treat them as session output and never log them. The decoded pending raw state is capped at 32 KiB: its base64 field is at most 43,692 bytes, the capped session id/JSON overhead keeps the encoded payload below 60 KiB, and the complete token (including the 43-byte signature) must be ≤64 KiB. Tokens are bound to `sessionId` and intentionally invalid after server restart. Because MCP clients routinely restart stdio servers (config edits, client relaunch), the documented recovery path is: call again with explicit `afterSeq` set to the last observed `lastSeq` (present in every `ReadOutputResult`), accepting the loss of the un-emitted pending line/escape state; README's troubleshooting section MUST document this. The pending state represents the sanitizer's un-emitted current-line/escape state, so split ANSI sequences and carriage-return rewrites survive call boundaries. An initial explicit `afterSeq` sets that numeric state with an empty parser; subsequent calls use `resumeToken`. Advance past an event only after its emitted text or pending state is represented in the response/token. Invalid signature/encoding, oversized, wrong-session, or unsupported-version tokens return `INVALID_RESUME_TOKEN`.
- **FR-18** — `maxBytes` counts UTF-8 bytes of sanitized `text` only, and `diagnostics` covers only events consumed by that call. Every successful stop returns exactly one of these tuples:

  | Reason | `complete` | `truncated` | `resumeToken` |
  | --- | ---: | ---: | --- |
  | `complete` | true | false | null |
  | `timeout` | false | false | non-null |
  | `maxBytes` | false | true | non-null |
  | `pageLimit` | false | true | non-null |

  If the next event fits a fresh call but not the current remaining text/state budget, stop successfully **before** consuming it with the current text, a token at the prior event, and the `maxBytes` tuple. If an event or cumulative pending line cannot fit a fresh call at the maximum 1 MiB text budget and 32 KiB decoded-state bound, first return any text already produced using the successful `maxBytes` tuple; only a subsequent call with no newly produced text returns `OUTPUT_STATE_TOO_LARGE` and the unchanged input token in safe details. Thus an error never discards text from its call.
- **FR-19** — On terminal completion, feed end-of-stream to the sanitizer, discard an incomplete ANSI control sequence, apply the final carriage-return rewrite, and flush the pending line. If that flush does not fit the current `maxBytes`, use the `maxBytes` tuple and carry the pending line; otherwise use the `complete` tuple. `diagnostics` is always `{ malformedPayloads: number, unknownEvents: number }`. The complete serialized result, including token and diagnostics, must fit the 4 MiB result cap.
- **FR-20** — Poll interval defaults to 150ms. Never busy-loop. Abort polling promptly when the MCP request/server is cancelled or shutting down.

### 6.4 Security — authority boundary

The daemon has **no authentication**. Trust is same-user local socket access. `scry` therefore inherits full same-user authority: anything exposed to an LLM can spawn PTY processes in arbitrary project roots.

- **FR-21** — `SCRY_ALLOWED_ROOTS` (colon-separated absolute paths on supported Unix platforms) gates all **[W]** tools.
- **FR-22** — **Unset or empty ⇒ read-only mode.** Deny by default. Never open by default. Boolean-valued `SCRY_*` variables (e.g. `SCRY_INCLUDE_MEMORY_EXCERPTS`) recognize only the exact literal `true` as enabled; every other value, including `1`, `TRUE`, and `yes`, is treated as disabled.
- **FR-23** — At startup/config parse, require allowlist roots to be absolute existing directories and canonicalize them. Containment uses path components, not raw string prefixes. If **any** allowlist entry is relative, missing, not a directory, or fails canonicalization, the server exits non-zero at startup with a metadata-only stderr message naming the offending entry's position (not silently dropping it or degrading to read-only) — a misconfigured allowlist must be loud, never partially honored.
- **FR-24** — For `coven_start_session`, canonicalize `projectRoot` and optional `cwd`; require both to remain within an allowed root and require `cwd` to remain within `projectRoot`. Reject traversal, missing paths, non-directories, and symlink escapes.
- **FR-25** — For `coven_send_input` and `coven_kill_session`, first fetch the authoritative session record and authorize its canonical `project_root`. Never accept or trust a caller-supplied project root. A missing/malformed root, failed lookup, failed canonicalization, or disallowed root denies the mutation.
- **FR-26** — Denials return a clear MCP tool error naming `SCRY_ALLOWED_ROOTS` and the denied operation, without echoing prompts, input data, or sensitive output.
- **FR-27** — Read tools remain available without an allowlist, but their descriptions and README threat model state that session titles/project paths, event output, harness-manifest paths (which may be absolute), memory paths/titles, and bounded memory excerpts may be disclosed to the connected MCP client/LLM. The threat model MUST also cover **prompt injection**: session output, titles, and memory excerpts are untrusted content that may contain instructions aimed at the consuming LLM. `scry` sanitizes encoding (ANSI/CR), not semantics — it never embeds returned content in its own tool descriptions or error messages, and README instructs users that tool results are data, not instructions.
- **FR-28** — The allowlist is an MCP authorization gate, not a process/filesystem sandbox. A harness started in an allowed root retains the user's broader same-user OS authority; this residual risk MUST be explicit in tool descriptions and README.
- **FR-29** — Never log prompt content, input data, session output, memory excerpts/content, environment values, raw resume tokens, or raw daemon error details. README MUST carry the complete threat model under "Security and privacy."

### 6.5 Error handling

- **FR-30** — Branch on `error.code`, never `error.message`. Preserve HTTP status and safe structured details for diagnostics, but never expose a raw daemon body.
- **FR-31** — Except for `coven_health`'s diagnostic behavior in FR-2, tool failures return an MCP `CallToolResult` with `isError: true` and one JSON text content item matching `ScryToolError`; expected daemon/user failures are not JSON-RPC transport errors. Required mappings:

| Condition | HTTP | Scry code | Retryable | Message contract |
| --- | --- | --- | --- | --- |
| `session_not_found` | 404 | `SESSION_NOT_FOUND` | false | "No session with id X" |
| `session_not_live` | 409 | `SESSION_NOT_LIVE` | false | "Session X exists but is not live" |
| unreachable socket | — | `DAEMON_UNAVAILABLE` | true | "Daemon not running — start with `coven daemon start`" |
| version mismatch | — | `INCOMPATIBLE_DAEMON` | false | "Requires coven.daemon.v1, found Y" |
| required capability absent | — | `CAPABILITY_UNAVAILABLE` | true | Names the required capability |
| allowlist denial | — | `ROOT_NOT_ALLOWED` | false | Names `SCRY_ALLOWED_ROOTS` and the operation, not sensitive input |
| invalid resume token | — | `INVALID_RESUME_TOKEN` | false | Names the validation reason category, never token contents |
| output state exceeds bound | — | `OUTPUT_STATE_TOO_LARGE` | false | Returns the prior valid token in safe structured details |
| tool input fails §6.2 validation | — | `INVALID_INPUT` | false | Names the field and violated constraint, never echoes oversized/binary values |
| any other daemon error envelope | varies | `UPSTREAM_ERROR` | true only for 5xx/429 | Carries the upstream `error.code` and HTTP status in safe details, never the raw body |
| unexpected `scry` failure | — | `INTERNAL_ERROR` | false | Generic message; no stack traces or internal state |

The daemon documents ~35 stable error codes; the named rows above are the only ones with bespoke handling, and every other code MUST fall through to `UPSTREAM_ERROR` rather than being dropped, re-thrown as a transport error, or matched by message text.

- **FR-32** — Requests are **camelCase** (`projectRoot`); `SessionRecord` and harness capability responses are **snake_case** (`project_root`, `harness_id`). Normalize all daemon responses to camelCase in one boundary module; tests pin both upstream and stable MCP shapes.
- **FR-33** — Distinguish malformed JSON, an unexpected success schema, non-JSON error bodies, and transport failures. Each becomes a bounded, actionable MCP tool error.
- **FR-34** — Treat additive upstream fields as compatible, but reject missing required fields. Unknown enum/event values are preserved or ignored according to the specific requirement, never used to authorize a write.
- **FR-35** — Session and event pagination must be loop-safe: validate cursors, enforce the numeric caps above, and surface `hasMore`/resume state rather than fetching without bound.

## 7. Non-functional requirements

- **NFR-1** — TypeScript, Node 22, `node:http` with `socketPath`. No HTTP dependency needed.
- **NFR-2** — MCP stdio transport only. No network listener.
- **NFR-3** — Zero credentials to run. Tests use a fake daemon fixture.
- **NFR-4** — Lockfile committed. No local absolute paths in any committed file.
- **NFR-5** — Pin the upstream `coven` commit SHA in README. Upstream ships ~10 commits/day at version `0.0.0`.
- **NFR-6** — Stdout is reserved exclusively for MCP JSON-RPC frames. Metadata-only diagnostics use stderr and default to quiet.
- **NFR-7** — `npm run build` produces a runnable Node 22 entry point with a correct shebang/package `bin`; `package.json` declares `engines.node: ">=22"`; `npm pack --dry-run` contains only intended runtime/docs/license files.
- **NFR-8** — Concurrent tool calls have isolated cursors, timers, buffers, and abort signals. A cached health result may be shared, but in-flight failure must not poison later calls.
- **NFR-9** — Handle SIGINT/SIGTERM and MCP transport close by aborting socket requests/pollers and exiting without corrupting stdout.

`npm run verify` proves, without Coven credentials: dependency install, typecheck, lint, unit/contract tests against a real HTTP server bound to a temporary Unix socket, production build, stdio MCP smoke test, package contents, and documentation checks. The smoke test needs no external MCP client: it spawns the built entry point and drives raw JSON-RPC frames over stdio — `initialize`, `tools/list` asserting all nine tools, and one `coven_health` call — while asserting stdout carries nothing but JSON-RPC. It does **not** prove provider authentication or a real harness launch. The live acceptance path additionally requires `coven 0.0.34` (or a revalidated compatible build), a running daemon, an authenticated supported harness, and an explicitly allowed existing project root.

## 8. Acceptance criteria

### Checkpoint A (~6h in, hard abort gate)

- [ ] MCP client lists the three Checkpoint A tools with the daemon stopped; the completed v1 applies this behavior to all nine tools
- [ ] `coven_health` returns live `apiVersion`
- [ ] `coven_list_sessions` returns real sessions

Not met ⇒ **descope immediately** to the Familiar Contract validator per `PLAN.md` §4.

### v1 complete

- [ ] All nine tools callable and correct against a live daemon
- [ ] Round trip: `start_session` → `send_input` → `read_output` → `kill_session`
- [ ] `read_output` returns human-readable, ANSI-free, bounded text and its opaque token resumes exactly after timeout/truncation, including split ANSI/CR state
- [ ] Write tools denied with empty allowlist; permitted only for canonical roots inside the allowlist
- [ ] `send_input` and `kill_session` deny sessions owned by a root outside the allowlist
- [ ] All required error mappings in FR-31 verified as structured `isError: true` tool results
- [ ] Fake-daemon contract tests cover connection failure, version/capability mismatch, request/response limits, array/envelope session pagination, malformed payloads, cursor regression, cross-call resume tokens with split ANSI/CR state, oversized single events, symlink/prefix escapes, cross-root session writes, and stdout purity
- [ ] Error-mapping tests cover `INVALID_INPUT` for each validated field class, `UPSTREAM_ERROR` fall-through for an unmapped daemon code, and startup exit on a misconfigured allowlist entry
- [ ] README troubleshooting documents the post-restart `afterSeq`/`lastSeq` resume-token recovery path
- [ ] `npm run verify` runs typecheck, lint, tests, build, package smoke test, and README/HACKATHON checks from a clean clone with no credentials
- [ ] 15 README sections present and non-empty
- [ ] Demo ≤5 min showing problem, startup, workflow, integration point, results, one limitation
- [ ] Tag `july-hackathon-2026-final` pushed; SHA in `HACKATHON.md`

## 9. Demo script (≤5 min)

1. **Problem** (30s) — Coven state is invisible from the client you actually work in.
2. **Startup** (30s) — `coven daemon start`; MCP client config shown.
3. **Read** (60s) — client lists harnesses and live sessions.
4. **Security** (45s) — start is denied with the allowlist unset; show the actionable error.
5. **Write** (90s) — enable one explicit root, reconnect the MCP server, then start a session, send input, and read bounded output back.
6. **Limitation** (30s) — no token streaming; explain why (no push transport upstream) and what would change it.

## 10. Dependencies

| Dependency | Risk | Mitigation |
| --- | --- | --- |
| `coven` daemon running locally | Verified Aug 3 against `coven 0.0.34`; judge environment still unknown | `coven doctor`; actionable health error |
| Authenticated harness (Codex/Claude Code) | Demo-blocking, not build-blocking | Verify before Thursday |
| `@modelcontextprotocol/sdk` | Low | Pin version |
| Upstream API stability | Medium — `covenVersion` 0.0.0, "Early MVP" | Pin SHA; contract promises additive-only changes |

## 11. Open questions

1. **BLOCKING FOR SUBMISSION, NOT BUILD — official brief unavailable.** The documented `OpenCoven/opencoven-beta-july-hackathon-2026` repository/submission URL was not accessible during this review. Reconfirm the deadline, tag, required README content, license/DCO rules, scoring, and submission form before Block 8.
2. The local `GET /api/v1/memory` response currently contains zero entries. Seed a non-sensitive demo fixture through supported Coven behavior, or deliberately demonstrate an honest empty result; never open the memory database directly.
3. Does `coven doctor` confirm at least one authenticated harness for the live write demo? Harness capability discovery alone does not prove provider authentication.
4. Publish to npm as `scry-mcp`, or repo-only? Publishing strengthens reproducibility; costs ~30 min. Either choice still requires a compiled entry point and clean-clone package smoke test.

## 12. Out of scope for v1 — the "next steps" list

Name these in README; they read as roadmap, not gaps.

- Token streaming via subprocess `coven run --stream-json` (the CLI protocol is Claude-Code-shaped and would relay well — a genuine v2)
- Windows named-pipe transport
- Semantic memory search via `coven-memory` shell-out
- MCP resources and prompts (v1 is tools-only)
- Multi-daemon / hub routing
