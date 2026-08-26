import Decimal from "decimal.js";

export class TokenUsage {
  constructor(
    readonly input: number = 0,
    readonly output: number = 0,
    readonly cacheRead: number = 0,
    readonly cacheWrite: number = 0,
    readonly reasoning: number = 0
  ) {}

  get total(): number {
    return this.input + this.output + this.cacheRead + this.cacheWrite;
  }

  add(other: TokenUsage): TokenUsage {
    return new TokenUsage(
      this.input + other.input,
      this.output + other.output,
      this.cacheRead + other.cacheRead,
      this.cacheWrite + other.cacheWrite,
      this.reasoning + other.reasoning
    );
  }

  calculateCost(pricing: ModelPricing): Decimal {
    const inputCost = new Decimal(this.input).mul(pricing.input).div(1_000_000);
    const outputCost = new Decimal(this.output).mul(pricing.output).div(1_000_000);
    const cacheReadCost = new Decimal(this.cacheRead).mul(pricing.cacheRead).div(1_000_000);
    const cacheWriteCost = new Decimal(this.cacheWrite).mul(pricing.cacheWrite).div(1_000_000);
    return inputCost.plus(outputCost).plus(cacheReadCost).plus(cacheWriteCost);
  }
}

export interface TimeData {
  created: number | null;
  completed: number | null;
}

// Part types from the `part` table
export type MessagePart =
  | {
      type: "text";
      text: string;
      timeStart: number;
      timeEnd: number;
    }
  | {
      type: "tool";
      callId: string;
      toolName: string;
      status: "completed" | "pending" | "error";
      input: Record<string, unknown>;
      output: string;
      title: string | null;
      exitCode: number | null;
      truncated: boolean;
      timeStart: number;
      timeEnd: number;
    }
  | {
      type: "reasoning";
      text: string;
      timeStart: number;
      timeEnd: number;
    }
  | {
      type: "patch";
      hash: string;
      files: string[];
    };

export interface Interaction {
  id: string;
  sessionId: string;
  modelId: string;
  providerId: string | null;
  role: "assistant" | "user";
  tokens: TokenUsage;
  time: TimeData;
  agent: string | null;
  finishReason: string | null;
  outputRate: number;
  parts: MessagePart[];
}

export interface Session {
  id: string;
  parentId: string | null;
  projectId: string | null;
  projectName: string | null;
  title: string | null;
  timeCreated: number | null;
  timeUpdated: number | null;
  timeArchived: number | null;
  interactions: Interaction[];
  source: "sqlite" | "files";
}

export interface AgentNode {
  session: Session;
  children: AgentNode[];
  depth: number;
}

export interface FlatNode {
  id: string;
  session: Session;
  workflowIndex: number;
  depth: number;
  hasChildren: boolean;
  agentNode: AgentNode;
}

export interface Workflow {
  id: string;
  mainSession: Session;
  subAgentSessions: Session[];
  agentTree: AgentNode;
}

export interface ModelPricing {
  input: Decimal;
  output: Decimal;
  cacheRead: Decimal;
  cacheWrite: Decimal;
  contextWindow: number;
}

export interface ToolUsage {
  name: string;
  calls: number;
  successes: number;
  failures: number;
  totalDurationMs: number;
  avgDurationMs: number;
  recentErrors: string[];
}

export interface TrendSeries {
  labels: string[];
  values: number[];
  mode: "hour" | "day" | "week";
  spanText: string;
}

export interface OverviewStats {
  totalCost: Decimal;
  totalTokens: TokenUsage;
  modelBreakdown: Map<string, { cost: Decimal; tokens: number; calls: number }>;
  projectBreakdown: Map<string, { cost: Decimal; sessions: number }>;
  agentBreakdown: Map<string, { cost: Decimal; calls: number }>;
  agentToolErrors: Map<string, { calls: number; errors: number }>;
  toolCallCounts: Map<string, { calls: number; errors: number; totalDurationMs: number }>;
  tokenTrend: TrendSeries;
  sessionTrend: TrendSeries;
  hourlyActivity: number[];
}

export type ScreenId = "sessions" | "tools" | "overview";

export type { Decimal };
