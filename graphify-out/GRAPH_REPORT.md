# Graph Report - .  (2026-08-05)

## Corpus Check
- Corpus is ~38,352 words - fits in a single context window. You may not need a graph.

## Summary
- 413 nodes · 621 edges · 17 communities
- Extraction: 94% EXTRACTED · 6% INFERRED · 0% AMBIGUOUS · INFERRED: 37 edges (avg confidence: 0.77)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- [[_COMMUNITY_MCP Tool Surface & Server|MCP Tool Surface & Server]]
- [[_COMMUNITY_Architecture & Project Docs|Architecture & Project Docs]]
- [[_COMMUNITY_Architecture JSON Metadata|Architecture JSON Metadata]]
- [[_COMMUNITY_Output Pipeline & Errors|Output Pipeline & Errors]]
- [[_COMMUNITY_Daemon Response Normalization|Daemon Response Normalization]]
- [[_COMMUNITY_Biome Lint Config|Biome Lint Config]]
- [[_COMMUNITY_Package Manifest|Package Manifest]]
- [[_COMMUNITY_Allowlist & Session Lifecycle|Allowlist & Session Lifecycle]]
- [[_COMMUNITY_Output Pipeline Spec|Output Pipeline Spec]]
- [[_COMMUNITY_Demo Script|Demo Script]]
- [[_COMMUNITY_Stdio Smoke Test|Stdio Smoke Test]]
- [[_COMMUNITY_TypeScript Config|TypeScript Config]]
- [[_COMMUNITY_Package Content Check|Package Content Check]]
- [[_COMMUNITY_Build TypeScript Config|Build TypeScript Config]]
- [[_COMMUNITY_Runtime Facts|Runtime Facts]]
- [[_COMMUNITY_Docs Section Check|Docs Section Check]]
- [[_COMMUNITY_Freeze Preflight|Freeze Preflight]]

## God Nodes (most connected - your core abstractions)
1. `createCovenMcpServer()` - 22 edges
2. `CovenMcpError` - 18 edges
3. `Build Plan` - 13 edges
4. `asRecord()` - 12 edges
5. `coven-mcp Submission` - 12 edges
6. `compilerOptions` - 10 edges
7. `runtime` - 9 edges
8. `verification` - 9 edges
9. `normalizeSessionRecord()` - 9 edges
10. `startFakeDaemon()` - 9 edges

## Surprising Connections (you probably didn't know these)
- `createCovenMcpServer()` --implements--> `coven_health`  [EXTRACTED]
  src/server.ts → README.md
- `createCovenMcpServer()` --implements--> `coven_list_memory`  [EXTRACTED]
  src/server.ts → README.md
- `Authority Boundary` --semantically_similar_to--> `Authority Boundary`  [INFERRED] [semantically similar]
  HACKATHON.md → PRD.md
- `Normalized Shapes` --semantically_similar_to--> `normalize.ts`  [INFERRED] [semantically similar]
  PRD.md → docs/architecture.html
- `COVEN_MCP_ALLOWED_ROOTS` --semantically_similar_to--> `allowlist.ts`  [INFERRED] [semantically similar]
  README.md → docs/architecture.html

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **coven-mcp v1 Tool Surface** — readme_coven_health, readme_coven_list_harnesses, readme_coven_list_sessions, readme_coven_get_session, readme_coven_read_output, readme_coven_list_memory, readme_coven_start_session, readme_coven_send_input, readme_coven_kill_session [EXTRACTED 1.00]
- **Allowlist Write Authorization Flow** — readme_coven_mcp_allowed_roots, readme_coven_start_session, readme_coven_send_input, readme_coven_kill_session, readme_trust_model [EXTRACTED 1.00]
- **Output Pipeline Modules** — docs_architecture_read_output, docs_architecture_sanitizer, docs_architecture_resume_token [EXTRACTED 1.00]

## Communities (17 total, 0 thin omitted)

### Community 0 - "MCP Tool Surface & Server"
Cohesion: 0.06
Nodes (47): coven_get_session, coven_kill_session, coven_list_harnesses, coven_list_sessions, COVEN_MCP_ALLOWED_ROOTS, coven_send_input, coven_start_session, covenRequest() (+39 more)

### Community 1 - "Architecture & Project Docs"
Cohesion: 0.07
Nodes (53): Repository Guidelines, allowlist.ts, Architecture Reference, daemon-client.ts, errors.ts, health-gate.ts, index.ts, normalize.ts (+45 more)

### Community 2 - "Architecture JSON Metadata"
Cohesion: 0.04
Nodes (46): configuration, dependencies, development, runtime, vendored, errorCodes, generated, license (+38 more)

