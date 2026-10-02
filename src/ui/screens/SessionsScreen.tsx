import React, { useState, useMemo, useCallback, useRef, memo } from "react";
import { Box, Text, useInput } from "ink";
import TextInput from "ink-text-input";
import { colors } from "../theme";
import { StatusBar } from "../components/StatusBar";
import { AgentTree } from "../components/AgentTree";
import { DetailsPanel, CHAIN_COLLAPSE_THRESHOLD } from "../components/DetailsPanel";
import { MessagesPanel, buildLines, lineMatchesQuery } from "../components/MessagesPanel";
import type { Workflow, AgentNode, FlatNode, Session } from "../../core/types";

interface SessionsScreenProps {
  workflows: Workflow[];
  isActive: boolean;
  contentHeight: number;
  terminalWidth: number;
}

type RightMode = "stats" | "messages";

function flattenWorkflow(workflow: Workflow, workflowIndex: number, expandChildren: boolean): FlatNode[] {
  const nodes: FlatNode[] = [];
  function walk(node: AgentNode) {
    nodes.push({
      id: node.session.id,
      session: node.session,
      workflowIndex,
      depth: node.depth,
      hasChildren: node.children.length > 0,
      agentNode: node,
    });
    // Collapsed workflows show only the root session
    if (node.depth === 0 && !expandChildren) return;
    for (const child of node.children) walk(child);
  }
  walk(workflow.agentTree);
  return nodes;
}

function sessionMatchesQuery(session: Session, query: string): boolean {
  const q = query.toLowerCase();
  for (const interaction of session.interactions) {
    for (const part of interaction.parts) {
      if (part.type === "text" && part.text.toLowerCase().includes(q)) return true;
      if (part.type === "tool") {
        if (part.toolName.toLowerCase().includes(q)) return true;
        if (part.output && part.output.toLowerCase().includes(q)) return true;
        const inputStr = JSON.stringify(part.input).toLowerCase();
        if (inputStr.includes(q)) return true;
      }
    }
  }
  if (session.title && session.title.toLowerCase().includes(q)) return true;
  return false;
}

