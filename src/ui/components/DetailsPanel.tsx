import React, { memo, useMemo } from "react";
import { Box, Text } from "ink";
import { colors } from "../theme";
import { truncateDisplay } from "../text";
import type { Workflow } from "../../core/types";
import {
  getSessionTokens,
  getSessionCostSingle,
  getSessionDuration,
  getOutputRate,
  getToolUsage,
} from "../../core/session";
import { getPricing } from "../../data/pricing";
import { AgentChainGraph } from "./AgentChainGraph";

interface DetailsPanelProps {
  workflow: Workflow | null;
  height?: number;
  /** null = auto (collapse when sub-agents exceed threshold) */
  chainCollapsed: boolean | null;
}

/** Sub-agent count above which AGENT CHAIN starts collapsed */
export const CHAIN_COLLAPSE_THRESHOLD = 5;
/** Max chain rows shown when expanded */
export const CHAIN_MAX_ROWS = 15;

function StatRow({
  label,
  value,
  color = colors.text,
}: {
  label: string;
  value: string;
  color?: string;
}) {
  return (
    <Box flexDirection="row">
      <Box width={12}>
        <Text color={colors.textDim}>{label}</Text>
      </Box>
      <Text color={color}>{value}</Text>
    </Box>
  );
}

function formatDuration(ms: number): string {
  if (ms === 0) return "—";
  const mins = Math.floor(ms / 60000);
  const secs = Math.floor((ms % 60000) / 1000);
  if (mins === 0) return `${secs}s`;
  return `${mins}m ${secs}s`;
}

function ProgressBar({
  value,
  max,
  width = 16,
  color = colors.accent,
}: {
  value: number;
  max: number;
  width?: number;
  color?: string;
}) {
  const pct = max > 0 ? Math.min(value / max, 1) : 0;
  const filled = Math.round(pct * width);
  const empty = width - filled;

  return (
    <Text>
      <Text color={color}>{"█".repeat(filled)}</Text>
      <Text color={colors.textMuted}>{"░".repeat(empty)}</Text>
      <Text color={colors.textDim}> {Math.round(pct * 100)}%</Text>
    </Text>
  );
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toString();
}

