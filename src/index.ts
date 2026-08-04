#!/usr/bin/env node
import { homedir } from "node:os";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { AllowlistConfigError, parseAllowedRoots } from "./allowlist.js";
import { createScryServer } from "./server.js";
import { resolveSocketPath } from "./socket-path.js";

async function main(): Promise<void> {
  const socketPath = resolveSocketPath(process.env, homedir());
  let allowedRoots: string[];
  try {
    allowedRoots = parseAllowedRoots(process.env["SCRY_ALLOWED_ROOTS"]);
  } catch (err) {
    // FR-23: a misconfigured allowlist is loud, never partially honored.
    const message =
      err instanceof AllowlistConfigError ? err.message : "invalid SCRY_ALLOWED_ROOTS";
    process.stderr.write(`scry: ${message}\n`);
    process.exit(1);
  }
  const server = createScryServer({
    socketPath,
    allowedRoots,
    // FR-22: boolean env vars recognize only the exact literal "true".
    includeMemoryExcerpts: process.env["SCRY_INCLUDE_MEMORY_EXCERPTS"] === "true",
  });
  const transport = new StdioServerTransport();

  const shutdown = (): void => {
    // Metadata-only diagnostics belong on stderr; stdout stays pure JSON-RPC.
    void server.close().finally(() => process.exit(0));
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  transport.onclose = shutdown;

  await server.connect(transport);
}

main().catch((err: unknown) => {
  process.stderr.write(`scry: fatal ${err instanceof Error ? err.name : "error"}\n`);
  process.exit(1);
});
