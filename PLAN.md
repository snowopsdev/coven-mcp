# Build Plan — OpenCoven Beta Hackathon 2026

**Entrant:** snow (solo)

**Provisional deadline:** Fri Aug 7, 23:59 EDT (tag must exist before Sat Aug 8 00:00 EDT)

**Freeze tag:** `august-hackathon-2026-final` — confirmed Aug 5 against both the submission guide and the official rules, and matching the event repository.

---

## 1. The project

**Working name:** `coven-mcp` — an MCP server that bridges the Coven daemon to any stdio-capable MCP client.

**One-liner:** Expose Coven harnesses, sessions, output, and memory listings as MCP tools, so Claude Desktop, Cursor, or another stdio-capable MCP client can drive Coven without a bespoke integration.

**Why it scores under the verified brief:**

- OpenCoven already has MCP implementations: `coven-reach` is a standalone stdio MCP server for filesystem/web operations, and `coven-codeflow` consumes MCP servers. The defensible novelty claim is narrower: no reviewed first-party server exposes the **Coven daemon's session lifecycle, event output, harness capabilities, and memory listing** as MCP tools.
- Aligned with stated direction (`coven-familiar-spec` lists an MCP server registry as intent) but not duplicating in-flight work (`coven-harness-capabilities` lists cross-harness MCP exposure as a current non-goal).
- Integrates at runtime, which speaks to two of the seven published judging criteria: "meaningful, well-evidenced use of OpenCoven" and "the coherence of the product experience and its fit with OpenCoven". The [rubric](https://hackathon.opencoven.ai/docs/scoring-rubric.html) publishes no per-criterion weights, so do not plan against invented point splits.

### Review baseline (refreshed Aug 7, 2026)

- **Blocks 0–9 are complete.** All nine v1 tools ship; `npm run verify` is green from a clean clone and reports the live test count instead of duplicating it here. The deterministic `npm run demo` command satisfies the guide's demo-artifact rule. Remaining: Block 10 (freeze) — see the status note in §4.
- Live handshake verified against local `coven 0.0.34`: `GET /api/v1/health` returned `ok: true`, `apiVersion: "coven.daemon.v1"`, and `sessions`/`events` capabilities enabled.
- API assumptions below were rechecked against `OpenCoven/coven` commit `1fe9a744356ea3af6b47a3d497a483513b36eb15`. Pin this SHA until the implementation passes against a newer reviewed commit.
- The narrower novelty comparison covered the public OpenCoven repositories visible on Aug 3 and pins `coven-reach` at `07f5c9d5e4863c1a9a187a070e413d51110ad610` and `coven-codeflow` at `5fd9df1e5133c72a1373ff01f7b6416dfe30534b`. The familiar and harness-capability specs are within the pinned `coven` commit.
- **The official brief and event repository are verified.** Deadline, freeze tag, submission URL, participant templates, and issue form were rechecked Aug 7. `LICENSE` matches the official template with only the permitted holder substitution, and `HACKATHON.md` now follows the official declaration template. The tag-name discrepancy recorded earlier was resolved upstream on Aug 5; every source prints the August tag.
- Refresh this baseline after each build block; it is a dated starting state, not a live status dashboard.

---

## 2. Architecture decisions (locked — do not revisit)

| Decision | Choice | Rationale |
| --- | --- | --- |
| Language | TypeScript / Node 22 | Fastest path at this budget. Rust is not worth the hours. |
| MCP transport | stdio | Simplest client config; no network surface. |
| Coven transport | `node:http` with `socketPath` | The daemon is **HTTP over a Unix socket**. No custom protocol needed. |
| Compatibility gate | Lazy health/capability check before every non-health tool (cached ≤1.5s, single-flight) | Tool discovery must work while the daemon is down, and starting/restarting the daemon must not require restarting the MCP client. |
| Streaming | **None.** Request/response only. | No SSE/WebSocket/long-poll exists on the socket. `coven-relay` is a stub. |
| Windows | **Out of scope.** Documented as such. | Named-pipe transport is undocumented; source-diving only. |
| Semantic memory | **Out of scope.** | `coven-memory` is a separate binary, not reachable over the socket. |

**Socket path:** `~/.coven/coven.sock` (`$COVEN_HOME/coven.sock`)
**Handshake:** `GET /api/v1/health` → assert `ok === true`, `apiVersion === "coven.daemon.v1"`, and the capability required by the requested operation is advertised (at minimum `sessions` for session tools and `events` for output; a capability counts only when its value is exactly `true`). Do **not** use `/api/v1/api-version` — docs explicitly say it is not proof of support.

### Known traps (pre-loaded, do not rediscover)

1. `STREAM-JSON.md` documents the **CLI stdout** protocol, not the daemon socket. Ignore it.
2. Requests are **camelCase** (`projectRoot`); `SessionRecord` responses are **snake_case** (`project_root`) — but the **events envelope is camelCase** (`events`, `nextCursor`, `hasMore`) while its event objects are snake_case (`payload_json`). Live-verified Aug 3.
3. `payload_json` on events is a **JSON string** — requires a second parse.
4. Event `output.data` is **raw PTY text** with ANSI escapes, CRs, and partial lines. Must strip and reassemble.
5. Event kinds are undocumented. From source: `output`, `input`, `status`, `exit` — plus `kill`, observed live on Aug 3 (treat as known and silent, not "unknown"). Exit payloads are camelCase: `{"exitCode":129,"status":"failed"}`.
6. The Unix-socket server rejects request bodies over 4 MiB. Preflight request size and independently cap response/output accumulation.
7. Branch on `error.code`, never `error.message`. ~35 stable codes documented.
8. `session_not_live` (409) and `session_not_found` (404) need distinct MCP error mappings.
9. Claims (`coven claim`) are **CLI-only** — no API route. Do not promise them.
10. `GET /api/v1/sessions` returns a bare array without pagination parameters, but an envelope when `limit` or `cursor` is present. Normalize both into one stable MCP result.
11. `POST /api/v1/sessions` returns the full `SessionRecord`, not `{ sessionId }`.
12. The canonical event route is `GET /api/v1/sessions/:id/events`; do not add an undocumented fallback policy around the global `/events?sessionId=` alias in v1.
13. `GET /api/v1/memory` currently has no documented `familiarId` or `limit` query parameters; the v1 tool must not advertise unsupported filters.
14. Only two daemon error codes get bespoke handling; the other ~33 must fall through to a structured `UPSTREAM_ERROR` (safe code + status, never the raw body) — do not let unmapped codes become transport errors.
15. MCP clients restart stdio servers casually (config edit, relaunch), which invalidates every signed resume token. Recovery is re-calling with `afterSeq` = last observed `lastSeq`; document it, don't rediscover it as a bug.

---

## 3. v1 tool surface (locked)

| Tool | Route | Notes |
| --- | --- | --- |
| `coven_health` | `GET /api/v1/health` | Report reachability, named version, and advertised capabilities |
| `coven_list_harnesses` | `GET /api/v1/capabilities/harnesses` | |
| `coven_list_sessions` | `GET /api/v1/sessions` | Accept `limit`, `cursor`, `includeArchived`; normalize array/envelope responses |
| `coven_get_session` | `GET /api/v1/sessions/:id` | |
| `coven_start_session` | `POST /api/v1/sessions` | **Allowlist-gated** on canonical `projectRoot`; returns a full session record |
| `coven_send_input` | `GET /api/v1/sessions/:id`, then `POST /api/v1/sessions/:id/input` | **Allowlist-gated** on the fetched session's canonical `project_root` |
| `coven_kill_session` | `GET /api/v1/sessions/:id`, then `POST /api/v1/sessions/:id/kill` | Same authorization rule as input |
| `coven_read_output` | `GET /api/v1/sessions/:id/events` | Bounded polling, fixed 100-event pages, streaming-safe ANSI removal, opaque resume token carrying optional cursor/parser state |
| `coven_list_memory` | `GET /api/v1/memory` | No input filters; file metadata by default, with bounded excerpts only under explicit safe opt-in — it is a lister, not search or full-content read |

**Explicitly cut from v1** (say so in README — honest scope reads as maturity):
token streaming, Windows, semantic memory search, hub/scheduler/travel routes, `POST /actions` (only one action id exists today).

---

## 4. Hour budget

Total ≈ 24.5h. Checkpoints are **abort gates**, not suggestions.

| # | Block | Hrs | Done when |
| --- | --- | --- | --- |
| 0 | Repo init: MIT LICENSE, README skeleton, HACKATHON.md, pin upstream commit SHA | 1.0 | `git log` shows signed-off initial commit |
| 1 | HTTP-over-socket client + lazy health/capability gate + timeouts/body limits + error mapping | 2.0 | Node client returns live named version and fails closed on missing capabilities |
| 2 | MCP server skeleton + 3 read-only tools (health, harnesses, sessions) | 3.0 | **CHECKPOINT A** |
| 3 | Session lifecycle tools (start, input, kill) + core allowlist gate + session-owner authorization lookup | 3.0 | Round-trip: start → input → kill; cross-root mutation denied |
| 4 | Event polling + signed resume token + streaming-safe ANSI/CR state + bounded accumulation | 4.0 | Readable, losslessly resumable output from a real session |
| 5 | Memory read tool | 1.0 | Validates the live empty/seeded list shape and excerpt-redaction policy |
| 6 | Security hardening: allowlist edge cases (symlinks, fail-fast misconfig) + threat model doc (core gate lands in Block 3) | 2.0 | Denied path returns clean MCP error; invalid allowlist entry aborts startup |
| 7 | Contract/security tests + build/package checks + `verify` script | 2.0 | `npm run verify` green from clean clone with fake Unix-socket daemon |
| 8 | README (14 required sections) + HACKATHON.md complete | 3.0 | Every section non-empty |
| 9 | Deterministic demo (≤5 min) | 2.0 | `npm run demo` proves the core path without credentials, network, or provider spend |
| 10 | Freeze + preflight + submission issue | 1.5 | Tag pushed, issue filed |

### Status (Aug 7, 2026)

Blocks 0–9 are complete. **Checkpoint A passed** at Block 2 — the descope ladder below was never needed and is retained only as a record of the decision.

Block 10 remains. The participant templates are reconciled and the repository is public. Run `node scripts/freeze-preflight.mjs`, create and push the final tag, capture its full commit SHA, and file the submission issue. An optional video is not required because `npm run demo` is the accepted artifact.

### CHECKPOINT A — end of Block 2 (~6h in)

**Test:** a real MCP client lists the three Checkpoint A tools even if the daemon starts later, then returns live health, harness, and session data once the daemon is running. The completed v1 applies the same stable-discovery rule to all nine tools.
**If not met → descope immediately** to the Familiar Contract validator (`SOUL.md` / `IDENTITY.md` / `ward.toml` / `MEMORY.md` linter + GitHub Action, ~10h). Do not push through. A bridge that half-connects scores below a linter that works.

### Descope ladder (apply in order if behind)

1. Cut memory tool (Block 5)
2. Cut event accumulation → return raw paginated events (halves Block 4)
3. Cut write tools → ship a **read-only observability bridge**. Still demos, still novel, still honest.

**Hard rule: Friday is freeze day, not build day.** Blocks 8–10 remain non-negotiable. Scoring is now confirmed: **100 core points, 60 required for prize eligibility, plus up to 25 bonus** — and bonus points cannot lift an ineligible entry over the threshold. Judges score seven unweighted criteria; earlier per-criterion point estimates in this plan were speculative and have been removed.

---

## 5. Security design (the differentiator)

The daemon has **no authentication** — trust is same-user local socket access. Your MCP server therefore inherits full same-user authority: anything exposed to an LLM can spawn PTY processes in arbitrary project roots.

Most entrants will ship this unguarded. Do not.

- **Project-root allowlist** via `COVEN_MCP_ALLOWED_ROOTS` env var. Deny by default; empty allowlist = read-only mode.
- **Memory excerpts opt-in** via `COVEN_MCP_INCLUDE_MEMORY_EXCERPTS=true`. Default responses blank excerpts; even when enabled, upstream `revealRequired`/classification flags can still force redaction.
- **Write tools gated**; read tools always available but explicitly described as potentially exposing session metadata/output, memory excerpts, and harness-manifest paths (including absolute local paths) to the connected MCP client.
- `coven_start_session` canonicalizes the requested root and optional `cwd`. `coven_send_input` and `coven_kill_session` first fetch the authoritative session record and authorize its canonical `project_root`; they never accept a caller-supplied root.
- Root containment is path-component based, not string-prefix based (`/work/app2` is not inside `/work/app`). Missing paths, failed canonicalization, symlink escapes, malformed session records, and lookup failures all deny the mutation.
- The allowlist is an MCP authorization gate, **not a process sandbox**. A harness launched inside an allowed root still runs with the user's broader same-user OS authority; document this residual risk.
- **Misconfiguration is loud, never partial.** Any invalid `COVEN_MCP_ALLOWED_ROOTS` entry (relative, missing, not a directory, canonicalization failure) aborts startup with a metadata-only stderr message; the server never drops the bad entry or silently degrades. Boolean `COVEN_MCP_*` env vars accept only the exact literal `true`.
- **Prompt injection is in the threat model.** Session output, titles, and memory excerpts are untrusted content that may carry instructions aimed at the consuming LLM. `coven-mcp` sanitizes encoding (ANSI/CR), not semantics — never embed returned content in tool descriptions or error messages, and say so in README.
- **Documented threat model** in README under "Security and privacy" (a required section anyway).
- Never log prompts or session content. MCP JSON-RPC is the only stdout content; diagnostics go to stderr and contain metadata only.
- No secrets in repo — verified in preflight.

~2 hours of work for the full 5-point security block plus differentiation.

---

## 6. Documentation contract (verified against the official guide)

The [official submission guide](https://hackathon.opencoven.ai/docs/submission-guide.html) (retrieved Aug 4, 2026) specifies the README structure. `npm run verify` enforces these exact `##` headings, in this order, under a `# Project Name` H1:

1. What it does
2. Problem
3. Why OpenCoven
4. How OpenCoven was used
5. Architecture
6. Prerequisites
7. Installation
8. Configuration
9. Run
10. Test or verify
11. Demo
12. Known limitations
13. Security and privacy
14. License

The guide presents these as a minimum, so extra sections are allowed; `coven-mcp` adds **Tool reference** and **Troubleshooting**. The checker verifies presence, non-emptiness, and the relative order of the required set, ignoring extras.

The guide also requires copying `participant/LICENSE_TEMPLATE.txt` to `LICENSE` and `participant/HACKATHON_TEMPLATE.md` to `HACKATHON.md`, completing every field. Both were retrieved from `OpenCoven/opencoven-beta-august-hackathon-2026` and reconciled on Aug 7. `LICENSE` matches the official text with only the permitted holder substitution; `HACKATHON.md` follows the official section and field structure with repository-backed evidence.

Required repository files, per the guide: `README.md`, `LICENSE`, `HACKATHON.md`, source, dependency manifests and lockfiles, and tests or verification instructions.

---

## 7. Track B — bonus (opportunistic only, never budgeted)

Bonus points require the PR to be **merged before scores lock** — outside your control. Never rely on them to clear 60.

- **Doc PRs are the natural byproduct.** Four `docs/daemon/` pages are one-line "Stub — fill in": `api-versioning`, `error-envelope`, `auth-posture`, `trust-boundary`. You will reverse-engineer this content anyway. Upstream it → *documented upstream adoption* bonus.
- **File your own bugs.** Zero `good first issue` / `help wanted` exist org-wide; `coven-cave` and `coven-runtimes` have zero open issues. Bugs must be discovered during the event, documented with env, commit, exact repro, expected vs actual, logs, frequency, impact.
- **`coven#559`** (`coven config paths --json`) is the cleanest merged-fix candidate. Claim it early via `coven claim acquire issue-559` — the claim protocol exists because duplicate PRs keep happening, and other entrants are heading for the same 31 issues.
- **All commits need DCO sign-off** (`git commit -s`). Non-negotiable upstream and in your own repo.

---

## 8. Freeze checklist (rules confirmed Aug 4, 2026)

**Confirmed against the [official rules](https://hackathon.opencoven.ai/docs/official-rules.html) and [submission guide](https://hackathon.opencoven.ai/docs/submission-guide.html):**

| Item | Confirmed value |
| --- | --- |
| Build window | Aug 2, 2026 23:30 EDT → Aug 8, 2026 00:00 EDT (120.5 h) |
| Deadline | Midnight **beginning** Sat Aug 8, `America/New_York`; must be submitted before the clock passes `12:00:00 AM EDT` |
| Freeze tag | `august-hackathon-2026-final` (re-confirmed Aug 5 in both documents) |
| Tag command | `git tag -a august-hackathon-2026-final -m "OpenCoven Beta Hackathon final submission"` — the rules give this exact command |
| Submission form | <https://github.com/OpenCoven/opencoven-beta-august-hackathon-2026/issues/new/choose> |
| Scoring | 100 core, **60 minimum** for prize eligibility, up to 25 bonus (bonus cannot make an entry eligible) |
| Demo | Five minutes or less; public video, live demo, terminal recording, or local command; must not require judges to purchase anything |
| License | Standard MIT, only year and holder populated; no added restrictions, field-of-use limits, noncommercial clauses, Commons Clause, or modified permission/warranty text |

Run `node scripts/freeze-preflight.mjs` first — it automates most of the list below and refuses to pass while placeholders remain.

```sh
node scripts/freeze-preflight.mjs
git status
git add -A
git commit -s -m "chore: freeze hackathon submission"
git push
git tag -a august-hackathon-2026-final -m "OpenCoven Beta Hackathon final submission"
git push origin august-hackathon-2026-final
git rev-list -n 1 august-hackathon-2026-final
```

Then, before filing the issue:

- [x] Retrieve the participant templates, confirm `LICENSE`, and reconcile `HACKATHON.md` to the official structure.
- [ ] Re-read the issue form and confirm the **tag string** it asks for still reads `august-hackathon-2026-final`
- [x] Make the repository **public** — judges must be able to clone it.
- [ ] Clone fresh from a clean location; verify tag checks out
- [ ] Run every README command from that clean clone
- [ ] Grep for secret patterns (keys, tokens, `.env`) — preflight covers this
- [ ] All lockfiles committed — preflight covers this
- [ ] No local absolute paths anywhere — preflight covers this
- [ ] Demo link publicly accessible in a logged-out browser
- [ ] Every required README section present, non-empty, and in the guide's order — preflight covers this
- [ ] HACKATHON.md complete, SHA recorded
- [ ] Tag points at the intended commit — preflight covers this

### Tag name — resolved

For a period the published guide and rules printed `july-hackathon-2026-final` (six occurrences, including a full `git tag -a` command) alongside a July-named submission repository that did not exist. The event repository and submission form said August. We shipped August on the entrant's confirmation, treating the form as authoritative over the published text.

**Upstream corrected the documents on Aug 5.** Both the [submission guide](https://hackathon.opencoven.ai/docs/submission-guide.html) and the [official rules](https://hackathon.opencoven.ai/docs/official-rules.html) now print `august-hackathon-2026-final` and the August repository URL. Every source now agrees, and no change to this repository was needed.

`scripts/freeze-preflight.mjs` still fails if a July-named tag appears locally. That guard is cheap and remains worth keeping: a cached page, a stale bookmark, or notes taken before Aug 5 could still reintroduce the wrong string, and the mistake is unrecoverable after the deadline.

### After the deadline

The guide is explicit, and violating this is worse than any missing feature:

- **Do not edit the submission after the deadline**, except to repair a broken link without changing the underlying artifact — and record any such correction transparently.
- Continuing development afterwards is allowed **on another branch**; it does not change the score. Do not push it to `main` or move the tag.
- The issue timestamp and the frozen Git reference together must show the full entry existed before the deadline, so file the issue *after* pushing the tag, not before.

**Submission issue:** [OpenCoven hackathon issue form](https://github.com/OpenCoven/opencoven-beta-august-hackathon-2026/issues/new/choose)
Required: project name, one-sentence summary, team members, repo URL, tag name, full commit SHA, demo link, OpenCoven-use summary, bonus claims, greenfield/MIT declaration.

---

## 9. Risks

| Risk | Mitigation |
| --- | --- |
| Upstream moves under you (`covenVersion` 0.0.0, ~10 commits/day) | Pin a commit SHA in README; test against it |
| Novelty claim overstates the ecosystem | Claim the daemon-lifecycle bridge specifically; acknowledge `coven-reach` and `coven-codeflow` |
| Hackathon brief/submission URL is inaccessible or changed | **Resolved Aug 7** — brief, event repository, templates, issue form, deadline, tag, and URL verified |
| Daemon not running / harness not authed | `coven doctor` first; document prerequisites |
| PTY output unparseable in practice | Descope ladder step 2 — return raw events |
| Unbounded event accumulation exhausts memory or exceeds an MCP client limit | Enforce `maxBytes`, return `truncated: true` plus a resume token |
| Session-id write tools bypass the root allowlist | Fetch the authoritative session before input/kill and fail closed on lookup/canonicalization errors |
| MCP client restarts `coven-mcp`, invalidating all resume tokens | Documented recovery: re-call with `afterSeq` = last observed `lastSeq`; README troubleshooting covers it |
| Time overrun | Checkpoint A abort gate; Friday is freeze-only |
| Bonus PRs not merged in time | Never counted toward the 60-point threshold |
