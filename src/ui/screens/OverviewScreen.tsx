import React, { useMemo, memo, useState, useCallback } from "react";
import { Box, Text, useInput, useStdout } from "ink";
import { colors } from "../theme";
import { StatusBar } from "../components/StatusBar";
import { BarChart, buildAxisLine } from "../components/BarChart";
import type { Workflow } from "../../core/types";
import { computeOverviewStats } from "../../core/session";
import { getAllPricing } from "../../data/pricing";

type TimeFilter = 1 | 7 | 30 | 90 | 0; // 1 = today, 0 = all time
const TIME_FILTER_OPTIONS: TimeFilter[] = [1, 7, 30, 90, 0];

interface OverviewScreenProps {
  workflows: Workflow[];
  isActive: boolean;
  contentHeight: number;
  terminalWidth: number;
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toString();
}

function StatRow({ label, value, color = colors.text }: { label: string; value: string; color?: string }) {
  return (
    <Box flexDirection="row">
      <Box width={18}>
        <Text color={colors.textDim}>{label}</Text>
      </Box>
      <Text color={color}>{value}</Text>
    </Box>
  );
}

function SectionHeader({ title }: { title: string }) {
  return (
    <Box marginTop={1}>
      <Text color={colors.purple} bold>── {title.toUpperCase()} </Text>
    </Box>
  );
}

/** Error rate bar: shows ok + error segments */
function ErrorBar({
  label,
  calls,
  errors,
  width = 16,
  labelWidth = 8,
}: {
  label: string;
  calls: number;
  errors: number;
  width: number;
  labelWidth: number;
}) {
  const okCount = calls - errors;
  const okFilled = calls > 0 ? Math.round((okCount / calls) * width) : width;
  const errFilled = width - okFilled;
  const errPct = calls > 0 ? Math.round((errors / calls) * 100) : 0;
  return (
    <Box flexDirection="row">
      <Box width={labelWidth}>
        <Text color={colors.text}>{truncate(label, labelWidth - 1)}</Text>
      </Box>
      <Text color={colors.teal}>{"▓".repeat(okFilled)}</Text>
      <Text color={errors > 0 ? colors.error : colors.textMuted}>{"▓".repeat(errFilled)}</Text>
      <Text color={colors.textDim}> {calls}</Text>
      {errors > 0 && <Text color={colors.error}> ✗{errors} ({errPct}%)</Text>}
    </Box>
  );
}