function SessionsScreenInner({
  workflows,
  isActive,
  contentHeight,
  terminalWidth,
}: SessionsScreenProps) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [rightMode, setRightMode] = useState<RightMode>("stats");
  const [searchMode, setSearchMode] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [globalMatchPos, setGlobalMatchPos] = useState(-1); // index into globalMatches
  // Workflows expanded in the left tree (default: all collapsed, roots only)
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  // AGENT CHAIN fold override: null = auto (collapse when subs exceed threshold)
  const [chainCollapsed, setChainCollapsed] = useState<boolean | null>(null);
  // jumpToLine: {line, seq} — seq always increments so the effect fires even for same line
  const [jumpToLine, setJumpToLine] = useState<{ line: number; seq: number } | undefined>(undefined);
  const jumpSeqRef = useRef(0);

  // While searching, treat every workflow as expanded so matches stay visible
  const searching = searchQuery.trim().length > 0;

  const effectiveExpandedIds = useMemo(() => {
    if (!searching) return expandedIds;
    return new Set(workflows.map((w) => w.id));
  }, [searching, expandedIds, workflows]);

  const allFlatNodes = useMemo(() => {
    return workflows.flatMap((w, i) => flattenWorkflow(w, i, searching || expandedIds.has(w.id)));
  }, [workflows, expandedIds, searching]);

  const flatNodes = useMemo(() => {
    if (!searchQuery.trim()) return allFlatNodes;
    return allFlatNodes.filter((n) => sessionMatchesQuery(n.session, searchQuery));
  }, [allFlatNodes, searchQuery]);

  // Global match list: [{flatNodeIndex, lineIndex}] across all matching sessions
  const globalMatches = useMemo(() => {
    if (!searchQuery.trim()) return [];
    const q = searchQuery.toLowerCase();
    const result: { flatNodeIndex: number; lineIndex: number }[] = [];
    for (let fi = 0; fi < flatNodes.length; fi++) {
      const session = flatNodes[fi].session;
      const lines = buildLines(session, 80, new Set(), new Set());
      for (let li = 0; li < lines.length; li++) {
        if (lineMatchesQuery(lines[li], q)) {
          result.push({ flatNodeIndex: fi, lineIndex: li });
        }
      }
    }
    return result;
  }, [flatNodes, searchQuery]);

  const clampedIndex = Math.min(selectedIndex, Math.max(0, flatNodes.length - 1));
  const selectedNode = flatNodes[clampedIndex] ?? null;

  const toggleWorkflowExpanded = useCallback((workflowId: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(workflowId)) next.delete(workflowId);
      else next.add(workflowId);
      return next;
    });
  }, []);

  const selectedWorkflow = useMemo(() => {
    if (!selectedNode) return null;
    const w = workflows[selectedNode.workflowIndex];
    if (!w) return null;
    if (selectedNode.session.id !== w.mainSession.id) {
      return {
        id: selectedNode.session.id,
        mainSession: selectedNode.session,
        subAgentSessions: selectedNode.agentNode.children.map((c) => c.session),
        agentTree: selectedNode.agentNode,
      };
    }
    return w;
  }, [selectedNode, workflows]);

  const selectedWorkflowId = selectedWorkflow?.id ?? null;

  // Reset chain fold override when switching sessions (back to auto)
  const prevWorkflowIdRef = useRef<string | null>(null);
  if (prevWorkflowIdRef.current !== selectedWorkflowId) {
    prevWorkflowIdRef.current = selectedWorkflowId;
    if (chainCollapsed !== null) setChainCollapsed(null);
  }

  const toggleChain = useCallback(() => {
    setChainCollapsed((prev) => {
      if (prev !== null) return !prev;
      const subs = selectedWorkflowRef.current?.subAgentSessions.length ?? 0;
      return !(subs > CHAIN_COLLAPSE_THRESHOLD);
    });
  }, []);

  const selectedWorkflowRef = useRef(selectedWorkflow);
  selectedWorkflowRef.current = selectedWorkflow;

  const leftWidth = Math.floor(terminalWidth * 0.35);
  const rightWidth = terminalWidth - leftWidth - 2;

  const statusBarHeight = 2;
  const borderRows = 2;
  const innerHeight = contentHeight - statusBarHeight - borderRows;
  const panelHeight = contentHeight - statusBarHeight;
  const msgHeight = innerHeight - 1; // minus tab header row

  const handleSelect = useCallback((index: number) => {
    setSelectedIndex(index);
  }, []);

  const globalMatchesRef = useRef(globalMatches);
  globalMatchesRef.current = globalMatches;
  const globalMatchPosRef = useRef(globalMatchPos);
  globalMatchPosRef.current = globalMatchPos;
  const clampedIndexRef = useRef(clampedIndex);
  clampedIndexRef.current = clampedIndex;
  const flatNodesRef = useRef(flatNodes);
  flatNodesRef.current = flatNodes;
  const workflowsRef = useRef(workflows);
  workflowsRef.current = workflows;

  // SessionsScreen only handles: tab switch, tree nav (stats mode), session switch (messages mode)
  useInput(
    (input, key) => {
      if (searchMode) {
        if (key.escape) {
          setSearchMode(false);
          setSearchQuery("");
          setSelectedIndex(0);
        }
        // Enter confirms search and switches to messages mode to navigate occurrences
        if (key.return && searchQuery.trim()) {
          setSearchMode(false);
          setRightMode("messages");
        }
        return;
      }
      if (input === "/") {
        setSearchMode(true);
        setSearchQuery("");
        setSelectedIndex(0);
        setGlobalMatchPos(-1);
        return;
      }
      if (key.escape && searchQuery) {
        setSearchQuery("");
        setSelectedIndex(0);
        setGlobalMatchPos(-1);
        return;
      }
      if (input === "n" || input === "N") {
        const matches = globalMatchesRef.current;
        if (matches.length === 0) return;
        const pos = globalMatchPosRef.current;
        const nextPos = input === "n"
          ? (pos + 1) % matches.length
          : pos < 0
            ? matches.length - 1
            : (pos - 1 + matches.length) % matches.length;
        const match = matches[nextPos];
        setGlobalMatchPos(nextPos);
        setSelectedIndex(match.flatNodeIndex);
        setRightMode("messages");
        jumpSeqRef.current += 1;
        setJumpToLine({ line: match.lineIndex, seq: jumpSeqRef.current });
        return;
      }
      if (key.tab) {
        setRightMode((m) => (m === "stats" ? "messages" : "stats"));
        return;
      }
      if (rightMode === "stats") {
        if (key.upArrow || input === "k") { handleSelect(Math.max(0, clampedIndex - 1)); return; }
        if (key.downArrow || input === "j") { handleSelect(Math.min(flatNodes.length - 1, clampedIndex + 1)); return; }
        if (input === "g") { handleSelect(0); return; }
        if (input === "G") { handleSelect(flatNodes.length - 1); return; }
        if (key.return) {
          const node = flatNodesRef.current[clampedIndexRef.current];
          const w = node ? workflowsRef.current[node.workflowIndex] : undefined;
          if (w && (w.subAgentSessions.length > 0 || w.agentTree.children.length > 0)) {
            toggleWorkflowExpanded(w.id);
          }
          return;
        }
        if (input === "c") { toggleChain(); return; }
      } else {
        // In messages mode, [ and ] switch session
        if (input === "[") { handleSelect(Math.max(0, clampedIndex - 1)); return; }
        if (input === "]") { handleSelect(Math.min(flatNodes.length - 1, clampedIndex + 1)); return; }
      }
    },
    { isActive }
  );

  return (
    <Box flexDirection="column" width={terminalWidth} height={contentHeight}>
      <Box flexDirection="row" height={panelHeight}>
        {/* Left: agent/session tree */}
        <Box
          width={leftWidth}
          height={panelHeight}
          borderStyle="round"
          borderColor={colors.borderBright}
          flexDirection="column"
        >
          {/* Search bar */}
          <Box height={1} paddingX={1} flexDirection="row">
            {searchMode ? (
              <>
                <Text color={colors.accent}>/</Text>
                <TextInput
                  value={searchQuery}
                  onChange={(v) => { setSearchQuery(v); setSelectedIndex(0); setGlobalMatchPos(-1); }}
                  onSubmit={() => setSearchMode(false)}
                  focus={searchMode}
                />
              </>
            ) : searchQuery ? (
              <>
                <Text color={colors.warning}>/{searchQuery}</Text>
                <Text color={colors.textDim}> {flatNodes.length} sessions</Text>
                {globalMatches.length > 0 && (
                  <Text color={colors.teal}>
                    {" "}· {globalMatchPos >= 0 ? `${globalMatchPos + 1}/` : ""}{globalMatches.length} hits
                  </Text>
                )}
              </>
            ) : (
              <Text color={colors.textDim}>Sessions ({allFlatNodes.length}) · /:search</Text>
            )}
          </Box>
          <AgentTree
            workflows={workflows}
            selectedId={selectedNode?.id ?? null}
            flatNodes={flatNodes}
            onSelect={(id) => {
              const idx = flatNodes.findIndex((n) => n.id === id);
              if (idx >= 0) handleSelect(idx);
            }}
            maxHeight={innerHeight - 1}
            expandedIds={effectiveExpandedIds}
          />
        </Box>

        {/* Right: details or messages */}
        <Box
          width={rightWidth}
          height={panelHeight}
          borderStyle="round"
          borderColor={colors.borderBright}
          flexDirection="column"
        >
          {/* Tab header: 1 row */}
          <Box paddingX={1} height={1} flexDirection="row">
            {rightMode === "stats" ? (
              <Text backgroundColor={colors.bgHighlight} color={colors.accent} bold> Stats </Text>
            ) : (
              <Text color={colors.textDim}> Stats </Text>
            )}
            <Text color={colors.textMuted}>│</Text>
            {rightMode === "messages" ? (
              <Text backgroundColor={colors.bgHighlight} color={colors.accent} bold> Messages </Text>
            ) : (
              <Text color={colors.textDim}> Messages </Text>
            )}
            <Box flexGrow={1} />
            <Text color={colors.textMuted}>Tab:switch</Text>
          </Box>

          {rightMode === "stats" ? (
            <DetailsPanel workflow={selectedWorkflow} height={innerHeight - 1} chainCollapsed={chainCollapsed} />
          ) : (
            <MessagesPanel
              session={selectedNode?.session ?? null}
              maxHeight={msgHeight}
              isActive={isActive && rightMode === "messages"}
              searchQuery={searchQuery}
              jumpToLine={jumpToLine}
            />
          )}
        </Box>
      </Box>

      <StatusBar
        hints={
          searchMode
            ? "Type to search · Enter:confirm · Esc:clear"
            : rightMode === "messages"
            ? `j/k:scroll  d/u:½page  g/G:top/bot  Enter:expand  f:filter${searchQuery ? "  n/N:match" : ""}  [:prev  ]:next  Tab:stats  q:quit`
            : `j/k:nav  Enter:expand  c:chain  g/G:top/bot  /:search${searchQuery ? "  n/N:match" : ""}  Tab:messages  2:tools  3:overview  r:refresh  q:quit`
        }
      />
    </Box>
  );
}

export const SessionsScreen = memo(SessionsScreenInner);
