import { ScryError } from "./errors.js";

export type SessionRecord = {
  id: string;
  projectRoot: string;
  harness: string;
  status: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  familiarId: string | null;
  conversationId: string | null;
  exitCode: number | null;
  archivedAt: string | null;
  labels: string[];
  visibility: string;
  external: boolean;
  transcriptPath: string | null;
};

export type ListSessionsResult = {
  sessions: SessionRecord[];
  nextCursor: string | null;
  hasMore: boolean;
};

export type HarnessSkill = {
  id: string;
  name: string;
  source: string;
  harnessId: string;
  path: string;
  description?: string;
  version?: string;
  tags: string[];
};

export type HarnessPlugin = {
  id: string;
  name: string;
  source: string;
  harnessId: string;
  kind: string;
  enabled: boolean;
  transport?: string;
  command?: string;
  args?: string[];
};

export type CapabilityWarning = {
  kind: string;
  path: string;
  message: string;
};

export type HarnessSummary = {
  harnessId: string;
  globalInstructions: { present: boolean; path?: string; byteCount?: number };
  plugins: HarnessPlugin[];
  skills: HarnessSkill[];
  warnings: CapabilityWarning[];
  scannedAt: string;
};

export type CovenSkill = {
  id: string;
  name: string;
  owner: string;
  category: string;
  tags: string[];
  score: number;
  effectiveRate: number;
  appliedRate: number;
  completionRate: number;
  fallbackRate: number;
  version: string;
  description: string;
};

export type ListHarnessesResult = {
  harnesses: HarnessSummary[];
  covenSkills: CovenSkill[];
  scannedAt: string;
};

function schemaError(kind: string): ScryError {
  return new ScryError("UPSTREAM_ERROR", "Daemon response has an unexpected shape", false, {
    kind,
  });
}

function asRecord(value: unknown, kind: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw schemaError(kind);
  return value as Record<string, unknown>;
}

function requireString(record: Record<string, unknown>, key: string, kind: string): string {
  const value = record[key];
  if (typeof value !== "string") throw schemaError(kind);
  return value;
}

function optionalNullable<T>(value: unknown, check: (v: unknown) => v is T): T | null {
  return value !== undefined && value !== null && check(value) ? value : null;
}

const isString = (v: unknown): v is string => typeof v === "string";
const isNumber = (v: unknown): v is number => typeof v === "number";

export function normalizeSessionRecord(raw: unknown): SessionRecord {
  const kind = "invalid_session_record";
  const record = asRecord(raw, kind);
  return {
    id: requireString(record, "id", kind),
    projectRoot: requireString(record, "project_root", kind),
    harness: requireString(record, "harness", kind),
    status: requireString(record, "status", kind),
    title: typeof record["title"] === "string" ? record["title"] : "",
    createdAt: requireString(record, "created_at", kind),
    updatedAt: requireString(record, "updated_at", kind),
    familiarId: optionalNullable(record["familiar_id"], isString),
    conversationId: optionalNullable(record["conversation_id"], isString),
    exitCode: optionalNullable(record["exit_code"], isNumber),
    archivedAt: optionalNullable(record["archived_at"], isString),
    labels: Array.isArray(record["labels"]) ? record["labels"].filter(isString) : [],
    visibility: typeof record["visibility"] === "string" ? record["visibility"] : "private",
    external: record["external"] === true,
    transcriptPath: optionalNullable(record["transcript_path"], isString),
  };
}

export function normalizeListSessions(raw: unknown): ListSessionsResult {
  if (Array.isArray(raw)) {
    return { sessions: raw.map(normalizeSessionRecord), nextCursor: null, hasMore: false };
  }
  const kind = "invalid_sessions_list";
  const record = asRecord(raw, kind);
  const sessions = record["sessions"];
  if (!Array.isArray(sessions)) throw schemaError(kind);
  const nextCursor = optionalNullable(record["next_cursor"], isString);
  return {
    sessions: sessions.map(normalizeSessionRecord),
    nextCursor,
    hasMore: nextCursor !== null,
  };
}

