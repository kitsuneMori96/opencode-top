import Decimal from "decimal.js";
import { TokenUsage } from "./types";
import type { Session, Workflow, ToolUsage, ModelPricing, OverviewStats } from "./types";
import type { MessagePart } from "./types";

export function getSessionTokens(session: Session): TokenUsage {
  return session.interactions.reduce((acc, i) => acc.add(i.tokens), new TokenUsage());
}

export function getSessionCost(session: Session, pricing: Map<string, ModelPricing>): Decimal {
  return session.interactions.reduce((acc, i) => {
    const p = pricing.get(i.modelId);
    if (!p) return acc;
    return acc.plus(i.tokens.calculateCost(p));
  }, new Decimal(0));
}

export function getSessionCostSingle(session: Session, pricing: ModelPricing): Decimal {
  return session.interactions.reduce((acc, i) => {
    return acc.plus(i.tokens.calculateCost(pricing));
  }, new Decimal(0));
}

export function getSessionDuration(session: Session): number {
  const interactions = session.interactions;
  if (interactions.length === 0) return 0;

  // Use real time.completed when available
  const times: number[] = [];
  for (const i of interactions) {
    if (i.time.created !== null) times.push(i.time.created);
    if (i.time.completed !== null) times.push(i.time.completed);
  }

  if (times.length === 0) return 0;
  return Math.max(...times) - Math.min(...times);
}

export function getWorkflowTokens(workflow: Workflow): TokenUsage {
  const main = getSessionTokens(workflow.mainSession);
  const subs = workflow.subAgentSessions.reduce(
    (acc, s) => acc.add(getSessionTokens(s)),
    new TokenUsage()
  );
  return main.add(subs);
}

export function getWorkflowCost(workflow: Workflow, pricing: Map<string, ModelPricing>): Decimal {
  const main = getSessionCost(workflow.mainSession, pricing);
  const subs = workflow.subAgentSessions.reduce(
    (acc, s) => acc.plus(getSessionCost(s, pricing)),
    new Decimal(0)
  );
  return main.plus(subs);
}

export function getWorkflowCostSingle(workflow: Workflow, pricing: ModelPricing): Decimal {
  const main = getSessionCostSingle(workflow.mainSession, pricing);
  const subs = workflow.subAgentSessions.reduce(
    (acc, s) => acc.plus(getSessionCostSingle(s, pricing)),
    new Decimal(0)
  );
  return main.plus(subs);
}

export function getToolUsage(session: Session): ToolUsage[] {
  const tools = new Map<
    string,
    { calls: number; successes: number; failures: number; totalDurationMs: number; recentErrors: string[] }
  >();

  for (const interaction of session.interactions) {
    for (const part of interaction.parts) {
      if (part.type !== "tool") continue;

      const existing = tools.get(part.toolName) ?? {
        calls: 0,
        successes: 0,
        failures: 0,
        totalDurationMs: 0,
        recentErrors: [],
      };

      existing.calls++;
      if (part.status === "completed") {
        existing.successes++;
      } else if (part.status === "error") {
        existing.failures++;
        // Keep last 3 errors
        if (existing.recentErrors.length < 3) {
          existing.recentErrors.push(part.output?.slice(0, 200) ?? "unknown error");
        }
      }

      const durationMs = part.timeEnd > 0 && part.timeStart > 0 ? part.timeEnd - part.timeStart : 0;
      existing.totalDurationMs += durationMs;

      tools.set(part.toolName, existing);
    }
  }

  return Array.from(tools.entries()).map(([name, stats]) => ({
    name,
    calls: stats.calls,
    successes: stats.successes,
    failures: stats.failures,
    totalDurationMs: stats.totalDurationMs,
    avgDurationMs: stats.calls > 0 ? stats.totalDurationMs / stats.calls : 0,
    recentErrors: stats.recentErrors,
  }));
}

export function getWorkflowToolUsage(workflow: Workflow): ToolUsage[] {
  const allSessions = [workflow.mainSession, ...workflow.subAgentSessions];
  const merged = new Map<
    string,
    { calls: number; successes: number; failures: number; totalDurationMs: number; recentErrors: string[] }
  >();

  for (const session of allSessions) {
    const usage = getToolUsage(session);
    for (const tool of usage) {
      const existing = merged.get(tool.name) ?? {
        calls: 0,
        successes: 0,
        failures: 0,
        totalDurationMs: 0,
        recentErrors: [],
      };
      existing.calls += tool.calls;
      existing.successes += tool.successes;
      existing.failures += tool.failures;
      existing.totalDurationMs += tool.totalDurationMs;
      for (const err of tool.recentErrors) {
        if (existing.recentErrors.length < 3) existing.recentErrors.push(err);
      }
      merged.set(tool.name, existing);
    }
  }

  return Array.from(merged.entries()).map(([name, stats]) => ({
    name,
    calls: stats.calls,
    successes: stats.successes,
    failures: stats.failures,
    totalDurationMs: stats.totalDurationMs,
    avgDurationMs: stats.calls > 0 ? stats.totalDurationMs / stats.calls : 0,
    recentErrors: stats.recentErrors,
  }));
}

