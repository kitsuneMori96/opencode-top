import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadSessions, sessionExists } from "../data/sqlite";

let dir: string;

function makeAssistantData(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    time: { created: 1100, completed: 1300 },
    agent: "build",
    model: { id: "claude-sonnet-4-20250514", providerID: "anthropic" },
    finish: "tool-calls",
    cost: 0.01,
    tokens: { input: 100, output: 50, reasoning: 10, cache: { read: 20, write: 5 } },
    content: [
      { type: "reasoning", text: "thinking", time: { created: 1100, completed: 1150 } },
      {
        type: "tool",
        id: "call_1",
        name: "bash",
        state: {
          status: "completed",
          input: { command: "echo hi" },
          metadata: { output: "hi\n", exit: 0, truncated: false },
        },
        time: { created: 1150, completed: 1250 },
      },
      {
        type: "tool",
        id: "call_2",
        name: "read",
        state: { status: "error", input: { filePath: "/x" }, error: { type: "tool.execution", message: "cannot read" } },
        time: { created: 1250, completed: 1260 },
      },
    ],
    ...overrides,
  });
}

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "octop-v2-"));
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("loadSessions (OpenCode v2 schema)", () => {
  it("reads session_v2 / session_message and embeds parts", () => {
    const dbPath = join(dir, "v2.db");
    const db = new DatabaseSync(dbPath);
    db.exec(`
      CREATE TABLE project (id text PRIMARY KEY, worktree text NOT NULL, name text);
      CREATE TABLE session_v2 (
        id text PRIMARY KEY, project_id text NOT NULL, parent_id text,
        title text, time_created integer NOT NULL, time_updated integer NOT NULL,
        time_archived integer
      );
      CREATE TABLE session_message (
        id text PRIMARY KEY, session_id text NOT NULL, type text NOT NULL,
        seq integer NOT NULL, time_created integer NOT NULL,
        time_updated integer NOT NULL, data text NOT NULL
      );
    `);
    db.prepare("INSERT INTO project VALUES (?, ?, ?)").run("p1", "/home/me/myproj", null);
    db.prepare("INSERT INTO session_v2 VALUES (?, ?, ?, ?, ?, ?, ?)").run(
      "ses_root", "p1", null, "Root session", 1000, 2000, null
    );
    db.prepare("INSERT INTO session_v2 VALUES (?, ?, ?, ?, ?, ?, ?)").run(
      "ses_child", "p1", "ses_root", "Child session", 1000, 1500, null
    );
    db.prepare("INSERT INTO session_message VALUES (?, ?, ?, ?, ?, ?, ?)").run(
      "msg_1", "ses_root", "assistant", 1, 1200, 1300, makeAssistantData()
    );
    db.prepare("INSERT INTO session_message VALUES (?, ?, ?, ?, ?, ?, ?)").run(
      "msg_u", "ses_root", "user", 2, 1400, 1400, JSON.stringify({ time: { created: 1400 }, text: "hi" })
    );
    db.close();

    expect(sessionExists(dbPath)).toBe(true);

    const { sessions, maxMessageTime } = loadSessions(dbPath);
    expect(sessions).toHaveLength(2);
    expect(maxMessageTime).toBe(1400);

    const root = sessions.find((s) => s.id === "ses_root")!;
    expect(root.projectName).toBe("myproj"); // falls back to worktree basename
    expect(root.title).toBe("Root session");
    // user messages are not interactions (only assistant turns carry usage)
    expect(root.interactions).toHaveLength(1);

    const interaction = root.interactions[0];
    expect(interaction.role).toBe("assistant");
    // normalizeModelName() strips the trailing date suffix
    expect(interaction.modelId).toBe("claude-sonnet-4");
    expect(interaction.providerId).toBe("anthropic");
    expect(interaction.agent).toBe("build");
    expect(interaction.finishReason).toBe("tool-calls");
    expect(interaction.tokens.input).toBe(100);
    expect(interaction.tokens.output).toBe(50);
    expect(interaction.tokens.reasoning).toBe(10);
    expect(interaction.tokens.cacheRead).toBe(20);
    expect(interaction.tokens.cacheWrite).toBe(5);
    // 50 output tokens over 0.2s
    expect(interaction.outputRate).toBeCloseTo(250);

    const parts = interaction.parts;
    expect(parts.map((p) => p.type)).toEqual(["reasoning", "tool", "tool"]);
    const bash = parts[1] as Extract<(typeof parts)[number], { type: "tool" }>;
    expect(bash.toolName).toBe("bash");
    expect(bash.status).toBe("completed");
    expect(bash.output).toBe("hi\n");
    expect(bash.exitCode).toBe(0);
    expect(bash.timeStart).toBe(1150);
    expect(bash.timeEnd).toBe(1250);
    const read = parts[2] as Extract<(typeof parts)[number], { type: "tool" }>;
    expect(read.status).toBe("error");
    expect(read.output).toBe("cannot read");

    // v2 message parts are embedded, no separate `part` table
    const noParts = dbCheck(dbPath);
    expect(noParts).toBe(false);
  });

  it("recognises child sessions via parent_id", () => {
    const dbPath = join(dir, "v2.db");
    const { sessions } = loadSessions(dbPath);
    const child = sessions.find((s) => s.id === "ses_child")!;
    expect(child.parentId).toBe("ses_root");
  });
});

