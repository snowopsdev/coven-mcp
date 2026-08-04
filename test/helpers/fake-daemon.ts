import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

export type FakeHandler = (req: IncomingMessage, res: ServerResponse, body: Buffer) => void;

export type FakeDaemon = {
  socketPath: string;
  requests: { method: string; url: string }[];
  setHandler: (handler: FakeHandler) => void;
  close: () => Promise<void>;
};

/** Starts a real HTTP server bound to a temporary Unix socket. */
export async function startFakeDaemon(initial?: FakeHandler): Promise<FakeDaemon> {
  const dir = mkdtempSync(join(tmpdir(), "scry-"));
  const socketPath = join(dir, "d.sock");
  let handler: FakeHandler =
    initial ??
    ((_req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end("{}");
    });
  const requests: { method: string; url: string }[] = [];

  const server: Server = createServer((req, res) => {
    requests.push({ method: req.method ?? "", url: req.url ?? "" });
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => handler(req, res, Buffer.concat(chunks)));
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(socketPath, resolve);
  });

  return {
    socketPath,
    requests,
    setHandler: (h) => {
      handler = h;
    },
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => {
          rmSync(dir, { recursive: true, force: true });
          resolve();
        });
      }),
  };
}

export function jsonHandler(status: number, payload: unknown): FakeHandler {
  return (_req, res) => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(payload));
  };
}
