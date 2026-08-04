import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, test } from "vitest";
import { type FakeDaemon, startFakeDaemon } from "../test/helpers/fake-daemon.js";
import { type CovenMcpServerConfig, createCovenMcpServer } from "./server.js";

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
  capabilities: { sessions: true, events: true },
};

const UPSTREAM_ENTRY = {
  id: "mem-1",
  familiar_id: "frost",
  title: "Project conventions",
  path: "memory/project-conventions.md",
  updated_at: "1754300000",
  updated_at_iso: "2026-08-04T10:00:00Z",
  excerpt: "First paragraph of the memory file.",
  source: { kind: "familiar", label: "frost" },
  privacy_classification: null,
  reveal_required: false,
  verification_state: "verified",
};

async function connectClient(
  config: Partial<CovenMcpServerConfig> & { socketPath: string },
): Promise<Client> {
  const server = createCovenMcpServer({ allowedRoots: [], ...config });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const c = new Client({ name: "coven-mcp-test", version: "0.0.0" });
  await Promise.all([c.connect(clientTransport), server.connect(serverTransport)]);
  client = c;
  return c;
}

async function memoryDaemon(entries: unknown[]): Promise<FakeDaemon> {
  const d = await startFakeDaemon();
  d.setHandler((req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(req.url === "/api/v1/health" ? JSON.stringify(GOOD_HEALTH) : JSON.stringify(entries));
  });
  daemon = d;
  return d;
}

function resultJson(result: unknown): { entries: Record<string, unknown>[] } {
  const content = (result as { content: { type: string; text: string }[] }).content;
  return JSON.parse(content[0]!.text) as { entries: Record<string, unknown>[] };
}

describe("coven_list_memory tool", () => {
  test("is listed read-only and described as a lister, not search", async () => {
    const c = await connectClient({ socketPath: "/nonexistent/no.sock" });
    const { tools } = await c.listTools();
    const tool = tools.find((t) => t.name === "coven_list_memory");
    expect(tool).toBeDefined();
    expect(tool?.annotations?.readOnlyHint).toBe(true);
    expect(tool?.description).toMatch(/lister/i);
  });

  test("blanks excerpts by default and marks them redacted", async () => {
    const d = await memoryDaemon([UPSTREAM_ENTRY]);
    const c = await connectClient({ socketPath: d.socketPath });
    const result = await c.callTool({ name: "coven_list_memory", arguments: {} });
    expect(result.isError ?? false).toBe(false);
    const body = resultJson(result);
    expect(body.entries[0]).toMatchObject({
      id: "mem-1",
      familiarId: "frost",
      excerpt: "",
      excerptRedacted: true,
    });
  });

  test("forwards public excerpts only under explicit opt-in, still honoring revealRequired", async () => {
    const d = await memoryDaemon([
      UPSTREAM_ENTRY,
      { ...UPSTREAM_ENTRY, id: "mem-2", reveal_required: true },
    ]);
    const c = await connectClient({ socketPath: d.socketPath, includeMemoryExcerpts: true });
    const result = await c.callTool({ name: "coven_list_memory", arguments: {} });
    const body = resultJson(result);
    expect(body.entries[0]).toMatchObject({
      excerpt: "First paragraph of the memory file.",
      excerptRedacted: false,
    });
    expect(body.entries[1]).toMatchObject({ excerpt: "", excerptRedacted: true });
  });

  test("returns an honest empty list when the daemon has no memory files", async () => {
    const d = await memoryDaemon([]);
    const c = await connectClient({ socketPath: d.socketPath });
    const result = await c.callTool({ name: "coven_list_memory", arguments: {} });
    expect(resultJson(result)).toEqual({ entries: [] });
  });
});