function OverviewScreenInner({ workflows, isActive, contentHeight, terminalWidth }: OverviewScreenProps) {
  const { stdout } = useStdout();
  const clearScreen = useCallback(() => stdout?.write("\x1b[H\x1b[J"), [stdout]);
  const pricing = useMemo(() => getAllPricing(), []);

  // Filters
  const [timeFilterIdx, setTimeFilterIdx] = useState(0);
  const [projectFilterIdx, setProjectFilterIdx] = useState(0); // 0 = all projects

  const timeFilter: TimeFilter = TIME_FILTER_OPTIONS[timeFilterIdx];

  // All distinct projects (sorted)
  const allProjects = useMemo(() => {
    const projects = new Set<string>();
    for (const w of workflows) {
      const p = w.mainSession.projectName ?? "Unknown";
      projects.add(p);
    }
    return Array.from(projects).sort();
  }, [workflows]);

  const selectedProject = projectFilterIdx === 0 ? null : allProjects[projectFilterIdx - 1] ?? null;

  // Cutoff anchored to local midnight for consistent bucketing
  const cutoff = useMemo(() => {
    if (timeFilter === 1) {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      return today.getTime();
    }
    if (timeFilter > 1) {
      const d = new Date(Date.now() - timeFilter * 86_400_000);
      d.setHours(0, 0, 0, 0);
      return d.getTime();
    }
    return 0;
  }, [timeFilter, workflows]);

  // Apply filters
  const filteredWorkflows = useMemo(() => {
    return workflows.filter((w) => {
      const ts = w.mainSession.timeUpdated ?? w.mainSession.timeCreated;
      if (cutoff > 0 && (ts === null || ts < cutoff)) return false;
      if (selectedProject !== null) {
        const p = w.mainSession.projectName ?? "Unknown";
        if (p !== selectedProject) return false;
      }
      return true;
    });
  }, [workflows, cutoff, selectedProject]);

  useInput((input) => {
    if (!isActive) return;
    if (input === "t") {
      clearScreen();
      setTimeFilterIdx((i) => (i + 1) % TIME_FILTER_OPTIONS.length);
    }
    if (input === "p") {
      clearScreen();
      setProjectFilterIdx((i) => (i + 1) % (allProjects.length + 1));
    }
    if (input === "P") {
      clearScreen();
      setProjectFilterIdx((i) => (i - 1 + allProjects.length + 1) % (allProjects.length + 1));
    }
  }, { isActive });

  const stats = useMemo(() => computeOverviewStats(filteredWorkflows, pricing, cutoff), [filteredWorkflows, pricing, cutoff]);

  const topModels = useMemo(() =>
    Array.from(stats.modelBreakdown.entries())
      .sort((a, b) => b[1].calls - a[1].calls)
      .slice(0, 4),
    [stats]
  );

  const topProjects = useMemo(() =>
    Array.from(stats.projectBreakdown.entries())
      .sort((a, b) => b[1].sessions - a[1].sessions)
      .slice(0, 4),
    [stats]
  );

  const agentToolErrorList = useMemo(() =>
    Array.from(stats.agentToolErrors.entries())
      .sort((a, b) => b[1].calls - a[1].calls),
    [stats]
  );

  const topTools = useMemo(() =>
    Array.from(stats.toolCallCounts.entries())
      .sort((a, b) => b[1].calls - a[1].calls)
      .slice(0, 8),
    [stats]
  );
  const maxToolCalls = topTools[0]?.[1].calls ?? 1;

  // Trend data (time-filtered)
  const weeklyTokenValues = stats.tokenTrend.values;
  const weeklySessionValues = stats.sessionTrend.values;
  const maxWeeklyTokens = Math.max(...weeklyTokenValues, 1);
  const maxWeeklySessions = Math.max(...weeklySessionValues, 1);

  // Column widths based on terminal
  const leftW = Math.max(32, Math.floor(terminalWidth * 0.38));
  const midW = Math.max(26, Math.floor(terminalWidth * 0.30));
  // right gets remaining

  return (
    <Box flexDirection="column" width={terminalWidth} height={contentHeight}>
      <Box paddingX={1} flexDirection="row">
        <Text color={colors.accent} bold>◆ OVERVIEW</Text>
        <Box flexGrow={1} />
        <Text color={colors.textMuted}>{filteredWorkflows.length}/{workflows.length} workflows</Text>
        {stats.totalTokens.total > 0 && <Text color={colors.textMuted}>  {formatTokens(stats.totalTokens.total)} tokens</Text>}
      </Box>

      {/* Filter bar */}
      <Box paddingX={1} flexDirection="row">
        <Text color={colors.textMuted}>filter: </Text>
        <Text color={timeFilter === 0 ? colors.accent : colors.teal} bold>
          {timeFilter === 0 ? "all time" : timeFilter === 1 ? "today" : `last ${timeFilter}d`}
        </Text>
        <Text color={colors.textMuted}>  ·  </Text>
        <Text color={selectedProject ? colors.peach : colors.textMuted}>
          {selectedProject ? truncate(selectedProject, 24) : "all projects"}
        </Text>
        <Text color={colors.textMuted}> (t/p)</Text>
      </Box>

      <Box flexDirection="row" flexGrow={1} paddingX={1}>

        {/* ── LEFT COLUMN ─────────────────────────────────────── */}
        <Box flexDirection="column" width={leftW}>

          <SectionHeader title="Totals" />
          <StatRow label="Total tokens" value={formatTokens(stats.totalTokens.total)} />
          <StatRow label="  input" value={formatTokens(stats.totalTokens.input)} color={colors.info} />
          <StatRow label="  output" value={formatTokens(stats.totalTokens.output)} color={colors.cyan} />
          <StatRow label="  cache r/w" value={`${formatTokens(stats.totalTokens.cacheRead)} / ${formatTokens(stats.totalTokens.cacheWrite)}`} color={colors.textDim} />
          <StatRow label="Total cost" value={`$${stats.totalCost.toFixed(4)}`} color={colors.success} />

          {timeFilter > 0 && (
            <>
              <SectionHeader title={`Token trend (${stats.tokenTrend.spanText} · peak ${formatTokens(maxWeeklyTokens)})`} />
              <BarChart values={weeklyTokenValues} color={colors.accentAlt} width={leftW} height={4} />
              <Text color={colors.textDim}>{buildAxisLine(stats.tokenTrend.labels, leftW)}</Text>

              <SectionHeader title={`Sessions (${stats.sessionTrend.spanText} · peak ${maxWeeklySessions}${stats.sessionTrend.mode === "hour" ? "/h" : "/day"})`} />
              <BarChart values={weeklySessionValues} color={colors.purple} width={leftW} height={3} />
              <Text color={colors.textDim}>{buildAxisLine(stats.sessionTrend.labels, leftW)}</Text>
            </>
          )}

          <SectionHeader title="Hourly activity" />
          <BarChart values={stats.hourlyActivity} color={colors.teal} width={leftW} height={3} />
          <Text color={colors.textDim}>{buildAxisLine(Array.from({ length: 24 }, (_, i) => String(i).padStart(2, "0")), leftW, [0, 6, 12, 18, 23])}</Text>

        </Box>

        {/* ── MIDDLE COLUMN ───────────────────────────────────── */}
        <Box flexDirection="column" width={midW} paddingLeft={2}>

          <SectionHeader title="Tool errors by agent" />
          {agentToolErrorList.length === 0
            ? <Text color={colors.textDim}>No tool data</Text>
            : agentToolErrorList.map(([agent, data]) => (
              <ErrorBar
                key={agent}
                label={agent}
                calls={data.calls}
                errors={data.errors}
                width={14}
                labelWidth={9}
              />
            ))
          }

          <SectionHeader title="Top tools (calls / errors)" />
          {topTools.length === 0
            ? <Text color={colors.textDim}>No tool data</Text>
            : topTools.map(([name, data]) => (
              <Box key={name} flexDirection="row">
                <Box width={10}>
                  <Text color={colors.text}>{truncate(name, 9)}</Text>
                </Box>
                <Text color={data.errors > 0 ? colors.peach : colors.accentAlt}>
                  {"▓".repeat(Math.max(1, Math.round(Math.sqrt(data.calls / maxToolCalls) * 12)))}
                </Text>
                <Text color={colors.textMuted}>
                  {"░".repeat(Math.max(0, 12 - Math.max(1, Math.round(Math.sqrt(data.calls / maxToolCalls) * 12))))}
                </Text>
                <Text color={colors.textDim}> {data.calls}</Text>
                {data.errors > 0 && <Text color={colors.error}> ✗{data.errors}</Text>}
              </Box>
            ))
          }

        </Box>

        {/* ── RIGHT COLUMN ────────────────────────────────────── */}
        <Box flexDirection="column" flexGrow={1} paddingLeft={2}>

          <SectionHeader title="Projects" />
          {topProjects.length === 0
            ? <Text color={colors.textDim}>No project data</Text>
            : topProjects.map(([project, data]) => (
              <Box key={project} flexDirection="row">
                <Box width={22}>
                  <Text color={colors.text}>{truncate(project, 20)}</Text>
                </Box>
                <Text color={colors.info}>{data.sessions} sess</Text>
                <Text color={colors.success}> ${data.cost.toFixed(3)}</Text>
              </Box>
            ))
          }

          <SectionHeader title="Tool avg duration (top 5)" />
          {(() => {
            const durList = Array.from(stats.toolCallCounts.entries())
              .filter(([, d]) => d.calls > 0 && d.totalDurationMs > 0)
              .map(([name, d]) => ({ name, avg: d.totalDurationMs / d.calls }))
              .sort((a, b) => b.avg - a.avg)
              .slice(0, 5);
            const maxAvg = durList[0]?.avg ?? 1;
            const barW = 10;
            return durList.map(({ name, avg }) => {
              const filled = Math.max(1, Math.round((avg / maxAvg) * barW));
              const durStr = avg < 1000 ? `${avg.toFixed(0)}ms` : `${(avg / 1000).toFixed(1)}s`;
              return (
                <Box key={name} flexDirection="row">
                  <Box width={12}>
                    <Text color={colors.text}>{truncate(name, 10)}</Text>
                  </Box>
                  <Text color={colors.peach}>{"▓".repeat(filled)}</Text>
                  <Text color={colors.textMuted}>{"░".repeat(barW - filled)}</Text>
                  <Text color={colors.textDim}> {durStr}</Text>
                </Box>
              );
            });
          })()}

          <SectionHeader title="Models" />
          {topModels.length === 0
            ? <Text color={colors.textDim}>No model data</Text>
            : topModels.map(([model, data]) => (
              <Box key={model} flexDirection="row">
                <Box width={22}>
                  <Text color={colors.text}>{truncate(model, 20)}</Text>
                </Box>
                <Text color={colors.info}>{data.calls}</Text>
                <Text color={colors.textDim}> {formatTokens(data.tokens)}</Text>
              </Box>
            ))
          }

        </Box>
      </Box>

      <StatusBar hints="1:sessions  2:tools  t:time-filter  p/P:project  r:refresh  q:quit" />
    </Box>
  );
}

export const OverviewScreen = memo(OverviewScreenInner);

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + "…";
}