function DetailsPanelInner({ workflow, height, chainCollapsed }: DetailsPanelProps) {
  const data = useMemo(() => {
    if (!workflow) return null;

    const session = workflow.mainSession;
    const tokens = getSessionTokens(session);
    const modelId = session.interactions[0]?.modelId ?? "";
    const pricing = getPricing(modelId);
    const cost = getSessionCostSingle(session, pricing);
    const duration = getSessionDuration(session);
    const outputRate = getOutputRate(session);

    const contextUsage = tokens.input + tokens.cacheRead + tokens.cacheWrite;
    const contextPct = pricing.contextWindow > 0 ? contextUsage / pricing.contextWindow : 0;

    const modelBreakdown = new Map<string, { count: number; tokens: number }>();
    for (const i of session.interactions) {
      const existing = modelBreakdown.get(i.modelId) ?? { count: 0, tokens: 0 };
      existing.count++;
      existing.tokens += i.tokens.total;
      modelBreakdown.set(i.modelId, existing);
    }

    const toolUsage = getToolUsage(session);
    const topTools = toolUsage
      .sort((a, b) => b.calls - a.calls)
      .slice(0, 3);

    const chainCount = workflow.subAgentSessions.length;
    let chainTokens = 0;
    for (const s of workflow.subAgentSessions) {
      chainTokens += getSessionTokens(s).total;
    }

    return {
      title: session.title ?? "Untitled",
      project: session.projectName ?? "—",
      tokens: tokens.total,
      cost,
      duration,
      outputRate,
      calls: session.interactions.length,
      contextUsage,
      contextWindow: pricing.contextWindow,
      contextPct,
      modelBreakdown,
      topTools,
      agentTree: workflow.agentTree,
      hasSubAgents: chainCount > 0,
      chainCount,
      chainTokens,
    };
  }, [workflow]);

  if (!data) {
    return (
      <Box flexDirection="column" paddingX={1} height={height}>
        <Text color={colors.textDim}>Select a session</Text>
      </Box>
    );
  }

  // Panel inner width = 64 - 2 (paddingX). Titles must never wrap,
  // or every row below shifts and overprints (the Stats-panel bug).
  const collapsed = chainCollapsed ?? data.chainCount > CHAIN_COLLAPSE_THRESHOLD;

  return (
    <Box flexDirection="column" paddingX={1} height={height} width={64} overflow="hidden">
      <Box flexDirection="column">
        <Text wrap="truncate" color={colors.accent} bold>{truncateDisplay(data.title, 60)}</Text>
        <Text wrap="truncate" color={colors.textMuted}>◎ {truncateDisplay(data.project, 58)}</Text>
      </Box>

      <Box marginTop={1} flexDirection="column">
        <Text color={colors.purple} bold>── STATS ──────────────────</Text>
        <StatRow label="Tokens" value={formatTokens(data.tokens)} />
        <StatRow label="Cost" value={`$${data.cost.toFixed(4)}`} color={colors.success} />
        <StatRow label="Duration" value={formatDuration(data.duration)} />
        <StatRow label="Rate" value={`${data.outputRate.toFixed(0)} tok/s`} />
        <StatRow label="Calls" value={data.calls.toString()} />
      </Box>

      <Box marginTop={1} flexDirection="column">
        <Text color={colors.textMuted}>context</Text>
        <ProgressBar
          value={data.contextUsage}
          max={data.contextWindow}
          color={data.contextPct > 0.8 ? colors.warning : colors.teal}
        />
      </Box>

      <Box marginTop={1}>
        <Text color={colors.purple} bold>── MODELS ─────────────────</Text>
      </Box>
      {Array.from(data.modelBreakdown.entries())
        .slice(0, 3)
        .map(([model, stats]) => (
          <Box key={model} flexDirection="row" height={1}>
            <Box flexGrow={1} flexShrink={1} overflow="hidden">
              <Text wrap="truncate" color={colors.text}>{truncateDisplay(model, 25)}</Text>
            </Box>
            <Box width={6} justifyContent="flex-end">
              <Text color={colors.textMuted}>{stats.count}×</Text>
            </Box>
            <Box width={8} justifyContent="flex-end">
              <Text color={colors.info}>{formatTokens(stats.tokens)}</Text>
            </Box>
          </Box>
        ))}

      {data.topTools.length > 0 && (
        <>
          <Box marginTop={1}>
            <Text color={colors.purple} bold>── TOOLS ──────────────────</Text>
          </Box>
          {data.topTools.map((tool) => (
            <Box key={tool.name} flexDirection="row" height={1}>
              <Box flexGrow={1} flexShrink={1} overflow="hidden">
                <Text wrap="truncate" color={colors.text}>{truncateDisplay(tool.name, 20)}</Text>
              </Box>
              <Box width={9} justifyContent="flex-end">
                <Text color={tool.failures > 0 ? colors.warning : colors.success}>
                  {tool.successes}/{tool.calls}
                </Text>
              </Box>
            </Box>
          ))}
        </>
      )}

      {data.hasSubAgents && (
        <>
          <Box marginTop={1} flexDirection="row" height={1}>
            <Text color={colors.purple} bold>── AGENT CHAIN ({data.chainCount}) {collapsed ? "▶" : "▾"}</Text>
            <Box flexGrow={1} />
            <Text color={colors.textDim}>c</Text>
          </Box>
          {collapsed ? (
            <Box flexDirection="row" height={1}>
              <Box flexGrow={1} flexShrink={1} overflow="hidden">
                <Text wrap="truncate" color={colors.textDim}>
                  {data.chainCount} agents · {formatTokens(data.chainTokens)} — c:expand
                </Text>
              </Box>
            </Box>
          ) : (
            <>
              <AgentChainGraph agentTree={data.agentTree} maxRows={CHAIN_MAX_ROWS} />
              {data.chainCount > CHAIN_MAX_ROWS && (
                <Text color={colors.textDim}>… +{data.chainCount - CHAIN_MAX_ROWS} more</Text>
              )}
            </>
          )}
        </>
      )}
    </Box>
  );
}

export const DetailsPanel = memo(DetailsPanelInner);
