#!/usr/bin/env node
import { homedir } from "node:os";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { resolveSocketPath } from "./socket-path.js";
import { createScryServer } from "./server.js";

async function main(): Promise<void> {
  const socketPath = resolveSocketPath(process.env, homedir());
  const server = createScryServer({ socketPath });
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
