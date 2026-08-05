#!/usr/bin/env node
// Deterministic local demo (submission guide: "a deterministic local demo
// command" is an accepted demo artifact). Runs the real built server against a
// scripted stand-in daemon on a temporary Unix socket, so it needs no Coven
// install, no credentials, no network, and no provider spend.
//
//   npm run demo
//
// It walks the six beats the guide asks a demo to show: the problem, the
// project starting, the core workflow, where OpenCoven is used, the result,
// and one limitation.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ESC = "\u001b";
const bold = (s) => `\u001b[1m${s}\u001b[0m`;
const dim = (s) => `\u001b[2m${s}\u001b[0m`;
const green = (s) => `\u001b[32m${s}\u001b[0m`;
const yellow = (s) => `\u001b[33m${s}\u001b[0m`;

let step = 0;
function beat(title, why) {
  step += 1;
  console.log(`\n${bold(`── ${step}. ${title} `.padEnd(72, "─"))}`);
  if (why) console.log(dim(why));
}
function say(s) {
  console.log(s);
}
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

if (!existsSync("dist/index.js")) {
  console.error("Run `npm run build` first — the demo drives the built server.");
  process.exit(1);
}

// ── A scripted stand-in for the Coven daemon ─────────────────────────────
// Responses mirror shapes captured from a live coven 0.0.34 daemon, including
// the quirks the README documents: snake_case session records, a camelCase
// events envelope, payload_json as a JSON *string*, and raw PTY output with
// ANSI escapes and carriage-return progress rewrites.
const requestLog = [];
const dir = mkdtempSync(join(tmpdir(), "coven-mcp-demo-"));
const socketPath = join(dir, "coven.sock");
const ALLOWED = join(dir, "project");
mkdirSync(ALLOWED, { recursive: true });

const session = {
  id: "demo-session-1",
  project_root: ALLOWED,
  harness: "claude",
  title: "Summarize the failing test",
  status: "running",
  exit_code: null,
  archived_at: null,
  created_at: "2026-08-04T12:00:00Z",
  updated_at: "2026-08-04T12:00:03Z",
  conversation_id: null,
  familiar_id: "frost",
  labels: [],
  visibility: "private",
  external: false,
  transcript_path: null,
};

const events = [
  { seq: 1, kind: "output", data: `${ESC}[?2004h${ESC}[32m● Reading test output${ESC}[0m\r\n` },
  { seq: 2, kind: "output", data: "scanning  10%\rscanning  60%\rscanning 100%\r\n" },
  { seq: 3, kind: "input", data: null },
  { seq: 4, kind: "output", data: `${ESC}[1mFound it:${ESC}[0m the assertion compares` },
  { seq: 5, kind: "output", data: " NaN to NaN, which is never equal.\r\n" },
  { seq: 6, kind: "exit", data: null },
];

const daemon = createServer((req, res) => {
  requestLog.push(`${req.method} ${req.url}`);
  const json = (payload) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(payload));
  };
  const url = req.url ?? "";
  if (url === "/api/v1/health") {
    return json({
      ok: true,
      apiVersion: "coven.daemon.v1",
      covenVersion: "0.0.0",
      capabilities: { sessions: true, events: true, eventCursor: "sequence" },
    });
  }
  if (url.startsWith("/api/v1/capabilities/harnesses")) {
    return json({
      scanned_at: "2026-08-04T12:00:00Z",
      coven_skills: [],
      harness_capabilities: [
        {
          harness_id: "claude",
          scanned_at: "2026-08-04T12:00:00Z",
          global_instructions: { present: true },
          skills: [],
          plugins: [],
          warnings: [],
        },
        {
          harness_id: "codex",
          scanned_at: "2026-08-04T12:00:00Z",
          global_instructions: { present: false },
          skills: [],
          plugins: [],
          warnings: [],
        },
      ],
    });
  }
  if (url.startsWith("/api/v1/sessions?")) {
    return json({ sessions: [session], next_cursor: null });
  }
  if (url.includes("/events")) {
    const after = Number(new URL(url, "http://x").searchParams.get("afterSeq") ?? 0);
    const page = events.filter((e) => e.seq > after);
    return json({
      events: page.map((e) => ({
        seq: e.seq,
        kind: e.kind,
        payload_json: JSON.stringify(
          e.kind === "output" ? { data: e.data } : { exitCode: 0, status: "completed" },
        ),
      })),
      nextCursor: { afterSeq: page.at(-1)?.seq ?? after },
      hasMore: false,
    });
  }
  if (url.startsWith("/api/v1/sessions/")) {
    if (url.endsWith("/input")) return json({ ok: true, accepted: true });
    if (url.endsWith("/kill")) {
      session.status = "killed";
      return json({ ok: true });
    }
    return json(session);
  }
  if (req.method === "POST" && url === "/api/v1/sessions") return json(session);
  res.writeHead(404, { "content-type": "application/json" });
  res.end(JSON.stringify({ error: { code: "not_found" } }));
});

await new Promise((resolve) => daemon.listen(socketPath, resolve));

