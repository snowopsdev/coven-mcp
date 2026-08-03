#!/usr/bin/env node
// Stdio MCP smoke test (PRD §7): spawns the built entry point and drives raw
// JSON-RPC frames — initialize, tools/list, one coven_health call — asserting
// stdout carries nothing but JSON-RPC. Needs no daemon and no credentials.
import { spawn } from "node:child_process";

const entry = new URL("../dist/index.js", import.meta.url).pathname;
const child = spawn(process.execPath, [entry], {
  env: { ...process.env, COVEN_SOCKET: "/nonexistent/scry-smoke/no.sock" },
  stdio: ["pipe", "pipe", "pipe"],
});

const timeout = setTimeout(() => {
  console.error("SMOKE FAIL: timed out");
  child.kill("SIGKILL");
  process.exit(1);
}, 10_000);

let buffer = "";
const responses = [];
const pending = [];

child.stdout.on("data", (chunk) => {
  buffer += chunk.toString("utf8");
  let idx;
  while ((idx = buffer.indexOf("\n")) !== -1) {
    const line = buffer.slice(0, idx);
    buffer = buffer.slice(idx + 1);
    if (line.trim() === "") continue;
    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch {
      console.error("SMOKE FAIL: non-JSON-RPC bytes on stdout:", line.slice(0, 120));
      process.exit(1);
    }
    responses.push(parsed);
    pending.shift()?.(parsed);
  }
});

function send(frame) {
  child.stdin.write(JSON.stringify(frame) + "\n");
}

function nextResponse() {
  return new Promise((resolve) => pending.push(resolve));
}

function fail(message, extra) {
  console.error("SMOKE FAIL:", message, extra === undefined ? "" : JSON.stringify(extra).slice(0, 300));
  child.kill("SIGKILL");
  process.exit(1);
}

send({
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "smoke", version: "0.0.0" },
  },
});
const init = await nextResponse();
if (init.result?.serverInfo?.name !== "scry") fail("unexpected initialize result", init);

send({ jsonrpc: "2.0", method: "notifications/initialized" });

send({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
const list = await nextResponse();
const names = (list.result?.tools ?? []).map((t) => t.name).sort();
const expected = ["coven_health", "coven_list_harnesses", "coven_list_sessions"];
if (JSON.stringify(names) !== JSON.stringify(expected)) fail("unexpected tool list", names);

send({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "coven_health", arguments: {} } });
const health = await nextResponse();
if (health.result?.isError) fail("coven_health returned isError", health);
const body = JSON.parse(health.result?.content?.[0]?.text ?? "{}");
if (body.reachable !== false || body.error?.code !== "DAEMON_UNAVAILABLE") {
  fail("unexpected coven_health body", body);
}

child.stdin.end();
const exitCode = await new Promise((resolve) => child.once("exit", resolve));
clearTimeout(timeout);
if (exitCode !== 0 && exitCode !== null) fail(`entry point exited with ${exitCode}`);
console.log("SMOKE OK: discovery stable with daemon down, stdout pure, clean shutdown");
