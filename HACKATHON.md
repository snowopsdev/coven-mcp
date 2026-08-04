# Hackathon Submission — `coven-mcp`

**Event:** OpenCoven Beta Hackathon 2026 (build window Aug 2 23:30 EDT – Aug 8 00:00 EDT)

> Two placeholders below are filled at freeze time (see `PLAN.md` §8). The freeze preflight runs `COVEN_MCP_RELEASE_CHECK=true npm run verify`, which fails while either remains, so this file cannot be left half-complete.

| | |
| --- | --- |
| Project | `coven-mcp` — MCP server bridging the Coven daemon to stdio MCP clients |
| One-sentence summary | Exposes Coven sessions, output, harness capabilities, and memory listing as MCP tools so any stdio-capable MCP client can see and drive Coven without leaving the client |
| Team | snow (solo) |
| Repo URL | <https://github.com/snowopsdev/coven-mcp> (**must be public before submitting**) |
| Freeze tag | `july-hackathon-2026-final` |
| Final commit SHA | TODO at freeze |
| Demo | `npm run demo` — a deterministic local command, which the submission guide accepts as a demo artifact. Requires no Coven install, credentials, network, or provider spend. See README § Demo. |
| License | MIT, unmodified — greenfield, no prior work reused |

**Naming note for reviewers:** the tag is *July*-named while the event runs in August and the submission repository is `opencoven-beta-august-hackathon-2026`. This is intentional and matches the rules verbatim — both the [submission guide](https://hackathon.opencoven.ai/docs/submission-guide.html) and the [official rules](https://hackathon.opencoven.ai/docs/official-rules.html) specify `july-hackathon-2026-final`, and the rules give the full `git tag -a` command using it.

## How to evaluate this in five minutes

No Coven install, credentials, network access, or running daemon required:

```sh
git clone https://github.com/snowopsdev/coven-mcp.git && cd coven-mcp
npm ci
npm run verify
```

That runs typecheck, lint, 137 unit and contract tests, a production build, a raw JSON-RPC stdio smoke test, a package-content check, and a documentation check — roughly four seconds end to end. Contract tests exercise the real protocol against a fake daemon bound to a temporary Unix socket, so the same code paths a live daemon would hit are covered.

With a Coven daemon available, `README.md` § *Run* has a copy-pasteable JSON-RPC pipeline that talks to the real daemon without any MCP client, and § *Demo* has the full six-step live workflow.

## What it does

`coven-mcp` is a standalone stdio MCP server exposing nine tools over the Coven daemon's `coven.daemon.v1` HTTP-over-Unix-socket API:

| Tool | Authority |
| --- | --- |
| `coven_health`, `coven_list_harnesses`, `coven_list_sessions`, `coven_get_session`, `coven_read_output`, `coven_list_memory` | read-only |
| `coven_start_session`, `coven_send_input`, `coven_kill_session` | write, allowlist-gated |

The two components that carry the most engineering weight:

- **`coven_read_output`** turns raw PTY event data — ANSI escapes, carriage-return rewrites, lines split across events, JSON-string payloads — into plain readable text, with HMAC-signed opaque tokens that resume losslessly across calls, including mid-escape-sequence state. All reads are bounded in bytes, pages, events, and wall-clock, and every stop maps to exactly one documented tuple.
- **The authority boundary.** The daemon has no authentication, so an unguarded bridge would hand an LLM the ability to spawn PTY processes anywhere. `coven-mcp` denies writes by default and authorizes them against the daemon's own session records rather than caller-supplied paths.

## OpenCoven use

`coven-mcp` integrates with Coven at **runtime** over its documented socket API. No Coven code is vendored, copied, or modified.

Pinned upstream baselines (verified Aug 3–4, 2026):

| Repository | Commit | Role |
| --- | --- | --- |
| `OpenCoven/coven` | `1fe9a744356ea3af6b47a3d497a483513b36eb15` (CLI `0.0.34`) | The API `coven-mcp` bridges |
| `OpenCoven/coven-reach` | `07f5c9d5e4863c1a9a187a070e413d51110ad610` | Novelty comparison (different tool domain) |
| `OpenCoven/coven-codeflow` | `5fd9df1e5133c72a1373ff01f7b6416dfe30534b` | Novelty comparison (MCP client, not server) |

`coven-reach` is an MCP server for filesystem and web operations; `coven-codeflow` is an MCP *client*. Neither exposes the daemon itself, which is the gap this fills.

### Upstream behaviors discovered while building

Verified against the live daemon rather than assumed from docs. Each is documented in the README and encoded in contract tests:

- The **events envelope is camelCase** (`events`, `nextCursor`, `hasMore`) while session records and event objects are snake_case — the casing convention is not uniform across the API.
- A fifth, undocumented event kind, **`kill`**, appears alongside `output`/`input`/`status`/`exit`.
- `GET /api/v1/sessions` returns a bare array without pagination parameters and an envelope with them; `GET /api/v1/memory` returns a bare array.
- Health advertises **string-valued capabilities** (`eventCursor: "sequence"`), so a truthiness check would wrongly grant permission — `coven-mcp` requires exactly `true`.
- The daemon reports **`covenVersion: "0.0.0"`** on a 0.0.34 install, so version gating must use `apiVersion` and capabilities instead.

These are candidate upstream documentation contributions (four `docs/daemon/` pages are currently one-line stubs); none is claimed as a bonus unless a PR is merged before scores lock.

## Validation

From a clean clone, with no credentials, no daemon, and no network:

```sh
npm ci
npm run verify
```

| Stage | What it proves |
| --- | --- |
| typecheck | Strict TypeScript, no emit errors |
| lint | Biome lint and format across `src`, `test`, `scripts` |
| test | 137 unit and contract tests |
| build | Production build produces a runnable entry point |
| stdio smoke | Raw JSON-RPC against the built binary; stdout purity, stable discovery with the daemon down, non-zero exit on a misconfigured allowlist |
| package check | Tarball contents, shebang, `bin`, and `engines` |
| docs check | Every section the submission guide requires, present, non-empty, and in the guide's order |

Contract tests bind a real HTTP server to a temporary Unix socket rather than mocking `node:http`, and cover the acceptance matrix: array/envelope pagination, malformed payloads, cursor regression, split ANSI/CR state across resume tokens, size and page limits, symlink and prefix escapes, cross-root session writes, structured error mappings, and stdout purity.

Verified separately against a live `coven 0.0.34` daemon: health and capability handshake, harness and session listing, the full `start → get → input → kill` round trip ending in a terminal status, out-of-root denial, ANSI-free output reads with resume, and an honest empty memory list.

The `coven_read_output` stack was additionally put through an adversarial multi-agent review; nine confirmed defects were fixed, the most serious being a state-growth bug that would have made carriage-return-heavy output (any progress bar) permanently unreadable. Each fix landed with a regression test.

## Security impact

The daemon's trust model is same-user socket access with no authentication. `coven-mcp` deliberately narrows what a connected LLM inherits:

- Write tools are **denied by default**; `COVEN_MCP_ALLOWED_ROOTS` is opt-in, and an invalid entry aborts startup rather than being silently dropped.
- `coven_send_input` and `coven_kill_session` authorize the **daemon's own record** for the session, never a caller-supplied root.
- Containment is path-component based after symlink resolution, so `..` traversal, symlink escapes, and sibling-prefix paths (`/work/app2` against `/work/app`) all fail closed.
- Memory excerpts are blanked unless explicitly enabled, and privacy-flagged entries stay redacted even then.
- Prompts, input, session output, memory excerpts, environment values, resume tokens, and raw daemon bodies are never logged. Stdout is exclusively MCP JSON-RPC.

The README documents the full threat model, including the explicit limits: the allowlist is an authorization gate rather than a process sandbox, tool results are untrusted content with respect to prompt injection, and anyone with same-user access can bypass `coven-mcp` by talking to the daemon directly.

## Bonus claims

None claimed. Opportunistic upstream documentation or bug PRs are tracked in `PLAN.md` §7 and will be listed here only if merged before scores lock, since a claim earns nothing merely by being submitted.

## Declarations

- **Greenfield:** all code in this repository was written during the event build window. Prior work was limited to `PLAN.md` and `PRD.md` — design notes containing no implementation.
- **License:** unmodified MIT, only year and holder populated, no added restrictions.
- **DCO:** every commit is signed off; AI-assisted commits carry `Co-Authored-By` trailers.
- **Scope honesty:** token streaming, Windows, semantic memory search, hub/scheduler/travel routes, `POST /actions`, and claims are all out of scope and documented as such with reasons in the README.

## Outstanding before freeze

Tracked in full in `PLAN.md` §8; run `node scripts/freeze-preflight.mjs` to check mechanically.

- Make the repository public — judges cannot clone a private repo, and the preflight fails while it is.
- Fill the commit SHA row above after cutting the tag.
- Optional: record a video walkthrough. Not required — `npm run demo` already satisfies the guide's demo artifact rule — but a video adds a second, lower-friction path for judges.
- Diff `LICENSE` and this file against `participant/LICENSE_TEMPLATE.txt` and `participant/HACKATHON_TEMPLATE.md` in the (private) event repository. Both are hand-written here and match the rules text, but neither has been compared against the actual templates.
