# Hackathon Declaration

## Event

OpenCoven Beta Hackathon 2026 — The Beta Summoning

## Project

- Project name: `coven-mcp`
- Repository: <https://github.com/snowopsdev/coven-mcp>
- Final tag: `august-hackathon-2026-final`
- Final commit SHA: the commit resolved by the immutable final tag; its full 40-character value is recorded in the submission issue
- Demo: `npm run demo` — deterministic local demo requiring no Coven install, credentials, network, or provider spend
- Submission timestamp: the authoritative GitHub submission-issue creation timestamp, filed before August 8, 2026 at 12:00 AM EDT

## Team

Employer name (optional):

| Name | GitHub | Discord | Role |
|---|---|---|---|
| AJ | [@snowopsdev](https://github.com/snowopsdev) | `@snowopsdev` | Solo entrant; design, implementation, testing, and documentation |

## Summary

Developers using an MCP client cannot otherwise see or drive Coven's local daemon sessions without switching to a terminal. `coven-mcp` exposes the daemon's session lifecycle, readable event output, harness capabilities, and memory listing as nine stdio MCP tools. It denies writes by default, authorizes mutations against canonical project roots, and converts raw PTY output into bounded, resumable text.

## Greenfield declaration

- [x] Project-specific implementation began at or after August 2, 2026, 11:30 PM EDT.
- [x] No prior prototype or substantially similar project was reused.
- [x] Any pre-existing general-purpose dependencies, assets, templates, or data are disclosed below.
- [x] All team members are listed.

First project implementation commit:

- Commit: `dda0a5da9cc6ac063e4ac7144bb7d5a9bdbfaa69`
- Timestamp: August 3, 2026 at 3:30:24 PM EDT
- Description: initialized the repository scaffolding; project-specific implementation followed entirely within the build window

## OpenCoven use

Mode:

- [ ] Development workflow
- [x] Runtime integration
- [ ] Both

Describe exactly how OpenCoven was used:

`coven-mcp` integrates at runtime with the Coven daemon over its documented `coven.daemon.v1` HTTP-over-Unix-socket API. No OpenCoven code is vendored or modified. Every non-health tool performs a live health/version/capability handshake, then calls the daemon routes required for harness discovery, session lifecycle, event reads, or memory listing. The implementation was built and live-verified against `OpenCoven/coven` commit `1fe9a744356ea3af6b47a3d497a483513b36eb15` (CLI `0.0.34`).

Evidence:

- commands or surfaces: `npm run demo` prints the actual daemon request log for health, harness, session, input, kill, and event routes
- session references: live session `a6f8704d-0a2f-4eee-ac76-dc929b9944dd` was started, driven, read, killed, and confirmed terminal through this server
- sanitized screenshots or logs: `docs/architecture-preview.png` and the deterministic ANSI/CR-heavy output shown by `npm run demo`
- architecture or integration code: `src/daemon-client.ts`, `src/health-gate.ts`, `src/normalize.ts`, `src/read-output.ts`, and `docs/architecture.html`
- reproducibility instructions: `npm ci && npm run verify` runs 155 unit and contract tests plus typecheck, lint, build, stdio, package, and documentation gates; `npm run demo` exercises the real built MCP server against a scripted Unix-socket daemon

## Reused and third-party material

| Item | Source | License | How used |
|---|---|---|---|
| `@modelcontextprotocol/sdk` 1.30.0 | <https://github.com/modelcontextprotocol/typescript-sdk> | MIT | MCP protocol types, server, and stdio transport |
| `zod` 4.4.3 | <https://github.com/colinhacks/zod> | MIT | Runtime tool-input schemas |
| TypeScript 7.0.2 | <https://github.com/microsoft/TypeScript> | Apache-2.0 | Development compiler and strict type checking |
| Vitest 4.1.10 | <https://github.com/vitest-dev/vitest> | MIT | Development test runner |
| Biome 2.5.7 | <https://github.com/biomejs/biome> | MIT OR Apache-2.0 | Development linting and formatting |

No third-party source code, data, screenshots, or other assets are vendored. The architecture reference and preview are original project artifacts.

## AI assistance

Codex and Claude Fable 5 assisted with implementation, tests, review, and documentation. AI-authored commits carry `Co-Authored-By` trailers. Generated changes were reviewed through repository diffs, focused regression tests, the full `npm run verify` gate, live daemon checks where applicable, package inspection, and the scripted freeze preflight.

## Required project paths

- Installation instructions: `README.md` § Installation
- Run instructions: `README.md` § Run
- Tests or verification: `README.md` § Test or verify; `npm run verify`
- Architecture: `README.md` § Architecture; `docs/architecture.html`; `docs/architecture.json`
- Security and privacy notes: `README.md` § Security and privacy
- Known limitations: `README.md` § Known limitations

## Bonus claims

### New OpenCoven capability

- Claimed points: 0
- Capability: none claimed
- Evidence: not applicable
- Why it did not previously exist: not applicable
- How to demonstrate it: not applicable

### Planned upstream adoption

- Claimed points: 0
- Target repository: none
- Maintainer evidence URL: not applicable
- Exact adoption statement or status: none claimed

### Merged reproducible-bug PRs

| Repository | Issue | PR | Merge commit | Claimed band | Summary |
|---|---|---|---|---:|---|
| None | Not applicable | Not applicable | Not applicable | 0 | No merged bug PR bonus claimed |

## License declaration

- [x] The root project license is the standard MIT License.
- [x] Only the year and copyright holder were populated.
- [x] No restriction, rider, exception, or conflicting dual-license condition was added.
- [x] Third-party notices are preserved.

## Safety declaration

- [x] No live secret, token, private key, or private credential is committed.
- [x] No unauthorized personal data or private OpenCoven session content is published.
- [x] The project does not contain malicious functionality.
- [x] No security vulnerability requiring a private report was discovered; any future vulnerability will be reported privately.
- [x] Provider usage follows applicable terms.

## Final affirmation

By submitting, the team confirms that the information above is accurate and that the entry complies with the Official Rules.

Team representative: AJ (`@snowopsdev`)

Date: August 7, 2026
