import { afterEach, describe, expect, test } from "vitest";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createScryServer } from "./server.js";
import { parseAllowedRoots } from "./allowlist.js";
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

function upstreamSession(projectRoot: string): Record<string, unknown> {
  return {
    id: "s-1",
    project_root: projectRoot,
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
}

type Route = { status: number; payload: unknown };

/** Routed fake daemon: health is always good; other routes come from the map. */
async function routedDaemon(routes: Record<string, Route>): Promise<{
  daemon: FakeDaemon;
  bodies: Record<string, unknown>;
}> {
  const bodies: Record<string, unknown> = {};
  const d = await startFakeDaemon();
  d.setHandler((req, res, body) => {
    const key = `${req.method} ${req.url}`;
    if (req.url === "/api/v1/health") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(GOOD_HEALTH));
      return;
    }
    if (body.length > 0) bodies[key] = JSON.parse(body.toString("utf8"));
    const route = routes[key];
    if (route === undefined) {
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { code: "session_not_found" } }));
      return;
    }
    res.writeHead(route.status, { "content-type": "application/json" });
    res.end(JSON.stringify(route.payload));
  });
  daemon = d;
  return { daemon: d, bodies };
}

async function connectClient(socketPath: string, allowedRoots: string[] = []): Promise<Client> {
  // Same canonicalization path production uses (index.ts): raw env value in,
  // canonical roots out — this is what absorbs macOS's /var -> /private/var.
  const server = createScryServer({
    socketPath,
    allowedRoots: parseAllowedRoots(allowedRoots.join(":") || undefined),
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const c = new Client({ name: "scry-test", version: "0.0.0" });
  await Promise.all([c.connect(clientTransport), server.connect(serverTransport)]);
  client = c;
  return c;
}

function resultJson(result: unknown): unknown {
  const content = (result as { content: { type: string; text: string }[] }).content;
  expect(content).toHaveLength(1);
  return JSON.parse(content[0]!.text);
}

function allowedTree(): { allowed: string; sibling: string } {
  const base = mkdtempSync(join(tmpdir(), "scry-life-"));
  const allowed = join(base, "work", "app");
  const sibling = join(base, "work", "app2");
  mkdirSync(allowed, { recursive: true });
  mkdirSync(sibling, { recursive: true });
  return { allowed, sibling };
}

describe("lifecycle tools", () => {
  test("all seven tools are listed; kill is destructive, writes are not read-only", async () => {
    const c = await connectClient("/nonexistent/no.sock");
    const { tools } = await c.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual([
      "coven_get_session",
      "coven_health",
      "coven_kill_session",
      "coven_list_harnesses",
      "coven_list_sessions",
      "coven_read_output",
      "coven_send_input",
      "coven_start_session",
    ]);
    const byName = new Map(tools.map((t) => [t.name, t]));
    expect(byName.get("coven_kill_session")?.annotations?.destructiveHint).toBe(true);
    expect(byName.get("coven_start_session")?.annotations?.readOnlyHint).toBe(false);
    expect(byName.get("coven_get_session")?.annotations?.readOnlyHint).toBe(true);
  });

  test("coven_get_session returns the normalized record", async () => {
    const { daemon: d } = await routedDaemon({
      "GET /api/v1/sessions/s-1": { status: 200, payload: upstreamSession("/work/app") },
    });
    const c = await connectClient(d.socketPath);
    const result = await c.callTool({ name: "coven_get_session", arguments: { sessionId: "s-1" } });
    expect(result.isError ?? false).toBe(false);
    expect(resultJson(result)).toMatchObject({ session: { id: "s-1", projectRoot: "/work/app" } });
  });

  test("coven_get_session rejects a malformed session id with INVALID_INPUT before any I/O", async () => {
    const { daemon: d } = await routedDaemon({});
    const c = await connectClient(d.socketPath);
    const result = await c.callTool({
      name: "coven_get_session",
      arguments: { sessionId: "../etc/passwd" },
    });
    expect(result.isError).toBe(true);
    expect(resultJson(result)).toMatchObject({ code: "INVALID_INPUT" });
    expect(d.requests).toEqual([]);
  });

  test("coven_start_session is denied in read-only mode without touching the daemon", async () => {
    const { allowed } = allowedTree();
    const { daemon: d } = await routedDaemon({});
    const c = await connectClient(d.socketPath, []);
    const result = await c.callTool({
      name: "coven_start_session",
      arguments: { projectRoot: allowed, harness: "claude", prompt: "hi" },
    });
    expect(result.isError).toBe(true);
    expect(resultJson(result)).toMatchObject({ code: "ROOT_NOT_ALLOWED" });
    expect(d.requests).toEqual([]);
  });

  test("coven_start_session POSTs the canonical camelCase body for an allowed root", async () => {
    const { allowed } = allowedTree();
    const { daemon: d, bodies } = await routedDaemon({
      "POST /api/v1/sessions": { status: 200, payload: upstreamSession(allowed) },
    });
    const c = await connectClient(d.socketPath, [allowed]);
    const result = await c.callTool({
      name: "coven_start_session",
      arguments: { projectRoot: allowed, harness: "claude", prompt: "hi", title: "demo" },
    });
    expect(result.isError ?? false).toBe(false);
    expect(resultJson(result)).toMatchObject({ session: { id: "s-1" } });
    expect(bodies["POST /api/v1/sessions"]).toMatchObject({
      harness: "claude",
      prompt: "hi",
      title: "demo",
    });
    expect((bodies["POST /api/v1/sessions"] as { projectRoot: string }).projectRoot).toContain(
      "/work/app",
    );
  });

  test("coven_start_session denies the sibling directory sharing the allowed root prefix", async () => {
    const { allowed, sibling } = allowedTree();
    const { daemon: d } = await routedDaemon({});
    const c = await connectClient(d.socketPath, [allowed]);
    const result = await c.callTool({
      name: "coven_start_session",
      arguments: { projectRoot: sibling, harness: "claude", prompt: "hi" },
    });
    expect(result.isError).toBe(true);
    expect(resultJson(result)).toMatchObject({ code: "ROOT_NOT_ALLOWED" });
  });

  test("coven_start_session rejects a relative projectRoot with INVALID_INPUT", async () => {
    const { allowed } = allowedTree();
    const { daemon: d } = await routedDaemon({});
    const c = await connectClient(d.socketPath, [allowed]);
    const result = await c.callTool({
      name: "coven_start_session",
      arguments: { projectRoot: "work/app", harness: "claude", prompt: "hi" },
    });
    expect(result.isError).toBe(true);
    expect(resultJson(result)).toMatchObject({ code: "INVALID_INPUT" });
  });

  test("coven_start_session requires cwd to stay inside projectRoot", async () => {
    const { allowed, sibling } = allowedTree();
    const { daemon: d } = await routedDaemon({});
    const c = await connectClient(d.socketPath, [allowed, sibling]);
    const result = await c.callTool({
      name: "coven_start_session",
      arguments: { projectRoot: allowed, cwd: sibling, harness: "claude", prompt: "hi" },
    });
    expect(result.isError).toBe(true);
    expect(resultJson(result)).toMatchObject({ code: "ROOT_NOT_ALLOWED" });
  });

  test("coven_send_input authorizes the fetched session's root, never a caller claim", async () => {
    const { allowed, sibling } = allowedTree();
    const { daemon: d } = await routedDaemon({
      "GET /api/v1/sessions/s-1": { status: 200, payload: upstreamSession(sibling) },
      "POST /api/v1/sessions/s-1/input": { status: 200, payload: { ok: true, accepted: true } },
    });
    const c = await connectClient(d.socketPath, [allowed]);
    const result = await c.callTool({
      name: "coven_send_input",
      arguments: { sessionId: "s-1", data: "echo hi\n" },
    });
    expect(result.isError).toBe(true);
    expect(resultJson(result)).toMatchObject({ code: "ROOT_NOT_ALLOWED" });
    expect(d.requests.some((r) => r.url.endsWith("/input"))).toBe(false);
  });

  test("coven_send_input forwards data verbatim for an owned session and returns the ack", async () => {
    const { allowed } = allowedTree();
    const { daemon: d, bodies } = await routedDaemon({
      "GET /api/v1/sessions/s-1": { status: 200, payload: upstreamSession(allowed) },
      "POST /api/v1/sessions/s-1/input": { status: 200, payload: { ok: true, accepted: true } },
    });
    const c = await connectClient(d.socketPath, [allowed]);
    const result = await c.callTool({
      name: "coven_send_input",
      arguments: { sessionId: "s-1", data: "run tests" },
    });
    expect(result.isError ?? false).toBe(false);
    expect(resultJson(result)).toEqual({ ok: true, accepted: true });
    expect(bodies["POST /api/v1/sessions/s-1/input"]).toEqual({ data: "run tests" });
  });

  test("coven_kill_session applies the same ownership rule and reports the ack", async () => {
    const { allowed } = allowedTree();
    const { daemon: d } = await routedDaemon({
      "GET /api/v1/sessions/s-1": { status: 200, payload: upstreamSession(allowed) },
      "POST /api/v1/sessions/s-1/kill": { status: 200, payload: { ok: true } },
    });
    const c = await connectClient(d.socketPath, [allowed]);
    const result = await c.callTool({ name: "coven_kill_session", arguments: { sessionId: "s-1" } });
    expect(result.isError ?? false).toBe(false);
    expect(resultJson(result)).toEqual({ ok: true, accepted: true });
  });

  test("a session record whose root no longer exists denies the mutation (fail closed)", async () => {
    const { allowed } = allowedTree();
    const { daemon: d } = await routedDaemon({
      "GET /api/v1/sessions/s-1": {
        status: 200,
        payload: upstreamSession(join(allowed, "deleted-subdir")),
      },
      "POST /api/v1/sessions/s-1/kill": { status: 200, payload: { ok: true } },
    });
    const c = await connectClient(d.socketPath, [allowed]);
    const result = await c.callTool({ name: "coven_kill_session", arguments: { sessionId: "s-1" } });
    expect(result.isError).toBe(true);
    expect(resultJson(result)).toMatchObject({ code: "ROOT_NOT_ALLOWED" });
  });

  test("coven_send_input rejects empty data with INVALID_INPUT", async () => {
    const { allowed } = allowedTree();
    const { daemon: d } = await routedDaemon({});
    const c = await connectClient(d.socketPath, [allowed]);
    const result = await c.callTool({
      name: "coven_send_input",
      arguments: { sessionId: "s-1", data: "" },
    });
    expect(result.isError).toBe(true);
    expect(resultJson(result)).toMatchObject({ code: "INVALID_INPUT" });
  });
});
