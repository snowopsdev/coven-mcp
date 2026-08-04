# scry

An MCP server that bridges the Coven daemon to any stdio-capable MCP client.

## Overview

Coven runs agent sessions locally behind an HTTP-over-Unix-socket API. If you work inside Claude Desktop, Cursor, or another MCP client, that state is invisible: you cannot see which sessions are running, read what they printed, or drive them without leaving the client you are already in.

`scry` closes that gap. It is a standalone stdio MCP server that exposes the Coven daemon's session lifecycle, event output, harness capability manifests, and memory listing as nine MCP tools. Point any stdio-capable MCP client at it and Coven becomes first-class in that client — with no changes to Coven itself.

Three properties matter more than the tool count:

- **Safe by default.** Write tools (start, input, kill) are denied unless you explicitly allowlist project roots. Unset means read-only. See [Security and privacy](#security-and-privacy).
- **Readable output.** Raw PTY output — ANSI escapes, carriage-return progress bars, lines split across events — is reassembled into plain text, with signed tokens for lossless continuation across calls.
- **Honest scope.** Everything `scry` cannot do is documented in [Limitations / non-goals](#limitations--non-goals) rather than discovered at runtime.

## Why `scry`

OpenCoven already ships MCP technology, so the useful question is what is *not* covered:

| Project | What it is | Overlap with `scry` |
| --- | --- | --- |
| `coven-reach` | A standalone stdio MCP server for filesystem and web operations | None — different tool domain |
| `coven-codeflow` | An MCP **client** that consumes local and remote MCP servers | None — opposite side of the protocol |
| `scry` | An MCP **server** over the Coven daemon's own API | The daemon surface itself |

No reviewed first-party server exposes the daemon's session lifecycle, event stream, harness capabilities, and memory listing as MCP tools. `scry` is additive: it adapts an existing local contract, it does not reimplement or compete with either project.

This also sits with stated upstream direction rather than against it — `coven-familiar-spec` lists an MCP server registry as intent, while `coven-harness-capabilities` lists cross-harness MCP exposure as an explicit current non-goal.

## Prerequisites and supported platforms

| Requirement | Verified against |
| --- | --- |
| Node | 22+ (developed on v22.22.3) |
| Platform | macOS or Linux — Unix domain sockets only |
| Coven | CLI `0.0.34`, daemon API `coven.daemon.v1` |
| Daemon state | Running (`coven daemon start`); `coven doctor` is a good pre-flight |

Windows is out of scope (see [Limitations](#limitations--non-goals)). The live write demo additionally needs an authenticated harness — harness capability discovery alone does not prove a provider is authenticated.

Note: the daemon reports `covenVersion: "0.0.0"` even on a 0.0.34 install, so `scry` gates compatibility on `apiVersion` and advertised capabilities, never on that version string.

## Install and build

```sh
git clone https://github.com/snowopsdev/scry-mcp.git scry
cd scry
npm ci
npm run build
```

This produces a runnable entry point at `dist/index.js` with a shebang and a `scry-mcp` bin alias. No credentials, network access, or running daemon are needed to build.

## MCP client configuration

`scry` speaks MCP over stdio. Add it to your client's server list, replacing the placeholder path with your clone's absolute path.

Claude Desktop (`claude_desktop_config.json`) or any client using the same schema:

```json
{
  "mcpServers": {
    "scry": {
      "command": "node",
      "args": ["/path/to/scry/dist/index.js"],
      "env": {
        "SCRY_ALLOWED_ROOTS": "/path/to/your/project"
      }
    }
  }
}
```

Read-only mode is the default and the safe starting point — omit `env` entirely and every write tool is denied:

```json
{
  "mcpServers": {
    "scry": {
      "command": "node",
      "args": ["/path/to/scry/dist/index.js"]
    }
  }
}
```

Two behaviors worth knowing:

- **Tool discovery is stable.** All nine tools list even when the daemon is stopped, so you can configure `scry` before starting Coven. Tools return descriptive errors instead of disappearing.
- **Daemon restarts need no client restart.** Health is re-checked per call (cached ≤1.5 s), so starting or restarting the daemon recovers automatically.

Environment changes *do* require reconnecting the MCP server — the allowlist is read once at startup.

## Environment variables

| Variable | Purpose |
| --- | --- |
| `COVEN_SOCKET` | Explicit daemon socket path (overrides discovery) |
| `COVEN_HOME` | Coven home directory containing `coven.sock` |
| `SCRY_ALLOWED_ROOTS` | Colon-separated absolute project roots allowed for write tools; unset/empty = read-only mode |
| `SCRY_INCLUDE_MEMORY_EXCERPTS` | Exactly `true` to forward bounded memory excerpts; anything else disables |

Socket discovery order: `COVEN_SOCKET` (literal path) → `$COVEN_HOME/coven.sock` → `~/.coven/coven.sock`.

`SCRY_ALLOWED_ROOTS` entries must be absolute, existing directories. If **any** entry is invalid, `scry` exits at startup with a message naming the entry's position (never its value) — a misconfigured allowlist is never partially honored. Roots are canonicalized (symlinks resolved) before use, and containment is checked per path component, so `/work/app2` is never authorized by an allowlist entry of `/work/app`.

Boolean `SCRY_*` variables recognize only the exact literal `true`. `1`, `TRUE`, and `yes` are all treated as disabled.

## Tool reference

Nine tools. **[W]** marks write tools, which require allowlist approval; everything else is read-only and available without one. Inputs and outputs are camelCase even where the daemon replies in snake_case.

| Tool | Authority | Input | Returns |
| --- | --- | --- | --- |
| `coven_health` | read | — | `{ reachable, ok, apiVersion?, covenVersion?, capabilities?, error? }` |
| `coven_list_harnesses` | read | — | `{ harnesses, covenSkills, scannedAt }` |
| `coven_list_sessions` | read | `{ limit?, cursor?, includeArchived? }` | `{ sessions, nextCursor, hasMore }` |
| `coven_get_session` | read | `{ sessionId }` | `{ session }` |
| `coven_read_output` | read | `{ sessionId, afterSeq?, resumeToken?, timeoutMs?, maxBytes? }` | `{ text, lastSeq, resumeToken, complete, truncated, stopReason, diagnostics }` |
| `coven_list_memory` | read | — | `{ entries }` |
| `coven_start_session` | **[W]** | `{ projectRoot, cwd?, harness, prompt, model?, title? }` | `{ session }` |
| `coven_send_input` | **[W]** | `{ sessionId, data }` | `{ ok, accepted }` |
| `coven_kill_session` | **[W]** destructive | `{ sessionId }` | `{ ok, accepted }` |

### Input bounds

Violations return `INVALID_INPUT` naming the field, before any daemon call.

| Field | Constraint |
| --- | --- |
| `sessionId` | 1–256 bytes, `[A-Za-z0-9._:-]` |
| `harness` | 1–128 bytes, `[A-Za-z0-9._-]` |
| `projectRoot`, `cwd` | absolute path, 1–4096 bytes |
| `prompt`, `data` | 1 byte – 1 MiB |
| `model` / `title` | 1–256 / 0–512 bytes |
| `limit` | 1–1000 (default 100) |
| `cursor` | opaque, ≤4 KiB |
| `timeoutMs` | 0–120000 (default 30000) |
| `maxBytes` | 64 KiB – 1 MiB (default 1 MiB) |
| `afterSeq` | non-negative integer; mutually exclusive with `resumeToken` |

### Notes on individual tools

**`coven_health`** never fails. An unreachable daemon is reported as `{ reachable: false, ok: false, error }` rather than a tool error, so it stays useful as a diagnostic when everything else is failing.

**`coven_list_sessions`** normalizes both upstream shapes — the bare array and the paginated envelope — into one stable result, deriving `hasMore` from `nextCursor`.

**`coven_read_output`** polls the event stream and returns sanitized text. It always stops for exactly one reason, and the tuple is predictable:

| `stopReason` | `complete` | `truncated` | `resumeToken` |
| --- | --- | --- | --- |
| `complete` | `true` | `false` | `null` |
| `timeout` | `false` | `false` | non-null |
| `maxBytes` | `false` | `true` | non-null |
| `pageLimit` | `false` | `true` | non-null |

Pass the returned `resumeToken` back to continue exactly where the previous call stopped — including mid-line and mid-escape-sequence state. `diagnostics` reports skipped malformed payloads and unrecognized event kinds without failing the call. Tokens are per-process; see [Troubleshooting](#troubleshooting) for recovery after a restart.

**`coven_send_input`** forwards `data` to the PTY **verbatim** — no newline is appended. Include a trailing `\n` when you mean to submit a line.

**`coven_list_memory`** is a file *lister*, not search and not a content read. It has no filters (the daemon route accepts none). Excerpts are blank unless explicitly enabled, and privacy-flagged entries stay redacted even then.

### Error codes

Failures return `isError: true` with a JSON body `{ code, message, retryable, details? }`. Branch on `code`, never on message text.

| Code | Retryable | Meaning |
| --- | --- | --- |
| `DAEMON_UNAVAILABLE` | yes | Socket unreachable, or the request timed out |
| `CAPABILITY_UNAVAILABLE` | yes | The daemon does not advertise a required capability |
| `UPSTREAM_ERROR` | 5xx/429 only | Any other daemon error; carries the upstream code in `details` |
| `INCOMPATIBLE_DAEMON` | no | API version is not `coven.daemon.v1` |
| `SESSION_NOT_FOUND` | no | No session with that id |
| `SESSION_NOT_LIVE` | no | The session exists but is not running |
| `ROOT_NOT_ALLOWED` | no | Denied by `SCRY_ALLOWED_ROOTS` |
| `INVALID_INPUT` | no | Input failed validation |
| `INVALID_RESUME_TOKEN` | no | Token is malformed, expired with the process, or bound to another session |
| `OUTPUT_STATE_TOO_LARGE` | no | Output state exceeds the text/state bounds; `details` carries a usable token |
| `INTERNAL_ERROR` | no | Unexpected failure or cancellation |

## Coven API compatibility and pinned SHA

Built and tested against `OpenCoven/coven` commit `1fe9a744356ea3af6b47a3d497a483513b36eb15` (CLI `0.0.34`), API `coven.daemon.v1`.

`scry` gates every non-health call on a live handshake: `ok === true`, `apiVersion === "coven.daemon.v1"`, and the specific capability the operation needs (`sessions` or `events`) advertised as exactly `true`. String-valued capabilities such as `eventCursor: "sequence"` are treated as diagnostic, never as permission. The legacy `/api/v1/api-version` route is deliberately unused — upstream documents it as not proof of support.

Four upstream behaviors are load-bearing and were verified live rather than assumed:

- Requests are camelCase; session records reply in snake_case — but the **events** envelope is camelCase (`events`, `nextCursor`, `hasMore`) while its event objects stay snake_case (`payload_json`).
- `payload_json` is a JSON **string** requiring a second parse.
- Event kinds are `output`, `input`, `status`, `exit`, and an undocumented `kill`. Unknown kinds are counted and skipped, never fatal.
- `GET /api/v1/memory` returns a bare array.

Upstream ships roughly ten commits a day at version `0.0.0`, so treat the pinned SHA as the contract and revalidate before trusting a newer build.

## Security and privacy

**Trust model.** The Coven daemon has no authentication: trust is same-user access to a local Unix socket. `scry` therefore inherits your full same-user authority, and anything it exposes to an LLM can, in principle, drive PTY processes on your machine. `scry`'s job is to narrow that authority before an LLM touches it.

**Write authorization.** The three write tools (`coven_start_session`, `coven_send_input`, `coven_kill_session`) are gated by `SCRY_ALLOWED_ROOTS`. Unset or empty means read-only mode — deny by default. `coven_start_session` canonicalizes the requested `projectRoot` and `cwd` (resolving symlinks) and requires both to land inside an allowed root, with `cwd` inside `projectRoot`. `coven_send_input` and `coven_kill_session` never trust a caller-supplied root: they fetch the daemon's own session record and authorize its canonical `project_root`. Missing paths, symlink escapes, `..` traversal, dead directories, and lookup failures all fail closed.

**The allowlist is authorization, not a sandbox.** A harness started inside an allowed root still runs with your full OS authority — it can read your home directory, use your credentials, and make network calls. The allowlist controls where sessions may be *started and driven from this MCP surface*; it does not confine what a running harness can do.

**Disclosure surface (read tools).** Read tools work without an allowlist and can disclose to the connected MCP client: session titles and absolute project paths, sanitized session output, harness manifest paths (which may be absolute), and memory titles/relative paths. Memory *excerpts* are blank unless you set `SCRY_INCLUDE_MEMORY_EXCERPTS=true`, and entries flagged `revealRequired` or classified anything other than `public` stay redacted even then.

**Prompt injection.** Session output, titles, and memory excerpts are untrusted content that may contain instructions aimed at the LLM reading them. `scry` sanitizes encoding (ANSI escapes, carriage returns, control characters) — it cannot sanitize meaning. Tool results are data, not instructions; `scry` never embeds returned content in its own tool descriptions or error messages.

**Resume tokens.** `coven_read_output` continuation tokens are HMAC-signed with a random per-process secret, bound to their session id, and size-capped. They are integrity-protected but **not encrypted** — the payload includes un-emitted output state — so treat tokens as session output: never log or share them. They intentionally die when the server restarts (see Troubleshooting for recovery).

**Logging.** `scry` never logs prompts, input data, session output, memory excerpts, environment values, resume tokens, or raw daemon bodies. Stdout carries only MCP JSON-RPC; stderr carries metadata-only diagnostics (a startup misconfiguration message names an allowlist entry's *position*, never its value).

**Residual risk.** Anyone with same-user access to your machine can talk to the daemon directly, bypassing `scry` entirely. `scry` narrows what the *connected LLM* can do; it does not harden the daemon itself.

## Verification and tests

```sh
npm ci
npm run verify
```

`npm run verify` needs **no Coven credentials, no running daemon, and no network** — it completes in seconds from a clean clone and runs:

| Stage | What it proves |
| --- | --- |
| `typecheck` | Strict TypeScript, no emit errors |
| `lint` | Biome lint and format across `src`, `test`, `scripts` |
| `test` | 137 unit and contract tests |
| `build` | Production build produces a runnable entry point |
| stdio smoke | Raw JSON-RPC `initialize` → `tools/list` → `coven_health` against the built binary; asserts stdout carries only JSON-RPC, that discovery is stable with the daemon down, and that a misconfigured allowlist exits non-zero |
| package check | Tarball contains only `dist/`, README, LICENSE, `package.json`; shebang, `bin`, and `engines` wired |
| docs check | All 15 required README sections present and non-empty; HACKATHON.md carries the pinned SHA and tag |

Contract tests run against a **real HTTP server bound to a temporary Unix socket** — `node:http` internals are never mocked. They cover the acceptance matrix: array/envelope pagination, malformed payloads, cursor regression, split ANSI/CR state across resume tokens, oversized events, size limits, symlink and prefix escapes, cross-root session writes, structured error mappings, and stdout purity.

What `verify` does **not** prove: provider authentication and a real harness launch. Those need the live path below.

Run a single file with `npm test -- src/sanitizer.test.ts`.

## Live demo workflow

With `coven daemon start` running, an authenticated harness, and an existing project directory, this is the full round trip — the same sequence the demo recording follows:

1. **Read, no allowlist.** With `scry` configured without `SCRY_ALLOWED_ROOTS`, ask the client to call `coven_health`, then `coven_list_harnesses` and `coven_list_sessions`. You get live daemon state in read-only mode.
2. **Security gate.** Ask it to start a session in a directory you have not allowlisted. It is denied with `ROOT_NOT_ALLOWED`, naming the variable and the operation — no session is created and the daemon is never called.
3. **Grant one root.** Set `SCRY_ALLOWED_ROOTS=/path/to/your/project` in the client config and reconnect the server.
4. **Write path.** `coven_start_session` with that `projectRoot`, a harness id (`claude`, `codex`, …), and a prompt. You get back a full session record.
5. **Drive and observe.** `coven_send_input` (remember the trailing newline), then `coven_read_output` — ANSI-free, bounded text with a `complete`/`timeout` tuple.
6. **Clean up.** `coven_kill_session`, then `coven_get_session` to confirm the status is terminal.

Every step above has been executed against a live `coven 0.0.34` daemon during development.

TODO: Block 9 — public demo recording link.

## Limitations / non-goals

Deliberately out of scope for v1, with the reason:

- **No token-level streaming.** No push transport exists on the daemon socket — `coven-relay` accepts the WebSocket upgrade and immediately closes. `coven_read_output` polls instead, with resumable bounded reads.
- **No Windows support.** Named-pipe transport is undocumented upstream; supporting it would mean source-diving rather than building to a contract.
- **No semantic memory search.** `coven-memory` is a separate binary that is not reachable over the socket, and clients are explicitly forbidden from opening its database directly.
- **No hub, scheduler, or travel routes.**
- **No `POST /actions`.** Exactly one action id exists today.
- **No claims.** `coven claim` is CLI-only; there is no API route, so `scry` does not pretend to offer one.
- **Tools only.** No MCP resources or prompts in v1.

Natural next steps, in rough order of value: streaming via the CLI's `--stream-json` protocol, MCP resources for session transcripts, then Windows named pipes.

## Troubleshooting

**`DAEMON_UNAVAILABLE`** — the daemon socket is absent or unreachable. Start it with `coven daemon start`, then retry; `scry` recovers without a restart (health is re-checked on every call, cached for at most 1.5 s).

**`INCOMPATIBLE_DAEMON`** — the daemon speaks something other than `coven.daemon.v1`. Check `coven --version` against the pinned compatibility section above.

**`INVALID_RESUME_TOKEN` after an MCP client restart** — resume tokens are signed with a per-process secret and die when `scry` restarts (MCP clients restart stdio servers on config changes and relaunches). Recovery: call `coven_read_output` again with `afterSeq` set to the last `lastSeq` you observed — every result includes `lastSeq`. You lose only the un-emitted partial-line state, never full lines already returned.

**`ROOT_NOT_ALLOWED`** — the operation's project root is not inside `SCRY_ALLOWED_ROOTS` (or the allowlist is unset, which means read-only mode). Set the variable to a colon-separated list of absolute project directories and reconnect the MCP server.

**`scry` exits immediately at startup** — an `SCRY_ALLOWED_ROOTS` entry is invalid (relative, missing, or not a directory). The stderr message names the entry position; fix that entry and restart.

**Tools list but every call fails** — expected when the daemon is down; discovery is intentionally stable. Check `coven_health` first: it reports the underlying reason instead of erroring.

**The client shows no tools at all** — `scry` never started. Verify the `args` path points at a built `dist/index.js` (run `npm run build`), that the Node on `PATH` is 22+, and check the client's MCP logs for the `scry:` stderr line.

**Allowlist changes seem ignored** — the allowlist is read once at startup. Reconnect or restart the MCP server after changing `env`.

**A session starts but produces no output** — confirm the harness is authenticated (`coven doctor`). Harness discovery does not imply provider auth, and an unauthenticated harness can exit immediately.

## Hackathon disclosure and upstream use

Built solo for the OpenCoven Beta Hackathon 2026, greenfield during the event, under an unmodified MIT license. `scry` integrates with Coven at runtime over its documented socket API; no upstream code is vendored or modified.

See [HACKATHON.md](HACKATHON.md) for pinned SHAs, the freeze tag, and submission details.

## License

MIT — see [LICENSE](LICENSE).
