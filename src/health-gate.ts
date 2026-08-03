import { ScryError } from "./errors.js";

export const DAEMON_API_VERSION = "coven.daemon.v1";
export const HEALTH_CACHE_TTL_MS = 1_500;

export type HealthCapabilities = Record<string, boolean | string>;

export type NormalizedHealth = {
  ok: boolean;
  apiVersion?: string;
  covenVersion?: string;
  capabilities?: HealthCapabilities;
};

export type HealthGateDeps = {
  fetchHealth: () => Promise<unknown>;
  ttlMs?: number;
  now?: () => number;
};

export type HealthGate = {
  /** Fails closed unless the daemon is ok, speaks v1, and advertises the capability as exactly true. */
  require: (capability?: string) => Promise<NormalizedHealth>;
};

export function normalizeHealth(raw: unknown): NormalizedHealth {
  if (typeof raw !== "object" || raw === null) {
    throw invalidSchema();
  }
  const record = raw as Record<string, unknown>;
  if (typeof record["ok"] !== "boolean") {
    throw invalidSchema();
  }
  const health: NormalizedHealth = { ok: record["ok"] };
  if (typeof record["apiVersion"] === "string") health.apiVersion = record["apiVersion"];
  if (typeof record["covenVersion"] === "string") health.covenVersion = record["covenVersion"];
  const caps = record["capabilities"];
  if (typeof caps === "object" && caps !== null) {
    const normalized: HealthCapabilities = {};
    for (const [key, value] of Object.entries(caps)) {
      if (typeof value === "boolean" || typeof value === "string") normalized[key] = value;
    }
    health.capabilities = normalized;
  }
  return health;
}

function invalidSchema(): ScryError {
  return new ScryError("UPSTREAM_ERROR", "Daemon health response has an unexpected shape", false, {
    kind: "invalid_health_schema",
  });
}

type CacheEntry = { at: number; outcome: { health: NormalizedHealth } | { error: ScryError } };

export function createHealthGate(deps: HealthGateDeps): HealthGate {
  const ttlMs = deps.ttlMs ?? HEALTH_CACHE_TTL_MS;
  const now = deps.now ?? Date.now;
  let cache: CacheEntry | undefined;
  let inflight: Promise<CacheEntry> | undefined;

  async function snapshot(): Promise<NormalizedHealth> {
    if (cache !== undefined && now() - cache.at < ttlMs) {
      return unwrap(cache);
    }
    if (inflight === undefined) {
      inflight = deps
        .fetchHealth()
        .then((raw): CacheEntry => ({ at: now(), outcome: { health: normalizeHealth(raw) } }))
        .catch((error: unknown): CacheEntry => {
          const scryError =
            error instanceof ScryError
              ? error
              : new ScryError("INTERNAL_ERROR", "Health check failed unexpectedly", false);
          return { at: now(), outcome: { error: scryError } };
        })
        .finally(() => {
          inflight = undefined;
        });
    }
    cache = await inflight;
    return unwrap(cache);
  }

  function unwrap(entry: CacheEntry): NormalizedHealth {
    if ("error" in entry.outcome) throw entry.outcome.error;
    return entry.outcome.health;
  }

  return {
    async require(capability?: string): Promise<NormalizedHealth> {
      const health = await snapshot();
      if (!health.ok) {
        throw new ScryError("DAEMON_UNAVAILABLE", "Daemon reports it is not ok", true, {
          kind: "not_ok",
        });
      }
      if (health.apiVersion !== DAEMON_API_VERSION) {
        throw new ScryError(
          "INCOMPATIBLE_DAEMON",
          `Requires ${DAEMON_API_VERSION}, found ${health.apiVersion ?? "unknown"}`,
          false,
        );
      }
      if (capability !== undefined && health.capabilities?.[capability] !== true) {
        throw new ScryError(
          "CAPABILITY_UNAVAILABLE",
          `Daemon does not advertise the required "${capability}" capability`,
          true,
        );
      }
      return health;
    },
  };
}