function normalizeSkill(raw: unknown): HarnessSkill {
  const kind = "invalid_harness_skill";
  const record = asRecord(raw, kind);
  const skill: HarnessSkill = {
    id: requireString(record, "id", kind),
    name: requireString(record, "name", kind),
    source: typeof record["source"] === "string" ? record["source"] : "",
    harnessId: requireString(record, "harness_id", kind),
    path: typeof record["path"] === "string" ? record["path"] : "",
    tags: Array.isArray(record["tags"]) ? record["tags"].filter(isString) : [],
  };
  if (typeof record["description"] === "string") skill.description = record["description"];
  if (typeof record["version"] === "string") skill.version = record["version"];
  return skill;
}

function normalizePlugin(raw: unknown): HarnessPlugin {
  const kind = "invalid_harness_plugin";
  const record = asRecord(raw, kind);
  const plugin: HarnessPlugin = {
    id: requireString(record, "id", kind),
    name: requireString(record, "name", kind),
    source: typeof record["source"] === "string" ? record["source"] : "",
    harnessId: requireString(record, "harness_id", kind),
    kind: typeof record["kind"] === "string" ? record["kind"] : "",
    enabled: record["enabled"] === true,
  };
  if (typeof record["transport"] === "string") plugin.transport = record["transport"];
  if (typeof record["command"] === "string") plugin.command = record["command"];
  if (Array.isArray(record["args"])) plugin.args = record["args"].filter(isString);
  return plugin;
}

function normalizeWarning(raw: unknown): CapabilityWarning {
  const kind = "invalid_capability_warning";
  const record = asRecord(raw, kind);
  return {
    kind: typeof record["kind"] === "string" ? record["kind"] : "unknown",
    path: typeof record["path"] === "string" ? record["path"] : "",
    message: typeof record["message"] === "string" ? record["message"] : "",
  };
}

function normalizeHarnessSummary(raw: unknown): HarnessSummary {
  const kind = "invalid_harness_summary";
  const record = asRecord(raw, kind);
  const gi = asRecord(record["global_instructions"] ?? {}, kind);
  const globalInstructions: HarnessSummary["globalInstructions"] = {
    present: gi["present"] === true,
  };
  if (typeof gi["path"] === "string") globalInstructions.path = gi["path"];
  if (typeof gi["byte_count"] === "number") globalInstructions.byteCount = gi["byte_count"];
  return {
    harnessId: requireString(record, "harness_id", kind),
    globalInstructions,
    plugins: Array.isArray(record["plugins"]) ? record["plugins"].map(normalizePlugin) : [],
    skills: Array.isArray(record["skills"]) ? record["skills"].map(normalizeSkill) : [],
    warnings: Array.isArray(record["warnings"]) ? record["warnings"].map(normalizeWarning) : [],
    scannedAt: typeof record["scanned_at"] === "string" ? record["scanned_at"] : "",
  };
}

function normalizeCovenSkill(raw: unknown): CovenSkill {
  const kind = "invalid_coven_skill";
  const record = asRecord(raw, kind);
  const num = (key: string): number =>
    typeof record[key] === "number" ? (record[key] as number) : 0;
  return {
    id: requireString(record, "id", kind),
    name: typeof record["name"] === "string" ? record["name"] : "",
    owner: typeof record["owner"] === "string" ? record["owner"] : "",
    category: typeof record["category"] === "string" ? record["category"] : "",
    tags: Array.isArray(record["tags"]) ? record["tags"].filter(isString) : [],
    score: num("score"),
    effectiveRate: num("effective_rate"),
    appliedRate: num("applied_rate"),
    completionRate: num("completion_rate"),
    fallbackRate: num("fallback_rate"),
    version: typeof record["version"] === "string" ? record["version"] : "",
    description: typeof record["description"] === "string" ? record["description"] : "",
  };
}

