import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, test } from "vitest";
import { type FakeDaemon, jsonHandler, startFakeDaemon } from "../test/helpers/fake-daemon.js";
import { createScryServer } from "./server.js";

let daemon: FakeDaemon | undefined;
let client: Client | undefined;

afterEach(async () => {
  await client?.close();
  client = undefined;
  await daemon?.close();
  daemon = undefined;
});

const GOOD_HEALTH = {
  ok: true,
  apiVersion: "coven.daemon.v1",
  covenVersion: "0.0.34",
  capabilities: { sessions: true, events: true },
};

const UPSTREAM_SESSION = {
  id: "s-1",
  project_root: "/work/app",
  harness: "claude",
  title: "t",
  status: "running",
  exit_code: null,
  archived_at: null,
  created_at: "2026-08-03T18:00:00Z",
  updated_at: "2026-08-03T18:01:00Z",
  conversation_id: null,
  familiar_id: null,
  labels: [],
  visibility: "private",
  external: false,
  transcript_path: null,
};

async function connectClient(socketPath: string): Promise<Client> {
  const server = createScryServer({ socketPath });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const c = new Client({ name: "scry-test", version: "0.0.0" });
  await Promise.all([c.connect(clientTransport), server.connect(serverTransport)]);
  client = c;
  return c;
}

function resultJson(result: unknown): unknown {
  const content = (result as { content: { type: string; text: string }[] }).content;
  expect(content).toHaveLength(1);
  expect(content[0]?.type).toBe("text");
  return JSON.parse(content[0]!.text);
}

describe("scry MCP server — Checkpoint A", () => {
  test("lists the read tools with the daemon stopped, all marked read-only", async () => {
    const c = await connectClient("/nonexistent/scry/no.sock");
    const { tools } = await c.listTools();
    const names = tools.map((t) => t.name);
    const readTools = ["coven_health", "coven_list_harnesses", "coven_list_sessions"];
    for (const name of readTools) expect(names).toContain(name);
    for (const tool of tools.filter((t) => readTools.includes(t.name))) {
      expect(tool.annotations?.readOnlyHint).toBe(true);
      expect(tool.description).toBeTruthy();
    }
  });

  test("coven_health with the daemon stopped is a diagnostic result, not a tool error", async () => {
    const c = await connectClient("/nonexistent/scry/no.sock");
    const result = await c.callTool({ name: "coven_health", arguments: {} });
    expect(result.isError ?? false).toBe(false);
    expect(resultJson(result)).toMatchObject({
      reachable: false,
      ok: false,
      error: { code: "DAEMON_UNAVAILABLE" },
    });
  });

  test("coven_health returns normalized live fields when the daemon responds", async () => {
    daemon = await startFakeDaemon(jsonHandler(200, GOOD_HEALTH));
    const c = await connectClient(daemon.socketPath);
    const result = await c.callTool({ name: "coven_health", arguments: {} });
    expect(result.isError ?? false).toBe(false);
    expect(resultJson(result)).toMatchObject({
      reachable: true,
      ok: true,
      apiVersion: "coven.daemon.v1",
      capabilities: { sessions: true },
    });
  });

  test("coven_health reports an incompatible daemon as reachable without erroring (FR-2)", async () => {
    daemon = await startFakeDaemon(
      jsonHandler(200, { ...GOOD_HEALTH, apiVersion: "coven.daemon.v2" }),
    );
    const c = await connectClient(daemon.socketPath);
    const result = await c.callTool({ name: "coven_health", arguments: {} });
    expect(result.isError ?? false).toBe(false);
    expect(resultJson(result)).toMatchObject({ reachable: true, apiVersion: "coven.daemon.v2" });
  });

  test("coven_list_sessions sends limit=100 and includeArchived=false by default and normalizes the envelope", async () => {
    daemon = await startFakeDaemon();
    daemon.setHandler((req, res) => {
      if (req.url === "/api/v1/health") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify(GOOD_HEALTH));
        return;
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ sessions: [UPSTREAM_SESSION], next_cursor: "cur-2" }));
    });
    const c = await connectClient(daemon.socketPath);
    const result = await c.callTool({ name: "coven_list_sessions", arguments: {} });
    expect(result.isError ?? false).toBe(false);
    expect(resultJson(result)).toMatchObject({
      sessions: [{ id: "s-1", projectRoot: "/work/app" }],
      nextCursor: "cur-2",
      hasMore: true,
    });
    const listUrl = daemon.requests.find((r) => r.url.startsWith("/api/v1/sessions"))?.url;
    expect(listUrl).toBe("/api/v1/sessions?limit=100&includeArchived=false");
  });

  test("coven_list_sessions fails closed as a structured tool error when the daemon is down", async () => {
    const c = await connectClient("/nonexistent/scry/no.sock");
    const result = await c.callTool({ name: "coven_list_sessions", arguments: {} });
    expect(result.isError).toBe(true);
    expect(resultJson(result)).toMatchObject({ code: "DAEMON_UNAVAILABLE", retryable: true });
  });

  test("coven_list_sessions rejects an out-of-range limit with INVALID_INPUT", async () => {
    daemon = await startFakeDaemon(jsonHandler(200, GOOD_HEALTH));
    const c = await connectClient(daemon.socketPath);
    const result = await c.callTool({ name: "coven_list_sessions", arguments: { limit: 0 } });
    expect(result.isError).toBe(true);
    expect(resultJson(result)).toMatchObject({ code: "INVALID_INPUT" });
  });

  test("coven_list_sessions requires the sessions capability (fail closed when absent)", async () => {
    daemon = await startFakeDaemon(
      jsonHandler(200, { ...GOOD_HEALTH, capabilities: { events: true } }),
    );
    const c = await connectClient(daemon.socketPath);
    const result = await c.callTool({ name: "coven_list_sessions", arguments: {} });
    expect(result.isError).toBe(true);
    expect(resultJson(result)).toMatchObject({ code: "CAPABILITY_UNAVAILABLE" });
  });

  test("coven_list_harnesses returns the normalized harness list", async () => {
    daemon = await startFakeDaemon();
    daemon.setHandler((req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      if (req.url === "/api/v1/health") {
        res.end(JSON.stringify(GOOD_HEALTH));
        return;
      }
      res.end(
        JSON.stringify({
          scanned_at: "2026-08-03T19:00:00Z",
          coven_skills: [],
          harness_capabilities: [
            {
              harness_id: "codex",
              scanned_at: "2026-08-03T19:00:00Z",
              global_instructions: { present: false },
              skills: [],
              plugins: [],
              warnings: [],
            },
          ],
        }),
      );
    });
    const c = await connectClient(daemon.socketPath);
    const result = await c.callTool({ name: "coven_list_harnesses", arguments: {} });
    expect(result.isError ?? false).toBe(false);
    expect(resultJson(result)).toMatchObject({
      scannedAt: "2026-08-03T19:00:00Z",
      harnesses: [{ harnessId: "codex" }],
    });
  });
});
