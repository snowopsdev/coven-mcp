import { afterEach, describe, expect, test } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createScryServer } from "./server.js";
import { startFakeDaemon, type FakeDaemon } from "../test/helpers/fake-daemon.js";

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

async function connectClient(socketPath: string): Promise<Client> {
  const server = createScryServer({ socketPath, allowedRoots: [] });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const c = new Client({ name: "scry-test", version: "0.0.0" });
  await Promise.all([c.connect(clientTransport), server.connect(serverTransport)]);
  client = c;
  return c;
}

function resultJson(result: unknown): unknown {
  const content = (result as { content: { type: string; text: string }[] }).content;
  return JSON.parse(content[0]!.text);
}

describe("coven_read_output tool", () => {
  test("reads sanitized output over HTTP with limit=100 and returns the complete tuple", async () => {
    daemon = await startFakeDaemon();
    const urls: string[] = [];
    daemon.setHandler((req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      if (req.url === "/api/v1/health") {
        res.end(JSON.stringify(GOOD_HEALTH));
        return;
      }
      urls.push(req.url ?? "");
      res.end(
        JSON.stringify({
          events: [
            { seq: 1, kind: "output", payload_json: JSON.stringify({ data: "\u001b[32mhi\u001b[0m\n" }) },
            { seq: 2, kind: "exit", payload_json: JSON.stringify({ exitCode: 0, status: "completed" }) },
          ],
          nextCursor: { afterSeq: 2 },
          hasMore: false,
        }),
      );
    });
    const c = await connectClient(daemon.socketPath);
    const result = await c.callTool({
      name: "coven_read_output",
      arguments: { sessionId: "s-1", timeoutMs: 1000 },
    });
    expect(result.isError ?? false).toBe(false);
    expect(resultJson(result)).toMatchObject({
      text: "hi\n",
      lastSeq: 2,
      resumeToken: null,
      complete: true,
      stopReason: "complete",
    });
    expect(urls).toEqual(["/api/v1/sessions/s-1/events?limit=100"]);
  });

  test("is registered read-only and listed in discovery", async () => {
    const c = await connectClient("/nonexistent/no.sock");
    const { tools } = await c.listTools();
    const tool = tools.find((t) => t.name === "coven_read_output");
    expect(tool).toBeDefined();
    expect(tool?.annotations?.readOnlyHint).toBe(true);
  });

  test("rejects afterSeq combined with resumeToken as INVALID_INPUT", async () => {
    daemon = await startFakeDaemon();
    const c = await connectClient(daemon.socketPath);
    const result = await c.callTool({
      name: "coven_read_output",
      arguments: { sessionId: "s-1", afterSeq: 1, resumeToken: "x.y" },
    });
    expect(result.isError).toBe(true);
    expect(resultJson(result)).toMatchObject({ code: "INVALID_INPUT" });
  });

  test("rejects out-of-range maxBytes and timeoutMs as INVALID_INPUT", async () => {
    daemon = await startFakeDaemon();
    const c = await connectClient(daemon.socketPath);
    for (const args of [
      { sessionId: "s-1", maxBytes: 1024 },
      { sessionId: "s-1", maxBytes: 2 * 1024 * 1024 },
      { sessionId: "s-1", timeoutMs: -1 },
      { sessionId: "s-1", timeoutMs: 999_999 },
      { sessionId: "s-1", afterSeq: -5 },
    ]) {
      const result = await c.callTool({ name: "coven_read_output", arguments: args });
      expect(result.isError).toBe(true);
      expect(resultJson(result)).toMatchObject({ code: "INVALID_INPUT" });
    }
  });

  test("an invalid resume token surfaces as INVALID_RESUME_TOKEN", async () => {
    daemon = await startFakeDaemon();
    daemon.setHandler((req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(GOOD_HEALTH));
    });
    const c = await connectClient(daemon.socketPath);
    const result = await c.callTool({
      name: "coven_read_output",
      arguments: { sessionId: "s-1", resumeToken: "bogus.token" },
    });
    expect(result.isError).toBe(true);
    expect(resultJson(result)).toMatchObject({ code: "INVALID_RESUME_TOKEN" });
  });

  test("an oversized resume token maps to INVALID_RESUME_TOKEN, not INVALID_INPUT (FR-17)", async () => {
    daemon = await startFakeDaemon();
    daemon.setHandler((_req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(GOOD_HEALTH));
    });
    const c = await connectClient(daemon.socketPath);
    const result = await c.callTool({
      name: "coven_read_output",
      arguments: { sessionId: "s-1", resumeToken: `${"A".repeat(70_000)}.sig` },
    });
    expect(result.isError).toBe(true);
    expect(resultJson(result)).toMatchObject({ code: "INVALID_RESUME_TOKEN" });
  });

  test("requires the events capability", async () => {
    daemon = await startFakeDaemon();
    daemon.setHandler((_req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ...GOOD_HEALTH, capabilities: { sessions: true } }));
    });
    const c = await connectClient(daemon.socketPath);
    const result = await c.callTool({
      name: "coven_read_output",
      arguments: { sessionId: "s-1" },
    });
    expect(result.isError).toBe(true);
    expect(resultJson(result)).toMatchObject({ code: "CAPABILITY_UNAVAILABLE" });
  });
});
