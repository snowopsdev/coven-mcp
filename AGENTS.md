# Repository Guidelines

## Project Structure & Module Organization

- `PLAN.md` defines scope, sequencing, budget, security decisions, and release gates.
- `PRD.md` is the implementation contract: tool schemas, API behavior, limits, errors, and acceptance criteria.
- The repository is design-only; no source, tests, or assets exist.
- Add TypeScript runtime code under `src/` and colocate small unit tests as `*.test.ts`. Put fake-daemon contract fixtures and end-to-end MCP tests under `test/`.
- Keep generated output in `dist/`; never commit it unless release rules explicitly require it.

## Package Manager & Commands

- Use **npm** with Node 22 and commit `package-lock.json` when the package is initialized.

| Task | Command |
|---|---|
| Install | `npm ci` |
| Build | `npm run build` |
| Focused test | `npm test -- path/to/file.test.ts` |
| Full verification | `npm run verify` |
| Package smoke test | `npm pack --dry-run` |
| Documentation lint | `npx markdownlint-cli --disable MD013 -- PLAN.md PRD.md AGENTS.md` |

- Build/test scripts do not exist yet. Add them with the first implementation and keep `npm run verify` aligned with PRD §7–8.

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
- Treat `SCRY_ALLOWED_ROOTS` as authorization, not sandboxing. Memory excerpts remain disabled unless `SCRY_INCLUDE_MEMORY_EXCERPTS=true` and privacy flags permit disclosure.

## Commits & Pull Requests

- This directory has no Git history yet. Use imperative subjects, DCO sign-off (`git commit -s`), and one logical change per commit.
- AI-authored commits include `Co-Authored-By: <agent name> <agent email>`.
- PRs include scope, linked issue, validation commands/results, security impact, and documentation changes. Add screenshots or demo evidence only for user-visible behavior.