// ── Drive the real server over stdio ─────────────────────────────────────
const server = spawn(process.execPath, ["dist/index.js"], {
  env: { ...process.env, COVEN_SOCKET: socketPath, COVEN_MCP_ALLOWED_ROOTS: ALLOWED },
  stdio: ["pipe", "pipe", "inherit"],
});
let buffer = "";
const waiters = [];
server.stdout.on("data", (chunk) => {
  buffer += chunk.toString("utf8");
  let i;
  while ((i = buffer.indexOf("\n")) !== -1) {
    const line = buffer.slice(0, i);
    buffer = buffer.slice(i + 1);
    if (line.trim()) waiters.shift()?.(JSON.parse(line));
  }
});
let id = 0;
function rpc(method, params) {
  const frame = { jsonrpc: "2.0", id: ++id, method, params };
  server.stdin.write(`${JSON.stringify(frame)}\n`);
  return new Promise((r) => waiters.push(r));
}
async function callTool(name, args) {
  const res = await rpc("tools/call", { name, arguments: args });
  return {
    isError: res.result.isError === true,
    body: JSON.parse(res.result.content[0].text),
  };
}

function finish(code) {
  server.stdin.end();
  daemon.close();
  rmSync(dir, { recursive: true, force: true });
  process.exit(code);
}

try {
  console.log(bold("\ncoven-mcp — deterministic demo (no Coven install required)"));
  console.log(dim("A scripted stand-in daemon runs on a temporary Unix socket; everything"));
  console.log(dim("else — the MCP server, the protocol, the parsing — is the real thing."));

  beat(
    "The problem",
    "Coven runs agent sessions locally. From inside an MCP client, that state is invisible.",
  );
  say("You cannot see which sessions are running, read what they printed, or drive");
  say("them without leaving the client you work in.");

  beat("The project starting", "A standards-compliant MCP handshake over stdio.");
  const init = await rpc("initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "demo", version: "0" },
  });
  server.stdin.write(
    `${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`,
  );
  say(`server: ${green(init.result.serverInfo.name)} v${init.result.serverInfo.version}`);
  const { result: listed } = await rpc("tools/list", {});
  say(
    `tools:  ${listed.tools.length} registered — ${listed.tools.map((t) => t.name.replace("coven_", "")).join(", ")}`,
  );

  beat("The core workflow", "Read state, get denied by the security gate, then do real work.");
  const health = await callTool("coven_health", {});
  say(`health:    ${green("reachable")}, api ${health.body.apiVersion}`);
  const harnesses = await callTool("coven_list_harnesses", {});
  say(`harnesses: ${harnesses.body.harnesses.map((h) => h.harnessId).join(", ")}`);
  const sessions = await callTool("coven_list_sessions", {});
  say(
    `sessions:  ${sessions.body.sessions.length} (${sessions.body.sessions[0].status}) "${sessions.body.sessions[0].title}"`,
  );

  await pause(150);
  say("");
  say(dim("Now ask it to start a session somewhere that is not allowlisted:"));
  const denied = await callTool("coven_start_session", {
    projectRoot: "/etc",
    harness: "claude",
    prompt: "do something",
  });
  say(`  → ${yellow(denied.body.code)}: ${denied.body.message}`);
  say(dim("  The daemon was never contacted. Write tools are denied by default."));

  say("");
  say(dim("Inside an allowlisted root, the same call succeeds:"));
  const started = await callTool("coven_start_session", {
    projectRoot: ALLOWED,
    harness: "claude",
    prompt: "Summarize the failing test",
  });
  say(`  → started ${green(started.body.session.id)} (${started.body.session.status})`);
  await callTool("coven_send_input", { sessionId: started.body.session.id, data: "y\n" });
  say(`  → input accepted`);

  beat(
    "Where OpenCoven is used",
    "Every tool call is an HTTP request to the daemon's documented socket API.",
  );
  for (const line of requestLog.slice(0, 8)) say(`  ${dim(line)}`);
  say(dim(`  ...${requestLog.length} requests total, all over ${socketPath.replace(dir, "$TMP")}`));

  beat("The result", "Raw PTY output becomes readable text.");
  const output = await callTool("coven_read_output", {
    sessionId: started.body.session.id,
    timeoutMs: 2000,
  });
  say(dim("  raw bytes on the wire included ANSI colour, bracketed-paste mode, and"));
  say(dim("  three carriage-return progress rewrites. What the LLM receives:"));
  say("");
  for (const line of output.body.text.split("\n")) if (line) say(`    ${green(line)}`);
  say("");
  say(
    `  stopReason=${output.body.stopReason}  complete=${output.body.complete}  lastSeq=${output.body.lastSeq}`,
  );
  say(dim("  Note the progress bar collapsed to its final state, and no escape codes survived."));

  const killed = await callTool("coven_kill_session", { sessionId: started.body.session.id });
  say(`  cleanup: kill acknowledged (${killed.body.ok})`);

  beat("One limitation", "Honest scope beats a hidden gap.");
  say("No token-level streaming: the daemon socket has no push transport, so");
  say(`${bold("coven_read_output")} polls and returns bounded, resumable reads instead. The`);
  say("next step is streaming via the CLI's --stream-json protocol. See README");
  say("§ Known limitations for the full list, each with its reason.");

  console.log(
    `\n${green("Demo complete.")} Nothing was installed, no credentials were used, no network.`,
  );
  console.log(dim("Run `npm run verify` for the full verification suite.\n"));
  finish(0);
} catch (err) {
  console.error("\nDemo failed:", err);
  finish(1);
}
