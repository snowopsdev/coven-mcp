# scry

An MCP server that bridges the Coven daemon to any stdio-capable MCP client.

> Status: pre-implementation skeleton. Every section below is filled in during Block 8 (see `PLAN.md`); placeholders are marked TODO.

## Overview

`scry` exposes the Coven daemon's session lifecycle, event output, harness capabilities, and memory listing as MCP tools over stdio, so Claude Desktop, Cursor, or another stdio-capable MCP client can drive Coven without a bespoke integration.

TODO: expand after Block 2.

## Why `scry`

OpenCoven already ships MCP technology — `coven-reach` (a standalone stdio MCP server for filesystem/web operations) and `coven-codeflow` (an MCP client). Neither exposes the Coven daemon itself. `scry` fills exactly that gap and nothing else.

TODO: expand positioning after Block 2.

## Prerequisites and supported platforms

- Node 22+
- macOS or Linux (Windows is out of scope — see Limitations)
- A running Coven daemon (`coven daemon start`)

TODO: verify versions before freeze.

## Install and build

TODO: Block 7 (`npm ci && npm run build`).

## MCP client configuration

TODO: Block 2 (example `mcpServers` JSON for Claude Desktop / Cursor).

## Environment variables

| Variable | Purpose |
|---|---|
| `COVEN_SOCKET` | Explicit daemon socket path (overrides discovery) |
| `COVEN_HOME` | Coven home directory containing `coven.sock` |
| `SCRY_ALLOWED_ROOTS` | Colon-separated absolute project roots allowed for write tools; unset/empty = read-only mode |
| `SCRY_INCLUDE_MEMORY_EXCERPTS` | Exactly `true` to forward bounded memory excerpts; anything else disables |

Socket discovery order: `COVEN_SOCKET` (literal path) → `$COVEN_HOME/coven.sock` → `~/.coven/coven.sock`.

`SCRY_ALLOWED_ROOTS` entries must be absolute, existing directories. If **any** entry is invalid, `scry` exits at startup with a message naming the entry's position (never its value) — a misconfigured allowlist is never partially honored. Roots are canonicalized (symlinks resolved) before use, and containment is checked per path component, so `/work/app2` is never authorized by an allowlist entry of `/work/app`.

Boolean `SCRY_*` variables recognize only the exact literal `true`. `1`, `TRUE`, and `yes` are all treated as disabled.

## Tool reference

TODO: Blocks 2–5 (all nine tools, inputs, outputs, authority levels).

## Coven API compatibility and pinned SHA

Built and tested against `OpenCoven/coven` commit `1fe9a744356ea3af6b47a3d497a483513b36eb15` (`coven 0.0.34`), API `coven.daemon.v1`.

TODO: revalidate before freeze.

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

TODO: Block 7 (`npm run verify` — no Coven credentials required).

## Live demo workflow

TODO: Block 9 (demo link + reproduction steps).

## Limitations / non-goals

- No token-level streaming (no push transport exists on the daemon socket)
- No Windows support (named-pipe transport is undocumented)
- No semantic memory search (`coven-memory` is a separate binary)
- No hub/scheduler/travel routes, no `POST /actions`, no claims

TODO: finalize wording in Block 8.

## Troubleshooting

**`DAEMON_UNAVAILABLE`** — the daemon socket is absent or unreachable. Start it with `coven daemon start`, then retry; `scry` recovers without a restart (health is re-checked on every call, cached for at most 1.5 s).

**`INCOMPATIBLE_DAEMON`** — the daemon speaks something other than `coven.daemon.v1`. Check `coven --version` against the pinned compatibility section above.

**`INVALID_RESUME_TOKEN` after an MCP client restart** — resume tokens are signed with a per-process secret and die when `scry` restarts (MCP clients restart stdio servers on config changes and relaunches). Recovery: call `coven_read_output` again with `afterSeq` set to the last `lastSeq` you observed — every result includes `lastSeq`. You lose only the un-emitted partial-line state, never full lines already returned.

**`ROOT_NOT_ALLOWED`** — the operation's project root is not inside `SCRY_ALLOWED_ROOTS` (or the allowlist is unset, which means read-only mode). Set the variable to a colon-separated list of absolute project directories and reconnect the MCP server.

**`scry` exits immediately at startup** — an `SCRY_ALLOWED_ROOTS` entry is invalid (relative, missing, or not a directory). The stderr message names the entry position; fix that entry and restart.

TODO: Block 8 — client-specific configuration issues.

## Hackathon disclosure and upstream use

Built solo for the OpenCoven Beta Hackathon 2026. See `HACKATHON.md` for pinned SHAs, disclosure, and submission details.

## License

MIT — see [LICENSE](LICENSE).
