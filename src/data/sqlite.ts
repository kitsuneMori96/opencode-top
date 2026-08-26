import { DatabaseSync, type StatementSync } from "node:sqlite";
import { z } from "zod";
import { TokenUsage, type Session, type Interaction, type MessagePart } from "../core/types";
import * as os from "node:os";
import * as path from "node:path";

interface DbSession {
  id: string;
  parent_id: string | null;
  project_id: string | null;
  title: string | null;
  time_created: number | null;
  time_updated: number | null;
  time_archived: number | null;
  project_name: string | null;
}

interface DbMessage {
  id: string;
  session_id: string;
  data: string;
  time_created: number;
}

interface DbPart {
  message_id: string;
  session_id: string;
  data: string;
}

const MessageDataSchema = z.object({
  id: z.string().optional(),
  parentID: z.string().optional(),
  role: z.enum(["assistant", "user"]).optional(),
  agent: z.string().optional(),
  mode: z.string().optional(),
  modelID: z.string().optional(),
  providerID: z.string().optional(),
  time: z.object({
    created: z.number().optional(),
    completed: z.number().optional(),
  }).optional(),
  tokens: z.object({
    input: z.number().optional(),
    output: z.number().optional(),
    reasoning: z.number().optional(),
    cache: z.object({
      read: z.number().optional(),
      write: z.number().optional(),
    }).optional(),
  }).optional(),
  cost: z.number().optional(),
  finish: z.string().optional(),
  usage: z.object({
    input_tokens: z.number().optional(),
    output_tokens: z.number().optional(),
    cache_read_input_tokens: z.number().optional(),
    cache_write_input_tokens: z.number().optional(),
  }).optional(),
  model: z.string().optional(),
  stop_reason: z.string().optional(),
}).passthrough();

type RealMessageData = z.infer<typeof MessageDataSchema>;

const PartDataSchema = z.object({
  type: z.string().optional(),
  text: z.string().optional(),
  time: z.object({
    start: z.number().optional(),
    end: z.number().optional(),
  }).optional(),
  callID: z.string().optional(),
  tool: z.string().optional(),
  state: z.object({
    status: z.string().optional(),
    input: z.record(z.unknown()).optional(),
    output: z.string().optional(),
    title: z.string().optional(),
    time: z.object({
      start: z.number().optional(),
      end: z.number().optional(),
    }).optional(),
    metadata: z.object({
      exit: z.number().optional(),
      exitCode: z.number().optional(),
      truncated: z.boolean().optional(),
    }).optional(),
  }).optional(),
  hash: z.string().optional(),
  files: z.array(z.string()).optional(),
}).passthrough();

type RealPartData = z.infer<typeof PartDataSchema>;

export function getDbPath(): string {
  return path.join(os.homedir(), ".local", "share", "opencode", "opencode.db");
}

export function loadSessions(dbPath: string = getDbPath(), sinceMessageTime?: number): { sessions: Session[]; maxMessageTime: number } {
  const db = new DatabaseSync(dbPath);

  const sessions = db
    .prepare(`
    SELECT
      s.id, s.parent_id, s.project_id, s.title,
      s.time_created, s.time_updated, s.time_archived,
      p.name as project_name
    FROM session s
    LEFT JOIN project p ON s.project_id = p.id
    ORDER BY COALESCE(NULLIF(s.time_updated, 0), s.time_created) DESC
  `)
    .all() as DbSession[];

  let sessionIds: string[];
  if (sinceMessageTime !== undefined) {
    // Only reload sessions that have messages newer than sinceMessageTime
    const updatedSessionIds = db
      .prepare(`SELECT DISTINCT session_id FROM message WHERE time_created > ?`)
      .all(sinceMessageTime) as { session_id: string }[];
    const updatedSet = new Set(updatedSessionIds.map((r) => r.session_id));
    sessionIds = sessions.filter((s) => updatedSet.has(s.id)).map((s) => s.id);
  } else {
    sessionIds = sessions.map((s) => s.id);
  }

  const interactions = loadInteractions(db, sessionIds);

  const maxTimeRow = db
    .prepare(`SELECT MAX(time_created) as maxTime FROM message`)
    .get() as { maxTime: number | null };
  const maxMessageTime = maxTimeRow?.maxTime ?? 0;

  db.close();

  // On incremental load, only return sessions that actually had new data loaded.
  // Returning all sessions with interactions.get(s.id) ?? [] would wipe interactions
  // for sessions that weren't in the incremental query.
  const sessionsToReturn = sinceMessageTime !== undefined
    ? sessions.filter((s) => interactions.has(s.id))
    : sessions;

  return {
    sessions: sessionsToReturn.map((s) => ({
      id: s.id,
      parentId: s.parent_id,
      projectId: s.project_id,
      projectName: s.project_name,
      title: s.title,
      timeCreated: s.time_created,
      timeUpdated: s.time_updated ?? null,
      timeArchived: s.time_archived,
      interactions: interactions.get(s.id) ?? [],
      source: "sqlite" as const,
    })),
    maxMessageTime,
  };
}

