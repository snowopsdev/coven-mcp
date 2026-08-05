# Repository Guidelines

## Project Structure & Module Organization

- `PLAN.md` defines scope, sequencing, budget, security decisions, and release gates.
- `PRD.md` is the implementation contract: tool schemas, API behavior, limits, errors, and acceptance criteria.
- TypeScript runtime code lives under `src/`, with unit and contract tests colocated as `*.test.ts`. Fake-daemon helpers live under `test/`.
- Release, demo, package, and documentation checks live under `scripts/`. The committed architecture reference is under `docs/`.
- Keep generated output in `dist/`; never commit it unless release rules explicitly require it.

## Package Manager & Commands

- Use **npm** with Node 22 and commit `package-lock.json` when the package is initialized.

| Task | Command |
| --- | --- |
| Install | `npm ci` |
| Build | `npm run build` |
| Focused test | `npm test -- path/to/file.test.ts` |
| Full verification | `npm run verify` |
| Package smoke test | `npm pack --dry-run` |
| Documentation contract | `node scripts/check-docs.mjs` |

- Keep `npm run verify` aligned with PRD §7–8. It is the authoritative local gate and includes typecheck, lint, tests, build, stdio smoke, package validation, and documentation validation.

## Coding Style & Naming Conventions

- Use TypeScript, ESM, strict type checking, two-space indentation, and formatter/linter defaults committed with the implementation.
- Use `camelCase` for MCP schemas, `PascalCase` for types, `UPPER_SNAKE_CASE` for error codes, and kebab-case filenames.
- Normalize daemon `snake_case` responses only in the boundary module. Keep stdout exclusively for MCP JSON-RPC; send metadata-only diagnostics to stderr.

## Testing Guidelines

- Use a real HTTP server bound to a temporary Unix socket for daemon contract tests; do not mock `node:http` internals.
- Cover the acceptance matrix in PRD §8, especially pagination, signed resume tokens, ANSI/CR boundaries, size limits, allowlist escapes, structured errors, and stdout purity.
- No numeric coverage target is defined. Every bug fix requires a focused regression.

## Security & Configuration

- Never log prompts, input, session output, memory excerpts, environment values, or resume tokens.
- Treat `COVEN_MCP_ALLOWED_ROOTS` as authorization, not sandboxing. Memory excerpts remain disabled unless `COVEN_MCP_INCLUDE_MEMORY_EXCERPTS=true` and privacy flags permit disclosure.

## Commits & Pull Requests

- Use imperative subjects, DCO sign-off (`git commit -s`), and one logical change per commit.
- AI-authored commits include `Co-Authored-By: <agent name> <agent email>`.
- PRs include scope, linked issue, validation commands/results, security impact, and documentation changes. Add screenshots or demo evidence only for user-visible behavior.
