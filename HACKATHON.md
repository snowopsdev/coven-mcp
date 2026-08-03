# Hackathon Submission — `scry`

**Event:** OpenCoven Beta Hackathon 2026 (official brief pending re-verification — see PLAN.md §8)

| | |
|---|---|
| Project | `scry` — MCP server bridging the Coven daemon to stdio MCP clients |
| One-sentence summary | Exposes Coven sessions, output, harness capabilities, and memory listing as MCP tools so any stdio-capable MCP client can drive Coven |
| Team | snow (solo) |
| Repo URL | TODO before freeze |
| Freeze tag | `july-hackathon-2026-final` (provisional — confirm against official brief) |
| Final commit SHA | TODO at freeze |
| Demo link | TODO (Block 9) |
| License | MIT, greenfield — no prior work reused |

## OpenCoven use

`scry` integrates with the Coven daemon at runtime over its documented HTTP-over-Unix-socket API (`coven.daemon.v1`). No Coven code is vendored or modified.

Pinned upstream baselines (verified Aug 3, 2026):

| Repository | Commit |
|---|---|
| `OpenCoven/coven` | `1fe9a744356ea3af6b47a3d497a483513b36eb15` (`coven 0.0.34`) |
| `OpenCoven/coven-reach` | `07f5c9d5e4863c1a9a187a070e413d51110ad610` (novelty comparison) |
| `OpenCoven/coven-codeflow` | `5fd9df1e5133c72a1373ff01f7b6416dfe30534b` (novelty comparison) |

## Bonus claims

None counted toward the score threshold. Opportunistic upstream doc/bug PRs are tracked in PLAN.md §7 and listed here only if merged before scores lock.

## Declarations

- Greenfield: all code in this repository was written during the event.
- License: unmodified MIT (year and holder only).
- All commits are DCO signed-off; AI-assisted commits carry `Co-Authored-By` trailers.
