import React, { memo } from "react";
import { Box, Text } from "ink";
import { colors } from "../theme";
import { truncateDisplay } from "../text";
import type { Workflow, FlatNode } from "../../core/types";
import { getSessionTokens, getSessionCostSingle } from "../../core/session";
import { getPricing } from "../../data/pricing";
import Decimal from "decimal.js";

interface AgentTreeProps {
  workflows: Workflow[];
  selectedId: string | null;
  flatNodes: FlatNode[];
  onSelect: (id: string) => void;
  maxHeight?: number;
  expandedIds?: Set<string>;
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toString();
}

function formatCost(d: Decimal): string {
  if (d.lessThan(0.01)) return `$${d.toFixed(4)}`;
  return `$${d.toFixed(2)}`;
}

function formatDate(ts: number | null): string {
  if (!ts) return "";
  const d = new Date(ts);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  return `${mm}/${dd} ${hh}:${min}`;
}

function AgentTreeInner({ workflows, selectedId, flatNodes, maxHeight = 20, expandedIds }: AgentTreeProps) {
  const headerHeight = 2;
  const visibleCount = Math.max(1, maxHeight - headerHeight);
  const selectedIndex = flatNodes.findIndex((n) => n.id === selectedId);

  // Keep selected item visible with some context above
  let startIndex = 0;
  if (selectedIndex >= 0) {
    // Try to show 2 items above the selected one
    const ideal = selectedIndex - 2;
    startIndex = Math.max(0, Math.min(ideal, flatNodes.length - visibleCount));
  }
  const visibleNodes = flatNodes.slice(startIndex, startIndex + visibleCount);

  return (
    <Box flexDirection="column" paddingX={1} height={maxHeight} overflow="hidden">
      <Box marginBottom={1} flexDirection="row">
        <Text color={colors.purple} bold>SESSIONS</Text>
        <Box flexGrow={1} />
        <Text color={colors.textMuted}>{workflows.length} workflows</Text>
      </Box>

      {visibleNodes.map((node) => {
        const isSelected = node.id === selectedId;
        const tokens = getSessionTokens(node.session);
        const pricing = getPricing(node.session.interactions[0]?.modelId ?? "");
        const cost = getSessionCostSingle(node.session, pricing);
        const agentName = node.session.interactions[0]?.agent ?? null;

        const indent = "  ".repeat(node.depth);
        const isExpanded = node.depth === 0 && node.hasChildren
          ? (expandedIds?.has(workflows[node.workflowIndex]?.id ?? "") ?? false)
          : false;
        const prefix = node.depth === 0
          ? (node.hasChildren ? (isExpanded ? "▾ " : "▸ ") : "  ")
          : (node.hasChildren ? "╰▸ " : "╰─ ");

        const label = node.depth === 0
          ? truncate(node.session.title ?? node.session.projectName ?? "Untitled", 22)
          : truncate(`[${agentName ?? "?"}] ${node.session.title ?? ""}`, 20);

        const date = formatDate(node.session.timeUpdated ?? node.session.timeCreated);
        return (
          <Box key={node.id} flexDirection="row" height={1}>
            {/* Label flexes; wrap="truncate" guarantees the row never wraps
                into 2 visual lines (the overprint bug), even for CJK titles */}
            <Box flexGrow={1} flexShrink={1} overflow="hidden">
              <Text
                wrap="truncate"
                color={isSelected ? colors.bgHighlight : node.depth === 0 ? colors.text : colors.textDim}
                backgroundColor={isSelected ? colors.accent : undefined}
                bold={isSelected}
              >
                {`${isSelected ? "▶ " : "  "}${indent}${prefix}${label}`}
              </Text>
            </Box>
            <Box width={12}>
              {date ? <Text color={colors.textMuted}>{date}</Text> : null}
            </Box>
            <Box width={7} justifyContent="flex-end">
              <Text color={colors.textDim}>{formatTokens(tokens.total)}</Text>
            </Box>
            <Box width={8} justifyContent="flex-end">
              <Text color={cost.greaterThan(0) ? colors.success : colors.textMuted}>{formatCost(cost)}</Text>
            </Box>
          </Box>
        );
      })}

      {flatNodes.length > visibleCount && (
        <Text color={colors.textDim}>
          {startIndex > 0 ? "↑ " : "  "}
          {startIndex + visibleCount}/{flatNodes.length}
          {startIndex + visibleCount < flatNodes.length ? " ↓" : "  "}
        </Text>
      )}
    </Box>
  );
}

export const AgentTree = memo(AgentTreeInner);

function truncate(label: string, maxCols: number): string {
  return truncateDisplay(label, maxCols);
}