export function getOutputRate(session: Session): number {
  const rates = session.interactions
    .map((i) => i.outputRate)
    .filter((r) => r > 0)
    .sort((a, b) => a - b);

  if (rates.length === 0) return 0;

  const mid = Math.floor(rates.length / 2);
  return rates.length % 2 !== 0 ? rates[mid] : (rates[mid - 1] + rates[mid]) / 2;
}

export function computeOverviewStats(
  workflows: Workflow[],
  pricing: Map<string, ModelPricing>,
  cutoff: number = 0,
): OverviewStats {
  const totalTokens = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0 };
  let totalCost = new Decimal(0);
  const modelBreakdown = new Map<string, { cost: Decimal; tokens: number; calls: number }>();
  const projectBreakdown = new Map<string, { cost: Decimal; sessions: number }>();
  const agentBreakdown = new Map<string, { cost: Decimal; calls: number }>();
  const agentToolErrors = new Map<string, { calls: number; errors: number }>();
  const toolCallCounts = new Map<string, { calls: number; errors: number; totalDurationMs: number }>();
  const tokenPoints: [number, number][] = [];
  const sessionPoints: [number, number][] = [];
  const hourlyActivity = new Array(24).fill(0);

  const now = Date.now();

  for (const workflow of workflows) {
    const allSessions = [workflow.mainSession, ...workflow.subAgentSessions];

    for (const session of allSessions) {
      const projName = session.projectName ?? "Unknown";
      const projEntry = projectBreakdown.get(projName) ?? { cost: new Decimal(0), sessions: 0 };

      let sessionActive = false;
      for (const interaction of session.interactions) {
        // Skip interactions outside time window
        if (cutoff > 0 && (interaction.time.created === null || interaction.time.created < cutoff)) continue;
        sessionActive = true;
      }

      if (!sessionActive) continue;

      projEntry.sessions++;
      const sessionTs = session.timeUpdated ?? session.timeCreated;
      if (sessionTs) sessionPoints.push([sessionTs, 1]);

      for (const interaction of session.interactions) {
        // Skip interactions outside time window
        if (cutoff > 0 && (interaction.time.created === null || interaction.time.created < cutoff)) continue;

        const p = pricing.get(interaction.modelId);
        const cost = p ? interaction.tokens.calculateCost(p) : new Decimal(0);

        totalCost = totalCost.plus(cost);
        projEntry.cost = projEntry.cost.plus(cost);

        totalTokens.input += interaction.tokens.input;
        totalTokens.output += interaction.tokens.output;
        totalTokens.cacheRead += interaction.tokens.cacheRead;
        totalTokens.cacheWrite += interaction.tokens.cacheWrite;
        totalTokens.reasoning += interaction.tokens.reasoning;

        // Model breakdown
        const modelEntry = modelBreakdown.get(interaction.modelId) ?? {
          cost: new Decimal(0),
          tokens: 0,
          calls: 0,
        };
        modelEntry.cost = modelEntry.cost.plus(cost);
        modelEntry.tokens += interaction.tokens.total;
        modelEntry.calls++;
        modelBreakdown.set(interaction.modelId, modelEntry);

        // Agent breakdown
        const agentKey = interaction.agent ?? "main";
        const agentEntry = agentBreakdown.get(agentKey) ?? { cost: new Decimal(0), calls: 0 };
        agentEntry.cost = agentEntry.cost.plus(cost);
        agentEntry.calls++;
        agentBreakdown.set(agentKey, agentEntry);

        // Hourly activity
        const ts = interaction.time.created;
        if (ts) {
          hourlyActivity[new Date(ts).getHours()]++;

          // Token trend (cutoff-based)
          tokenPoints.push([ts, interaction.tokens.total]);
        }

        // Tool stats: per-tool call counts and agent tool errors
        for (const part of interaction.parts) {
          if (part.type !== "tool") continue;

          const isError = part.status === "error";
          const dur = part.timeEnd > 0 && part.timeStart > 0 ? part.timeEnd - part.timeStart : 0;

          // Tool call counts
          const toolEntry = toolCallCounts.get(part.toolName) ?? { calls: 0, errors: 0, totalDurationMs: 0 };
          toolEntry.calls++;
          if (isError) toolEntry.errors++;
          toolEntry.totalDurationMs += dur;
          toolCallCounts.set(part.toolName, toolEntry);

          // Agent tool errors
          const agentToolEntry = agentToolErrors.get(agentKey) ?? { calls: 0, errors: 0 };
          agentToolEntry.calls++;
          if (isError) agentToolEntry.errors++;
          agentToolErrors.set(agentKey, agentToolEntry);
        }
      }

      projectBreakdown.set(projName, projEntry);
    }
  }

  const tokenTrend = buildTrendBuckets(tokenPoints, cutoff, now);
  const sessionTrend = buildTrendBuckets(sessionPoints, cutoff, now);

  return {
    totalCost,
    totalTokens: new TokenUsage(
      totalTokens.input,
      totalTokens.output,
      totalTokens.cacheRead,
      totalTokens.cacheWrite,
      totalTokens.reasoning
    ),
    modelBreakdown,
    projectBreakdown,
    agentBreakdown,
    agentToolErrors,
    toolCallCounts,
    tokenTrend,
    sessionTrend,
    hourlyActivity,
  };
}

