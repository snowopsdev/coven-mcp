import { afterEach, describe, expect, test } from "vitest";
import { type FakeDaemon, jsonHandler, startFakeDaemon } from "../test/helpers/fake-daemon.js";
import { covenRequest } from "./daemon-client.js";
import { CovenMcpError } from "./errors.js";
import { createHealthGate } from "./health-gate.js";

let daemon: FakeDaemon | undefined;

afterEach(async () => {
  await daemon?.close();
  daemon = undefined;
});

const GOOD_HEALTH = {
  ok: true,
  apiVersion: "coven.daemon.v1",
  covenVersion: "0.0.34",
  capabilities: { sessions: true, events: true, memory: "beta" },
};

function gateFor(socketPath: () => string, now: () => number) {
  return createHealthGate({
    fetchHealth: () => covenRequest(socketPath(), { method: "GET", path: "/api/v1/health" }),
    now,
  });
}

async function expectCovenMcpError(promise: Promise<unknown>): Promise<CovenMcpError> {
  try {
    await promise;
  } catch (err) {
    expect(err).toBeInstanceOf(CovenMcpError);
    return err as CovenMcpError;
  }
  throw new Error("expected the gate to reject");
}

describe("createHealthGate", () => {
  test("passes when ok, apiVersion matches, and the required capability is exactly true", async () => {
    daemon = await startFakeDaemon(jsonHandler(200, GOOD_HEALTH));
    const gate = gateFor(
      () => daemon!.socketPath,
      () => 0,
    );
    await expect(gate.require("sessions")).resolves.toMatchObject({
      apiVersion: "coven.daemon.v1",
    });
  });

  test("rejects a wrong apiVersion with INCOMPATIBLE_DAEMON naming the found version", async () => {
    daemon = await startFakeDaemon(
      jsonHandler(200, { ...GOOD_HEALTH, apiVersion: "coven.daemon.v2" }),
    );
    const gate = gateFor(
      () => daemon!.socketPath,
      () => 0,
    );
    const err = await expectCovenMcpError(gate.require("sessions"));
    expect(err.code).toBe("INCOMPATIBLE_DAEMON");
    expect(err.retryable).toBe(false);
    expect(err.message).toContain("coven.daemon.v2");
  });

  test("rejects a missing capability with CAPABILITY_UNAVAILABLE naming it", async () => {
    daemon = await startFakeDaemon(
      jsonHandler(200, { ...GOOD_HEALTH, capabilities: { events: true } }),
    );
    const gate = gateFor(
      () => daemon!.socketPath,
      () => 0,
    );
    const err = await expectCovenMcpError(gate.require("sessions"));
    expect(err.code).toBe("CAPABILITY_UNAVAILABLE");
    expect(err.retryable).toBe(true);
    expect(err.message).toContain("sessions");
  });

  test("a string capability value does not satisfy the gate (only exactly true counts)", async () => {
    daemon = await startFakeDaemon(
      jsonHandler(200, { ...GOOD_HEALTH, capabilities: { sessions: "enabled" } }),
    );
    const gate = gateFor(
      () => daemon!.socketPath,
      () => 0,
    );
    const err = await expectCovenMcpError(gate.require("sessions"));
    expect(err.code).toBe("CAPABILITY_UNAVAILABLE");
  });

  test("ok:false fails closed even when the version matches", async () => {
    daemon = await startFakeDaemon(jsonHandler(200, { ...GOOD_HEALTH, ok: false }));
    const gate = gateFor(
      () => daemon!.socketPath,
      () => 0,
    );
    const err = await expectCovenMcpError(gate.require("sessions"));
    expect(err.code).toBe("DAEMON_UNAVAILABLE");
  });

  test("reuses a cached success within the 1.5s TTL and refetches after it expires", async () => {
    daemon = await startFakeDaemon(jsonHandler(200, GOOD_HEALTH));
    let clock = 0;
    const gate = gateFor(
      () => daemon!.socketPath,
      () => clock,
    );
    await gate.require("sessions");
    clock = 1_400;
    await gate.require("events");
    expect(daemon.requests.length).toBe(1);
    clock = 1_600;
    await gate.require("sessions");
    expect(daemon.requests.length).toBe(2);
  });

  test("concurrent gate checks share a single in-flight health request", async () => {
    daemon = await startFakeDaemon();
    daemon.setHandler((_req, res) => {
      setTimeout(() => {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify(GOOD_HEALTH));
      }, 50);
    });
    const gate = gateFor(
      () => daemon!.socketPath,
      () => 0,
    );
    await Promise.all([gate.require("sessions"), gate.require("events"), gate.require("sessions")]);
    expect(daemon.requests.length).toBe(1);
  });

  test("a cached failure expires with the TTL, allowing recovery after the daemon starts", async () => {
    let clock = 0;
    let socketPath = "/nonexistent/coven-mcp-test/no.sock";
    const gate = gateFor(
      () => socketPath,
      () => clock,
    );

    const err = await expectCovenMcpError(gate.require("sessions"));
    expect(err.code).toBe("DAEMON_UNAVAILABLE");

    daemon = await startFakeDaemon(jsonHandler(200, GOOD_HEALTH));
    socketPath = daemon.socketPath;

    clock = 1_000; // still within TTL: cached failure is reused
    const cached = await expectCovenMcpError(gate.require("sessions"));
    expect(cached.code).toBe("DAEMON_UNAVAILABLE");
    expect(daemon.requests.length).toBe(0);

    clock = 2_000; // TTL expired: gate recovers
    await expect(gate.require("sessions")).resolves.toBeDefined();
  });

  test("a malformed health schema is a bounded UPSTREAM_ERROR", async () => {
    daemon = await startFakeDaemon(jsonHandler(200, { unexpected: "shape" }));
    const gate = gateFor(
      () => daemon!.socketPath,
      () => 0,
    );
    const err = await expectCovenMcpError(gate.require("sessions"));
    expect(err.code).toBe("UPSTREAM_ERROR");
    expect(err.details).toMatchObject({ kind: "invalid_health_schema" });
  });
});
