import { join } from "node:path";

export type Env = Record<string, string | undefined>;

export function resolveSocketPath(env: Env, homedir: string): string {
  const socket = env["COVEN_SOCKET"];
  if (socket) return socket;
  const covenHome = env["COVEN_HOME"];
  if (covenHome) return join(covenHome, "coven.sock");
  return join(homedir, ".coven", "coven.sock");
}