describe("loadSessions (OpenCode v1 schema)", () => {
  it("falls back to the legacy tables when session_v2 is absent", () => {
    const dbPath = join(dir, "v1.db");
    const db = new DatabaseSync(dbPath);
    db.exec(`
      CREATE TABLE project (id text PRIMARY KEY, worktree text NOT NULL, name text);
      CREATE TABLE session (
        id text PRIMARY KEY, project_id text NOT NULL, parent_id text, title text,
        time_created integer NOT NULL, time_updated integer NOT NULL, time_archived integer
      );
      CREATE TABLE message (
        id text PRIMARY KEY, session_id text NOT NULL, time_created integer NOT NULL,
        time_updated integer NOT NULL, data text NOT NULL
      );
      CREATE TABLE part (
        id text PRIMARY KEY, message_id text NOT NULL, session_id text NOT NULL,
        time_created integer NOT NULL, time_updated integer NOT NULL, data text NOT NULL
      );
    `);
    db.prepare("INSERT INTO project VALUES (?, ?, ?)").run("p1", "/home/me/legacy", "Legacy");
    db.prepare("INSERT INTO session VALUES (?, ?, ?, ?, ?, ?, ?)").run(
      "ses_v1", "p1", null, "Old session", 500, 900, null
    );
    db.prepare("INSERT INTO message VALUES (?, ?, ?, ?, ?)").run(
      "msg_v1", "ses_v1", 600, 700,
      JSON.stringify({
        role: "assistant",
        agent: "plan",
        modelID: "claude-3-5-sonnet-20241022",
        providerID: "anthropic",
        time: { created: 600, completed: 700 },
        tokens: { input: 10, output: 5, cache: { read: 1, write: 0 } },
      })
    );
    db.prepare("INSERT INTO part VALUES (?, ?, ?, ?, ?, ?)").run(
      "prt_v1", "msg_v1", "ses_v1", 650, 660,
      JSON.stringify({ type: "text", text: "hello", time: { start: 650, end: 660 } })
    );
    db.close();

    expect(sessionExists(dbPath)).toBe(true);

    const { sessions } = loadSessions(dbPath);
    expect(sessions).toHaveLength(1);
    expect(sessions[0].projectName).toBe("Legacy");
    expect(sessions[0].interactions).toHaveLength(1);
    expect(sessions[0].interactions[0].tokens.input).toBe(10);
    expect(sessions[0].interactions[0].parts[0].type).toBe("text");
  });
});

/** Returns true if a `part` table exists in the given db. */
function dbCheck(dbPath: string): boolean {
  const db = new DatabaseSync(dbPath);
  const row = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='part'")
    .get();
  db.close();
  return Boolean(row);
}
