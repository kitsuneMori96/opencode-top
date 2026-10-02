import React, { memo } from "react";
import { Box, Text } from "ink";
import { colors } from "../theme";
import { truncateDisplay } from "../text";
import type { AgentNode } from "../../core/types";
import { getSessionTokens, getSessionCostSingle } from "../../core/session";
import { getPricing } from "../../data/pricing";

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toString();
}

interface FlatChainRow {
  node: AgentNode;
  isLast: boolean;
  prefix: string;
}

function flattenChain(node: AgentNode, prefix: string, out: FlatChainRow[]): void {
  for (let i = 0; i < node.children.length; i++) {
    const child = node.children[i];
    const last = i === node.children.length - 1;
    out.push({ node: child, isLast: last, prefix });
    flattenChain(child, prefix + (last ? "   " : "│  "), out);
  }
}

function AgentNodeRow({ node, isLast, prefix }: FlatChainRow) {
  const { session } = node;
  const tokens = getSessionTokens(session);
  const pricing = getPricing(session.interactions[0]?.modelId ?? "");
  const cost = getSessionCostSingle(session, pricing);
  const agentName = session.interactions[0]?.agent ?? session.interactions[0]?.role ?? "main";

  const connector = isLast ? "└─ " : "├─ ";

  return (
    <Box flexDirection="row" height={1}>
      <Box flexGrow={1} flexShrink={1} overflow="hidden">
        <Text wrap="truncate">
          <Text color={colors.textDim}>{prefix}{connector}</Text>
          <Text color={colors.cyan}>[{agentName}]</Text>
          <Text color={colors.text}> {truncate(session.title ?? session.id.slice(0, 8), 20)}</Text>
        </Text>
      </Box>
      <Box width={7} justifyContent="flex-end">
        <Text color={colors.textDim}>{formatTokens(tokens.total)}</Text>
      </Box>
      <Box width={8} justifyContent="flex-end">
        <Text color={colors.success}>${cost.toFixed(3)}</Text>
      </Box>
    </Box>
  );
}

interface AgentChainGraphProps {
  agentTree: AgentNode;
  maxRows?: number;
}

function AgentChainGraphInner({ agentTree, maxRows }: AgentChainGraphProps) {
  const { session } = agentTree;
  const tokens = getSessionTokens(session);
  const pricing = getPricing(session.interactions[0]?.modelId ?? "");
  const cost = getSessionCostSingle(session, pricing);
  const agentName = session.interactions[0]?.agent ?? "main";

  if (agentTree.children.length === 0) {
    return null;
  }

  const allRows: FlatChainRow[] = [];
  flattenChain(agentTree, "", allRows);
  const rows = maxRows !== undefined ? allRows.slice(0, maxRows) : allRows;

  return (
    <Box flexDirection="column">
      <Box flexDirection="row" height={1}>
        <Box flexGrow={1} flexShrink={1} overflow="hidden">
          <Text wrap="truncate">
            <Text color={colors.cyan} bold>[{agentName}]</Text>
            <Text color={colors.text}> {truncate(session.title ?? "root", 20)}</Text>
          </Text>
        </Box>
        <Box width={7} justifyContent="flex-end">
          <Text color={colors.textDim}>{formatTokens(tokens.total)}</Text>
        </Box>
        <Box width={8} justifyContent="flex-end">
          <Text color={colors.success}>${cost.toFixed(3)}</Text>
        </Box>
      </Box>
      {rows.map((row) => (
        <AgentNodeRow
          key={row.node.session.id}
          node={row.node}
          isLast={row.isLast}
          prefix={row.prefix}
        />
      ))}
    </Box>
  );
}

export const AgentChainGraph = memo(AgentChainGraphInner);

function truncate(s: string, maxCols: number): string {
  return truncateDisplay(s, maxCols);
}