/** Build adaptive trend buckets from timestamp → value pairs */
export function buildTrendBuckets(points: [number, number][], cutoff: number, now: number) {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  let start: number;
  let mode: "hour" | "day" | "week";

  if (cutoff > 0 && cutoff === todayStart.getTime()) {
    start = cutoff;
    mode = "hour";
  } else if (cutoff > 0) {
    start = cutoff;
    mode = "day";
  } else {
    let min = now;
    for (const [ts] of points) if (ts && ts < min) min = ts;
    const d = new Date(min);
    d.setHours(0, 0, 0, 0);
    start = Math.min(d.getTime(), todayStart.getTime());
    mode = "day";
  }

  const days = Math.max(1, Math.floor((now - start) / 864e5) + 1);

  let count: number;
  let bucketMs: number;

  if (mode === "hour") {
    count = 24;
    bucketMs = 36e5;
  } else if (days <= 120) {
    count = days;
    bucketMs = 864e5;
  } else {
    mode = "week";
    count = Math.ceil(days / 7);
    bucketMs = 7 * 864e5;
  }

  const buckets = new Array(count).fill(0);
  const labels: string[] = [];
  for (let i = 0; i < count; i++) {
    const t = start + i * bucketMs;
    const d = new Date(t);
    if (mode === "hour") {
      labels.push(String(d.getHours()).padStart(2, "0"));
    } else if (mode === "week") {
      const m = d.toLocaleDateString("en", { month: "short" });
      const dd = d.getDate();
      labels.push(`${m} ${dd}`);
    } else {
      const m = String(d.getMonth() + 1).padStart(2, "0");
      const dd = String(d.getDate()).padStart(2, "0");
      labels.push(`${m}-${dd}`);
    }
  }

  for (const [ts, val] of points) {
    if (ts < start) continue;
    let idx = Math.floor((ts - start) / bucketMs);
    if (idx < 0) idx = 0;
    if (idx >= count) idx = count - 1;
    buckets[idx] += val;
  }

  // Thin labels: show first, last, every ~8th
  const thinned: string[] = [];
  const step = Math.max(1, Math.ceil(count / 8));
  for (let i = 0; i < count; i++) {
    if (i === 0 || i === count - 1 || i % step === 0) {
      thinned.push(labels[i]);
    } else {
      thinned.push("");
    }
  }

  const spanText = mode === "hour"
    ? "today"
    : mode === "week"
    ? `${days}d`
    : `${days}d`;

  return { labels: thinned, values: buckets, mode, spanText };
}

/** Build spark series (8 levels) from numeric array */
export function buildSparkSeries(values: number[]): string {
  if (values.length === 0) return "";
  const max = Math.max(...values);
  if (max === 0) return "▁".repeat(values.length);
  const chars = ["▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"];
  return values
    .map((v) => {
      const idx = Math.min(7, Math.floor((v / max) * 8));
      return chars[idx];
    })
    .join("");
}

/** All parts across all interactions in a session */
export function getAllParts(session: Session): MessagePart[] {
  return session.interactions.flatMap((i) => i.parts);
}
