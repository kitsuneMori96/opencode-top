import React, { useState, useMemo, memo } from "react";
import { Box, Text, useInput } from "ink";
import { colors } from "../theme";
import { truncateDisplay } from "../text";
import { StatusBar } from "../components/StatusBar";
import type { Workflow, ToolUsage } from "../../core/types";
import { getToolUsage } from "../../core/session";

interface ToolsScreenProps {
  workflows: Workflow[];
  isActive: boolean;
  contentHeight: number;
  terminalWidth: number;
}

type SortKey = "calls" | "failures" | "avgTime";

function aggregateToolUsage(workflows: Workflow[]): ToolUsage[] {
  const merged = new Map<
    string,
    { calls: number; successes: number; failures: number; totalDurationMs: number; recentErrors: string[] }
  >();

  for (const workflow of workflows) {
    const allSessions = [workflow.mainSession, ...workflow.subAgentSessions];
    for (const session of allSessions) {
      for (const tool of getToolUsage(session)) {
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
  }

  return Array.from(merged.entries()).map(([name, s]) => ({
    name,
    calls: s.calls,
    successes: s.successes,
    failures: s.failures,
    totalDurationMs: s.totalDurationMs,
    avgDurationMs: s.calls > 0 ? s.totalDurationMs / s.calls : 0,
    recentErrors: s.recentErrors,
  }));
}

function SuccessBar({ successes, calls, width = 12 }: { successes: number; calls: number; width?: number }) {
  const pct = calls > 0 ? successes / calls : 0;
  const filled = Math.round(pct * width);
  const empty = width - filled;
  const color = pct >= 0.9 ? colors.teal : pct >= 0.7 ? colors.warning : colors.error;
  return (
    <Text>
      <Text color={color}>{"▓".repeat(filled)}</Text>
      <Text color={colors.textMuted}>{"░".repeat(empty)}</Text>
      <Text color={colors.textDim}> {Math.round(pct * 100)}%</Text>
    </Text>
  );
}

function formatDuration(ms: number): string {
  if (ms === 0) return "—";
  if (ms < 1000) return `${ms.toFixed(0)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function ToolsScreenInner({ workflows, isActive, contentHeight, terminalWidth }: ToolsScreenProps) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [sortKey, setSortKey] = useState<SortKey>("calls");

  const allTools = useMemo(() => aggregateToolUsage(workflows), [workflows]);

  const sortedTools = useMemo(() => {
    const copy = [...allTools];
    switch (sortKey) {
      case "calls":
        return copy.sort((a, b) => b.calls - a.calls);
      case "failures":
        return copy.sort((a, b) => b.failures - a.failures);
      case "avgTime":
        return copy.sort((a, b) => b.avgDurationMs - a.avgDurationMs);
    }
  }, [allTools, sortKey]);

  const statusBarHeight = 2;
  const listHeight = contentHeight - statusBarHeight - 3; // header + border
  const clampedIndex = Math.min(selectedIndex, Math.max(0, sortedTools.length - 1));
  const selectedTool = sortedTools[clampedIndex] ?? null;

  // Pagination
  const startIndex = clampedIndex >= listHeight ? clampedIndex - listHeight + 1 : 0;
  const visibleTools = sortedTools.slice(startIndex, startIndex + listHeight);

  useInput(
    (input, key) => {
      if (key.upArrow || input === "k") {
        setSelectedIndex((i) => Math.max(0, i - 1));
        return;
      }
      if (key.downArrow || input === "j") {
        setSelectedIndex((i) => Math.min(sortedTools.length - 1, i + 1));
        return;
      }
      if (key.tab) {
        setSortKey((k) => {
          if (k === "calls") return "failures";
          if (k === "failures") return "avgTime";
          return "calls";
        });
        return;
      }
    },
    { isActive }
  );

  const sortLabels: Record<SortKey, string> = {
    calls: "calls",
    failures: "failures",
    avgTime: "avg-time",
  };

  return (
    <Box flexDirection="column" width={terminalWidth} height={contentHeight}>
      <Box paddingX={1} flexDirection="row">
        <Text color={colors.accent} bold>◆ TOOLS</Text>
        <Box flexGrow={1} />
        <Text color={colors.textMuted}>sort: </Text>
        {(["calls", "failures", "avgTime"] as SortKey[]).map((k) => (
          <Text key={k} color={sortKey === k ? colors.teal : colors.textMuted}>
            {sortKey === k ? `[${sortLabels[k]}]` : sortLabels[k]}{" "}
          </Text>
        ))}
        <Text color={colors.textMuted}>Tab:cycle</Text>
      </Box>

      <Box flexDirection="row" flexGrow={1}>
        {/* Left: tool list */}
        <Box width={36} flexDirection="column" borderStyle="round" borderColor={colors.borderBright}>
          <Box paddingX={1} flexDirection="row">
            <Text color={colors.purple} bold>TOOL</Text>
            <Box flexGrow={1} />
            <Text color={colors.textMuted}>calls </Text>
            <Text color={colors.textMuted}>err</Text>
          </Box>
          {visibleTools.map((tool) => {
            const isSelected = tool.name === selectedTool?.name;
            return (
              <Box key={tool.name} flexDirection="row" paddingX={1}>
                {isSelected ? (
                  <Text color={colors.bgHighlight} backgroundColor={colors.accent} bold>
                    {`▶ ${truncate(tool.name, 20)}`}
                  </Text>
                ) : (
                  <Text color={colors.textDim}>
                    {`  ${truncate(tool.name, 20)}`}
                  </Text>
                )}
                <Box flexGrow={1} />
                <Text color={colors.accentAlt}>{tool.calls}</Text>
                <Text color={colors.textMuted}> </Text>
                <Text color={tool.failures > 0 ? colors.error : colors.textMuted}>{tool.failures}</Text>
              </Box>
            );
          })}
          {allTools.length === 0 && (
            <Box paddingX={1}>
              <Text color={colors.textDim}>No tool data yet</Text>
            </Box>
          )}
        </Box>

        {/* Right: detail panel */}
        <Box flexGrow={1} flexDirection="column" borderStyle="round" borderColor={colors.borderBright} paddingX={1}>
          {selectedTool ? (
            <>
              <Text color={colors.accent} bold>{selectedTool.name}</Text>
              <Box marginTop={1} flexDirection="column">
                <Text color={colors.purple} bold>── STATS ──────────────────</Text>
                <Box flexDirection="row">
                  <Box width={14}><Text color={colors.textMuted}>Total calls</Text></Box>
                  <Text color={colors.text}>{selectedTool.calls}</Text>
                </Box>
                <Box flexDirection="row">
                  <Box width={14}><Text color={colors.textMuted}>Successes</Text></Box>
                  <Text color={colors.success}>{selectedTool.successes}</Text>
                </Box>
                <Box flexDirection="row">
                  <Box width={14}><Text color={colors.textMuted}>Failures</Text></Box>
                  <Text color={selectedTool.failures > 0 ? colors.error : colors.textMuted}>
                    {selectedTool.failures}
                  </Text>
                </Box>
                <Box flexDirection="row">
                  <Box width={14}><Text color={colors.textMuted}>Avg time</Text></Box>
                  <Text color={colors.info}>{formatDuration(selectedTool.avgDurationMs)}</Text>
                </Box>
              </Box>

              <Box marginTop={1}>
                <Text color={colors.textMuted}>success rate </Text>
                <SuccessBar successes={selectedTool.successes} calls={selectedTool.calls} />
              </Box>

              {selectedTool.recentErrors.length > 0 && (
                <>
                  <Box marginTop={1}>
                    <Text color={colors.purple} bold>── RECENT ERRORS ──────────</Text>
                  </Box>
                  {selectedTool.recentErrors.map((err, i) => (
                    <Box key={i} flexDirection="row">
                      <Text color={colors.error}>✗ </Text>
                      <Text color={colors.text}>{truncate(err, 60)}</Text>
                    </Box>
                  ))}
                </>
              )}
            </>
          ) : (
            <Text color={colors.textDim}>No tools found. Run some OpenCode sessions first.</Text>
          )}
        </Box>
      </Box>

      <StatusBar
        hints="j/k:nav  Tab:cycle-sort  1:sessions  3:overview  q:quit"
        info={`${allTools.length} tools`}
      />
    </Box>
  );
}

export const ToolsScreen = memo(ToolsScreenInner);

function truncate(s: string, maxCols: number): string {
  return truncateDisplay(s, maxCols);
}