### Community 3 - "Output Pipeline & Errors"
Cohesion: 0.09
Nodes (21): CovenMcpError, expectCovenMcpError(), contractError(), EventsPage, normalizeEventsPage(), RawEvent, readOutput(), ReadOutputDeps (+13 more)

### Community 4 - "Daemon Response Normalization"
Cohesion: 0.13
Nodes (31): AckResult, asRecord(), CapabilityWarning, CovenSkill, HarnessPlugin, HarnessSkill, HarnessSummary, isNumber() (+23 more)

### Community 5 - "Biome Lint Config"
Cohesion: 0.08
Nodes (25): useLiteralKeys, files, includes, formatter, enabled, indentStyle, indentWidth, lineWidth (+17 more)

### Community 6 - "Package Manifest"
Cohesion: 0.08
Nodes (25): bin, coven-mcp, dependencies, @modelcontextprotocol/sdk, zod, description, devDependencies, @biomejs/biome (+17 more)

### Community 7 - "Allowlist & Session Lifecycle"
Cohesion: 0.14
Nodes (12): AllowlistConfigError, authorizeProjectRoot(), canonicalDir(), deny(), isPathWithin(), parseAllowedRoots(), main(), connectClient() (+4 more)

### Community 8 - "Output Pipeline Spec"
Cohesion: 0.10
Nodes (20): outputPipeline, invariants, problem, resumeToken, sanitizer, stopTuples, afterSeq, pendingRawB64 (+12 more)

### Community 9 - "Demo Script"
Cohesion: 0.12
Nodes (14): ALLOWED, beat(), bold(), callTool(), daemon, dim(), dir, events (+6 more)

### Community 10 - "Stdio Smoke Test"
Cohesion: 0.17
Nodes (8): bad, body, child, expected, names, pending, responses, timeout

### Community 11 - "TypeScript Config"
Cohesion: 0.17
Nodes (11): compilerOptions, exactOptionalPropertyTypes, module, moduleResolution, noEmit, noUncheckedIndexedAccess, skipLibCheck, strict (+3 more)

### Community 12 - "Package Content Check"
Cohesion: 0.20
Nodes (9): allowed, entry, files, leaked, missing, packOutput, pkg, required (+1 more)

### Community 13 - "Build TypeScript Config"
Cohesion: 0.20
Nodes (9): compilerOptions, declaration, noEmit, outDir, rootDir, sourceMap, exclude, extends (+1 more)

### Community 14 - "Runtime Facts"
Cohesion: 0.22
Nodes (9): runtime, credentialsRequired, daemonApiVersion, daemonTransport, language, mcpTransport, moduleSystem, networkListeners (+1 more)

### Community 15 - "Docs Section Check"
Cohesion: 0.22
Nodes (8): expectedOrder, hackathon, order, parts, presentInOrder, readme, REQUIRED_SECTIONS, sections

### Community 16 - "Freeze Preflight"
Cohesion: 0.40
Nodes (4): check(), grepTracked(), results, sh()

## Knowledge Gaps
- **195 isolated node(s):** `$schema`, `includes`, `enabled`, `indentStyle`, `indentWidth` (+190 more)
  These have ≤1 connection - possible missing edges or undocumented components.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `createCovenMcpServer()` connect `MCP Tool Surface & Server` to `Architecture & Project Docs`, `Output Pipeline & Errors`, `Allowlist & Session Lifecycle`?**
  _High betweenness centrality (0.118) - this node is a cross-community bridge._
- **Why does `coven_read_output` connect `Architecture & Project Docs` to `MCP Tool Surface & Server`?**
  _High betweenness centrality (0.063) - this node is a cross-community bridge._
- **Are the 3 inferred relationships involving `CovenMcpError` (e.g. with `expectCovenMcpError()` and `expectCovenMcpError()`) actually correct?**
  _`CovenMcpError` has 3 INFERRED edges - model-reasoned connections that need verification._
- **Are the 3 inferred relationships involving `coven-mcp Submission` (e.g. with `daemon-client.ts` and `health-gate.ts`) actually correct?**
  _`coven-mcp Submission` has 3 INFERRED edges - model-reasoned connections that need verification._
- **What connects `$schema`, `includes`, `enabled` to the rest of the system?**
  _196 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `MCP Tool Surface & Server` be split into smaller, more focused modules?**
  _Cohesion score 0.060109289617486336 - nodes in this community are weakly interconnected._
- **Should `Architecture & Project Docs` be split into smaller, more focused modules?**
  _Cohesion score 0.07329462989840348 - nodes in this community are weakly interconnected._