function loadInteractions(
  db: DatabaseSync,
  sessionIds: string[]
): Map<string, Interaction[]> {
  const result = new Map<string, Interaction[]>();

  if (sessionIds.length === 0) return result;

  const placeholders = sessionIds.map(() => "?").join(",");

  const messages = db
    .prepare(`
    SELECT id, session_id, data, time_created
    FROM message
    WHERE session_id IN (${placeholders})
    ORDER BY time_created ASC
  `)
    .all(...sessionIds) as DbMessage[];

  if (messages.length === 0) return result;

  // Load all parts for these messages in one batch
  const messageIds = messages.map((m) => m.id);
  const partsByMessageId = loadParts(db, messageIds);

  for (const msg of messages) {
    if (!result.has(msg.session_id)) {
      result.set(msg.session_id, []);
    }

    const parts = partsByMessageId.get(msg.id) ?? [];
    const parsed = parseMessageData(msg.data, msg.id, msg.session_id, msg.time_created, parts);
    if (parsed) {
      result.get(msg.session_id)!.push(parsed);
    }
  }

  return result;
}

function loadParts(db: DatabaseSync, messageIds: string[]): Map<string, MessagePart[]> {
  const result = new Map<string, MessagePart[]>();

  if (messageIds.length === 0) return result;

  // Check if part table exists
  const tableExists = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='part'")
    .get();
  if (!tableExists) return result;

  const placeholders = messageIds.map(() => "?").join(",");
  let rows: DbPart[] = [];

  try {
    rows = db
      .prepare(`
      SELECT message_id, session_id, data
      FROM part
      WHERE message_id IN (${placeholders})
      ORDER BY rowid ASC
    `)
      .all(...messageIds) as DbPart[];
  } catch {
    // part table may have different schema
    return result;
  }

  for (const row of rows) {
    if (!result.has(row.message_id)) {
      result.set(row.message_id, []);
    }
    const part = parsePart(row.data);
    if (part) {
      result.get(row.message_id)!.push(part);
    }
  }

  return result;
}

function parsePart(data: string): MessagePart | null {
  try {
    const parsed = PartDataSchema.safeParse(JSON.parse(data));
    if (!parsed.success) return null;
    const json: RealPartData = parsed.data;
    const timeStart = json.time?.start ?? 0;
    const timeEnd = json.time?.end ?? 0;

    switch (json.type) {
      case "text":
        return {
          type: "text",
          text: json.text ?? "",
          timeStart,
          timeEnd,
        };

      case "tool": {
        const state = json.state ?? {};
        const status = normalizeToolStatus(state.status);
        // Timing lives in state.time, not top-level time
        const toolTimeStart = state.time?.start ?? timeStart;
        const toolTimeEnd = state.time?.end ?? timeEnd;
        return {
          type: "tool",
          callId: json.callID ?? "",
          toolName: json.tool ?? "unknown",
          status,
          input: state.input ?? {},
          output: state.output ?? "",
          title: state.title ?? null,
          exitCode: state.metadata?.exit ?? state.metadata?.exitCode ?? null,
          truncated: state.metadata?.truncated ?? false,
          timeStart: toolTimeStart,
          timeEnd: toolTimeEnd,
        };
      }

      case "reasoning":
        return {
          type: "reasoning",
          text: json.text ?? "",
          timeStart,
          timeEnd,
        };

      case "patch":
        return {
          type: "patch",
          hash: json.hash ?? "",
          files: json.files ?? [],
        };

      default:
        return null;
    }
  } catch {
    return null;
  }
}

function normalizeToolStatus(status: string | undefined): "completed" | "pending" | "error" {
  if (status === "completed") return "completed";
  if (status === "error") return "error";
  return "pending";
}

function parseMessageData(
  data: string,
  messageId: string,
  sessionId: string,
  timeCreated: number,
  parts: MessagePart[]
): Interaction | null {
  try {
    const parsed = MessageDataSchema.safeParse(JSON.parse(data));
    if (!parsed.success) return null;
    const json: RealMessageData = parsed.data;

    // Support both new schema (tokens.*) and legacy schema (usage.*)
    const newTokens = json.tokens;
    const legacyUsage = json.usage ?? {};

    const input = newTokens?.input ?? legacyUsage.input_tokens ?? 0;
    const output = newTokens?.output ?? legacyUsage.output_tokens ?? 0;
    const cacheRead = newTokens?.cache?.read ?? legacyUsage.cache_read_input_tokens ?? 0;
    const cacheWrite = newTokens?.cache?.write ?? legacyUsage.cache_write_input_tokens ?? 0;
    const reasoning = newTokens?.reasoning ?? 0;

    const timeCompleted = json.time?.completed ?? null;
    const timeDelta =
      timeCompleted && json.time?.created
        ? (timeCompleted - json.time.created) / 1000
        : null;
    const outputRate =
      output > 0 && timeDelta && timeDelta > 0 ? output / timeDelta : 0;

    const role = json.role ?? "assistant";

    // Only include interactions that have meaningful data (assistant messages with tokens)
    if (role !== "assistant" && input === 0 && output === 0) return null;

    return {
      id: messageId,
      sessionId,
      modelId: normalizeModelName(json.modelID ?? json.model ?? "unknown"),
      providerId: json.providerID ?? null,
      role,
      tokens: new TokenUsage(input, output, cacheRead, cacheWrite, reasoning),
      time: {
        created: json.time?.created ?? timeCreated,
        completed: timeCompleted,
      },
      agent: json.agent ?? null,
      finishReason: json.finish ?? json.stop_reason ?? null,
      outputRate,
      parts,
    };
  } catch {
    return null;
  }
}

function normalizeModelName(model: string): string {
  return model
    .replace(/-\d{8}$/, "")
    .replace(/:/g, "-")
    .toLowerCase();
}

export function sessionExists(dbPath: string = getDbPath()): boolean {
  try {
    const db = new DatabaseSync(dbPath);
    db.prepare("SELECT 1 FROM session LIMIT 1").get();
    db.close();
    return true;
  } catch {
    return false;
  }
}
