import { request as httpRequest } from "node:http";
import { ScryError, type ScryErrorCode } from "./errors.js";

export type CovenRequestOptions = {
  method: "GET" | "POST";
  path: string;
  body?: unknown;
  connectTimeoutMs?: number;
  responseTimeoutMs?: number;
  /** Cancels the in-flight request (FR-20): the socket is destroyed promptly. */
  signal?: AbortSignal;
};

export const MAX_BODY_BYTES = 4 * 1024 * 1024;
const DEFAULT_CONNECT_TIMEOUT_MS = 2_000;
const DEFAULT_RESPONSE_TIMEOUT_MS = 5_000;

const DAEMON_CODE_MAP: Record<string, { code: ScryErrorCode; message: string }> = {
  session_not_found: { code: "SESSION_NOT_FOUND", message: "Session not found" },
  session_not_live: { code: "SESSION_NOT_LIVE", message: "Session exists but is not live" },
};

function upstreamError(
  message: string,
  httpStatus: number | undefined,
  details: Record<string, unknown>,
): ScryError {
  const retryable = httpStatus !== undefined && (httpStatus >= 500 || httpStatus === 429);
  return new ScryError("UPSTREAM_ERROR", message, retryable, { ...details, httpStatus });
}

function mapErrorBody(status: number, text: string): ScryError {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return upstreamError("Daemon returned a non-JSON error response", status, {
      kind: "non_json_error_body",
    });
  }
  const envelope = parsed as { error?: { code?: unknown; message?: unknown } };
  const upstreamCode = typeof envelope.error?.code === "string" ? envelope.error.code : undefined;
  if (upstreamCode !== undefined) {
    const mapped = DAEMON_CODE_MAP[upstreamCode];
    if (mapped) {
      return new ScryError(mapped.code, mapped.message, false, { upstreamCode, httpStatus: status });
    }
    return upstreamError(`Daemon rejected the request (${upstreamCode})`, status, { upstreamCode });
  }
  return upstreamError("Daemon returned an error without a code", status, {
    kind: "missing_error_code",
  });
}

export function covenRequest(socketPath: string, options: CovenRequestOptions): Promise<unknown> {
  const payload = options.body === undefined ? undefined : JSON.stringify(options.body);
  if (payload !== undefined && Buffer.byteLength(payload) > MAX_BODY_BYTES) {
    return Promise.reject(
      new ScryError("INVALID_INPUT", "Request body exceeds the daemon's 4 MiB limit", false, {
        kind: "request_too_large",
      }),
    );
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    const fail = (err: ScryError) => {
      if (settled) return;
      settled = true;
      clearTimeout(responseTimer);
      req.destroy();
      reject(err);
    };

    const req = httpRequest(
      {
        socketPath,
        method: options.method,
        path: options.path,
        headers: {
          connection: "close",
          accept: "application/json",
          ...(payload === undefined
            ? {}
            : { "content-type": "application/json", "content-length": Buffer.byteLength(payload) }),
        },
      },
      (res) => {
        const status = res.statusCode ?? 0;
        const chunks: Buffer[] = [];
        let received = 0;
        res.on("data", (c: Buffer) => {
          received += c.length;
          if (received > MAX_BODY_BYTES) {
            fail(
              upstreamError("Daemon response exceeds the 4 MiB limit", status, {
                kind: "response_too_large",
              }),
            );
            return;
          }
          chunks.push(c);
        });
        res.on("end", () => {
          if (settled) return;
          const text = Buffer.concat(chunks).toString("utf8");
          if (status >= 400) {
            fail(mapErrorBody(status, text));
            return;
          }
          try {
            const parsed: unknown = JSON.parse(text);
            settled = true;
            clearTimeout(responseTimer);
            resolve(parsed);
          } catch {
            fail(
              upstreamError("Daemon returned a non-JSON response", status, {
                kind: "malformed_json",
              }),
            );
          }
        });
      },
    );

    let timedOut = false;
    const responseTimer = setTimeout(() => {
      timedOut = true;
      req.destroy();
      fail(
        new ScryError("DAEMON_UNAVAILABLE", "Daemon did not respond in time", true, {
          kind: "timeout",
        }),
      );
    }, options.responseTimeoutMs ?? DEFAULT_RESPONSE_TIMEOUT_MS);

    req.on("socket", (socket) => {
      if (socket.connecting) {
        socket.setTimeout(options.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS, () => {
          if (!socket.connecting) return;
          fail(
            new ScryError("DAEMON_UNAVAILABLE", "Timed out connecting to the daemon socket", true, {
              kind: "connect_timeout",
            }),
          );
        });
        socket.once("connect", () => socket.setTimeout(0));
      }
    });

    req.on("error", (cause) => {
      if (timedOut || settled) return;
      fail(
        new ScryError(
          "DAEMON_UNAVAILABLE",
          "Daemon not running — start with `coven daemon start`",
          true,
          { cause: (cause as NodeJS.ErrnoException).code },
        ),
      );
    });

    const onAbort = (): void => {
      fail(new ScryError("INTERNAL_ERROR", "Request cancelled", false, { kind: "aborted" }));
    };
    if (options.signal !== undefined) {
      if (options.signal.aborted) {
        onAbort();
        return;
      }
      options.signal.addEventListener("abort", onAbort, { once: true });
      req.on("close", () => options.signal?.removeEventListener("abort", onAbort));
    }

    req.end(payload);
  });
}
