import { afterEach, describe, expect, test } from "vitest";
import { covenRequest } from "./daemon-client.js";
import { ScryError } from "./errors.js";
import { jsonHandler, startFakeDaemon, type FakeDaemon } from "../test/helpers/fake-daemon.js";

let daemon: FakeDaemon | undefined;

afterEach(async () => {
  await daemon?.close();
  daemon = undefined;
});

async function expectScryError(promise: Promise<unknown>): Promise<ScryError> {
  try {
    await promise;
  } catch (err) {
    expect(err).toBeInstanceOf(ScryError);
    return err as ScryError;
  }
  throw new Error("expected the request to reject");
}

describe("covenRequest", () => {
  test("returns parsed JSON from a 2xx response over the unix socket", async () => {
    daemon = await startFakeDaemon(jsonHandler(200, { ok: true, apiVersion: "coven.daemon.v1" }));
    const result = await covenRequest(daemon.socketPath, { method: "GET", path: "/api/v1/health" });
    expect(result).toEqual({ ok: true, apiVersion: "coven.daemon.v1" });
    expect(daemon.requests).toEqual([{ method: "GET", url: "/api/v1/health" }]);
  });

  test("sends a JSON body with camelCase fields for POST", async () => {
    daemon = await startFakeDaemon();
    let received: unknown;
    daemon.setHandler((_req, res, body) => {
      received = JSON.parse(body.toString("utf8"));
      res.writeHead(200, { "content-type": "application/json" });
      res.end('{"id":"s1"}');
    });
    await covenRequest(daemon.socketPath, {
      method: "POST",
      path: "/api/v1/sessions",
      body: { projectRoot: "/tmp/p", harness: "codex" },
    });
    expect(received).toEqual({ projectRoot: "/tmp/p", harness: "codex" });
  });

  test("maps an unreachable socket to DAEMON_UNAVAILABLE naming `coven daemon start`", async () => {
    const err = await expectScryError(
      covenRequest("/nonexistent/scry-test/no.sock", { method: "GET", path: "/api/v1/health" }),
    );
    expect(err.code).toBe("DAEMON_UNAVAILABLE");
    expect(err.retryable).toBe(true);
    expect(err.message).toContain("coven daemon start");
  });

  test("maps session_not_found (404) to SESSION_NOT_FOUND, not retryable", async () => {
    daemon = await startFakeDaemon(
      jsonHandler(404, { error: { code: "session_not_found", message: "nope" } }),
    );
    const err = await expectScryError(
      covenRequest(daemon.socketPath, { method: "GET", path: "/api/v1/sessions/x" }),
    );
    expect(err.code).toBe("SESSION_NOT_FOUND");
    expect(err.retryable).toBe(false);
  });

  test("maps session_not_live (409) to SESSION_NOT_LIVE, not retryable", async () => {
    daemon = await startFakeDaemon(
      jsonHandler(409, { error: { code: "session_not_live", message: "dead" } }),
    );
    const err = await expectScryError(
      covenRequest(daemon.socketPath, { method: "POST", path: "/api/v1/sessions/x/input", body: {} }),
    );
    expect(err.code).toBe("SESSION_NOT_LIVE");
    expect(err.retryable).toBe(false);
  });

  test("unmapped daemon codes fall through to UPSTREAM_ERROR with safe details, no raw body", async () => {
    daemon = await startFakeDaemon(
      jsonHandler(400, { error: { code: "harness_not_found", message: "secret /Users/x path" } }),
    );
    const err = await expectScryError(
      covenRequest(daemon.socketPath, { method: "GET", path: "/api/v1/sessions" }),
    );
    expect(err.code).toBe("UPSTREAM_ERROR");
    expect(err.retryable).toBe(false);
    expect(err.details).toMatchObject({ upstreamCode: "harness_not_found", httpStatus: 400 });
    expect(err.message).not.toContain("/Users/x");
  });

  test("UPSTREAM_ERROR is retryable for 5xx and 429", async () => {
    daemon = await startFakeDaemon(jsonHandler(503, { error: { code: "overloaded" } }));
    const err5xx = await expectScryError(
      covenRequest(daemon.socketPath, { method: "GET", path: "/api/v1/sessions" }),
    );
    expect(err5xx.code).toBe("UPSTREAM_ERROR");
    expect(err5xx.retryable).toBe(true);

    daemon.setHandler(jsonHandler(429, { error: { code: "rate_limited" } }));
    const err429 = await expectScryError(
      covenRequest(daemon.socketPath, { method: "GET", path: "/api/v1/sessions" }),
    );
    expect(err429.retryable).toBe(true);
  });

  test("a non-JSON error body becomes a bounded UPSTREAM_ERROR", async () => {
    daemon = await startFakeDaemon((_req, res) => {
      res.writeHead(500, { "content-type": "text/html" });
      res.end("<html>Internal Server Error</html>");
    });
    const err = await expectScryError(
      covenRequest(daemon.socketPath, { method: "GET", path: "/api/v1/health" }),
    );
    expect(err.code).toBe("UPSTREAM_ERROR");
    expect(err.details).toMatchObject({ kind: "non_json_error_body", httpStatus: 500 });
    expect(err.message).not.toContain("<html>");
  });

  test("rejects inbound response bodies over 4 MiB without buffering them fully", async () => {
    daemon = await startFakeDaemon((_req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      const chunk = Buffer.alloc(1024 * 1024, 0x61);
      for (let i = 0; i < 5; i++) res.write(chunk);
      res.end();
    });
    const err = await expectScryError(
      covenRequest(daemon.socketPath, { method: "GET", path: "/api/v1/sessions" }),
    );
    expect(err.code).toBe("UPSTREAM_ERROR");
    expect(err.details).toMatchObject({ kind: "response_too_large" });
  });

  test("rejects outbound bodies over 4 MiB before sending any request", async () => {
    daemon = await startFakeDaemon();
    const err = await expectScryError(
      covenRequest(daemon.socketPath, {
        method: "POST",
        path: "/api/v1/sessions",
        body: { prompt: "a".repeat(4 * 1024 * 1024 + 1) },
      }),
    );
    expect(err.code).toBe("INVALID_INPUT");
    expect(daemon.requests).toEqual([]);
  });

  test("a response exceeding the response timeout maps to a retryable timeout error", async () => {
    daemon = await startFakeDaemon((_req, _res) => {
      /* never respond */
    });
    const err = await expectScryError(
      covenRequest(daemon.socketPath, {
        method: "GET",
        path: "/api/v1/health",
        responseTimeoutMs: 100,
      }),
    );
    expect(err.code).toBe("DAEMON_UNAVAILABLE");
    expect(err.retryable).toBe(true);
    expect(err.details).toMatchObject({ kind: "timeout" });
  });
});
