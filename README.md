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

TODO: complete semantics per PRD §6.4 in Block 6.

## Tool reference

TODO: Blocks 2–5 (all nine tools, inputs, outputs, authority levels).

## Coven API compatibility and pinned SHA

Built and tested against `OpenCoven/coven` commit `1fe9a744356ea3af6b47a3d497a483513b36eb15` (`coven 0.0.34`), API `coven.daemon.v1`.

TODO: revalidate before freeze.

## Security and privacy

TODO: Block 6 — full threat model (allowlist authorization boundary, disclosure surface, prompt-injection caveat, residual same-user authority).

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

TODO: Block 8 (daemon not running, incompatible version, resume-token recovery after server restart via `afterSeq` = last `lastSeq`).

## Hackathon disclosure and upstream use

Built solo for the OpenCoven Beta Hackathon 2026. See `HACKATHON.md` for pinned SHAs, disclosure, and submission details.

## License

MIT — see [LICENSE](LICENSE).