export type MemoryEntry = {
  id: string;
  familiarId: string;
  title: string;
  path: string;
  updatedAt: string;
  updatedAtIso: string;
  excerpt: string;
  excerptRedacted: boolean;
  source: { kind: string; label: string };
  privacyClassification?: string | null;
  revealRequired?: boolean | null;
  verificationState: string;
};

export type MemoryListResult = { entries: MemoryEntry[] };

export type MemoryPolicy = { includeExcerpts: boolean };

/**
 * FR-9 excerpt policy: excerpts are blanked unless explicitly opted in, and
 * even then revealRequired or any non-null classification other than "public"
 * forces redaction. `excerptRedacted` is true exactly when scry blanked a
 * non-empty daemon-provided excerpt.
 */
function normalizeMemoryEntry(raw: unknown, policy: MemoryPolicy): MemoryEntry {
  const kind = "invalid_memory_entry";
  const record = asRecord(raw, kind);
  const sourceRaw = record["source"];
  const source =
    typeof sourceRaw === "object" && sourceRaw !== null
      ? (sourceRaw as Record<string, unknown>)
      : {};
  const daemonExcerpt = typeof record["excerpt"] === "string" ? record["excerpt"] : "";
  const revealRequired =
    record["reveal_required"] === true ? true : record["reveal_required"] === false ? false : null;
  const classification =
    typeof record["privacy_classification"] === "string" ? record["privacy_classification"] : null;
  const disclosable =
    policy.includeExcerpts &&
    revealRequired !== true &&
    (classification === null || classification === "public");
  const excerpt = disclosable ? daemonExcerpt : "";
  return {
    id: requireString(record, "id", kind),
    familiarId: typeof record["familiar_id"] === "string" ? record["familiar_id"] : "",
    title: typeof record["title"] === "string" ? record["title"] : "",
    path: typeof record["path"] === "string" ? record["path"] : "",
    updatedAt: typeof record["updated_at"] === "string" ? record["updated_at"] : "",
    updatedAtIso: typeof record["updated_at_iso"] === "string" ? record["updated_at_iso"] : "",
    excerpt,
    excerptRedacted: daemonExcerpt !== "" && excerpt === "",
    source: {
      kind: typeof source["kind"] === "string" ? source["kind"] : "",
      label: typeof source["label"] === "string" ? source["label"] : "",
    },
    privacyClassification: classification,
    revealRequired,
    verificationState:
      typeof record["verification_state"] === "string" ? record["verification_state"] : "",
  };
}

export function normalizeMemoryList(raw: unknown, policy: MemoryPolicy): MemoryListResult {
  // Live-verified Aug 4: the route returns a bare array; tolerate an
  // `entries` envelope as an additive upstream change (FR-34).
  const list = Array.isArray(raw)
    ? raw
    : (() => {
        const record = asRecord(raw, "invalid_memory_list");
        const entries = record["entries"];
        if (!Array.isArray(entries)) throw schemaError("invalid_memory_list");
        return entries;
      })();
  return { entries: list.map((entry) => normalizeMemoryEntry(entry, policy)) };
}

export type AckResult = { ok: boolean; accepted: boolean };

/** Ack shape for input/kill. `accepted` defaults to `ok` when upstream omits it. */
export function normalizeAck(raw: unknown): AckResult {
  const record = asRecord(raw, "invalid_ack");
  const ok = record["ok"] === true;
  const accepted = record["accepted"] === undefined ? ok : record["accepted"] === true;
  return { ok, accepted };
}

export function normalizeHarnesses(raw: unknown): ListHarnessesResult {
  const kind = "invalid_harnesses_payload";
  const record = asRecord(raw, kind);
  const capabilities = record["harness_capabilities"];
  if (!Array.isArray(capabilities)) throw schemaError(kind);
  const covenSkills = record["coven_skills"];
  return {
    harnesses: capabilities.map(normalizeHarnessSummary),
    covenSkills: Array.isArray(covenSkills) ? covenSkills.map(normalizeCovenSkill) : [],
    scannedAt: typeof record["scanned_at"] === "string" ? record["scanned_at"] : "",
  };
}
