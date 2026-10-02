import React, { useMemo, memo, useEffect, useState, useRef } from "react";
import { Box, Text, useInput } from "ink";
import { colors } from "../theme";
import { truncateDisplay } from "../text";
import type { Session, Interaction, MessagePart } from "../../core/types";

interface MessagesPanelProps {
  session: Session | null;
  maxHeight: number;
  isActive: boolean;
  searchQuery?: string;
  jumpToLine?: { line: number; seq: number }; // when set/changed, snap cursor+scroll to this line index
}

export type MsgLine =
  | { id: string; kind: "header"; modelId: string; agent: string | null; duration: string; time: string; tokensIn: number; tokensOut: number; cumTokens: number }
  | { id: string; kind: "tool"; callId: string; icon: string; iconColor: string; name: string; title: string; right: string; expanded: boolean; rawInput: string; rawOutput: string; cumTokens: number }
  | { id: string; kind: "tool-detail"; label: string; value: string; isSection: boolean; cumTokens: number }
  | { id: string; kind: "text"; text: string; cumTokens: number }
  | { id: string; kind: "reasoning-header"; reasoningId: string; preview: string; charCount: number; expanded: boolean; cumTokens: number }
  | { id: string; kind: "reasoning"; text: string; cumTokens: number };

export function buildLines(session: Session, contentWidth: number, expandedIds: Set<string>, expandedReasoningIds: Set<string>): MsgLine[] {
  const lines: MsgLine[] = [];
  let cumTokens = 0;

  for (const interaction of session.interactions) {
    if (interaction.role !== "assistant") continue;

    cumTokens += interaction.tokens.input + interaction.tokens.cacheRead + interaction.tokens.output;

    const dur =
      interaction.time.completed && interaction.time.created
        ? formatDuration(interaction.time.completed - interaction.time.created)
        : "";

    const tokensIn = interaction.tokens.input + interaction.tokens.cacheRead;
    const tokensOut = interaction.tokens.output;

    lines.push({
      id: `h-${interaction.id}`,
      kind: "header",
      modelId: interaction.modelId,
      agent: interaction.agent ?? null,
      duration: dur,
      time: formatTime(interaction.time.created),
      tokensIn,
      tokensOut,
      cumTokens,
    });

    for (const part of interaction.parts) {
      if (part.type === "tool") {
        const p = part as MessagePart & { type: "tool" };
        const icon = p.status === "completed" ? "✓" : p.status === "error" ? "✗" : "◌";
        const iconColor =
          p.status === "completed" ? colors.success : p.status === "error" ? colors.error : colors.warning;
        const dur2 = p.timeEnd > 0 && p.timeStart > 0 ? formatDuration(p.timeEnd - p.timeStart) : "";
        const exitStr = p.exitCode !== null && p.exitCode !== 0 ? `exit:${p.exitCode} ` : "";
        const expanded = expandedIds.has(p.callId);

        lines.push({
          id: `t-${p.callId}`,
          kind: "tool",
          callId: p.callId,
          icon,
          iconColor,
          name: truncate(p.toolName, 18),
          title: p.title ? truncate(p.title, 28) : "",
          right: exitStr + dur2,
          expanded,
          rawInput: JSON.stringify(p.input),
          rawOutput: p.output ?? "",
          cumTokens,
        });

        if (expanded) {
          const inputKeys = Object.keys(p.input);
          if (inputKeys.length > 0) {
            lines.push({ id: `td-${p.callId}-in`, kind: "tool-detail", label: "input", value: "", isSection: true, cumTokens });
            for (const key of inputKeys) {
              const val = formatParamValue(p.input[key], contentWidth - key.length - 6);
              lines.push({ id: `td-${p.callId}-in-${key}`, kind: "tool-detail", label: key, value: val, isSection: false, cumTokens });
            }
          }
          if (p.output?.trim()) {
            lines.push({ id: `td-${p.callId}-out`, kind: "tool-detail", label: "output", value: "", isSection: true, cumTokens });
            const outLines = p.output.trim().split("\n").slice(0, 40);
            let outIdx = 0;
            for (const ol of outLines) {
              for (const wrapped of wrapText(ol === "" ? " " : ol, contentWidth - 5)) {
                lines.push({ id: `td-${p.callId}-out-${outIdx++}`, kind: "tool-detail", label: "", value: wrapped, isSection: false, cumTokens });
              }
            }
          }
        }
      } else if (part.type === "text" && part.text.trim()) {
        let txtIdx = 0;
        for (const row of wrapText(part.text.trim(), contentWidth - 3)) {
          lines.push({ id: `tx-${interaction.id}-${txtIdx++}`, kind: "text", text: row, cumTokens });
        }
      } else if (part.type === "reasoning" && part.text.trim()) {
        const reasoningId = `r-${interaction.id}`;
        const trimmed = part.text.trim();
        const expanded = expandedReasoningIds.has(reasoningId);
        const preview = trimmed.slice(0, 50);
        lines.push({ id: `rh-${interaction.id}`, kind: "reasoning-header", reasoningId, preview, charCount: trimmed.length, expanded, cumTokens });
        if (expanded) {
          let rIdx = 0;
          for (const row of wrapText(trimmed, contentWidth - 5)) {
            lines.push({ id: `r-${interaction.id}-${rIdx++}`, kind: "reasoning", text: row, cumTokens });
          }
        }
      }
    }
  }
  return lines;
}

function formatParamValue(val: unknown, maxLen: number): string {
  if (val === null || val === undefined) return "null";
  if (typeof val === "string") return truncate(val.split("\n")[0], Math.max(20, maxLen));
  if (typeof val === "number" || typeof val === "boolean") return String(val);
  try { return truncate(JSON.stringify(val), Math.max(20, maxLen)); }
  catch { return String(val); }
}

function wrapText(text: string, maxLen: number): string[] {
  const out: string[] = [];
  for (const raw of text.split("\n")) {
    if (raw.length <= maxLen) { out.push(raw); }
    else { for (let i = 0; i < raw.length; i += maxLen) out.push(raw.slice(i, i + maxLen)); }
  }
  return out;
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function formatTime(ts: number | null): string {
  if (!ts) return "";
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function formatDuration(ms: number): string {
  if (ms <= 0) return "";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function truncate(s: string, maxCols: number): string {
  if (!s) return s;
  return truncateDisplay(s, maxCols);
}

export function lineMatchesQuery(line: MsgLine, q: string): boolean {
  switch (line.kind) {
    case "text": return line.text.toLowerCase().includes(q);
    case "tool":
      return line.name.toLowerCase().includes(q)
        || line.title.toLowerCase().includes(q)
        || line.rawInput.toLowerCase().includes(q)
        || line.rawOutput.toLowerCase().includes(q);
    case "tool-detail": return line.label.toLowerCase().includes(q) || line.value.toLowerCase().includes(q);
    case "reasoning-header": return line.preview.toLowerCase().includes(q);
    case "reasoning": return line.text.toLowerCase().includes(q);
    default: return false;
  }
}

// Render text with query term highlighted (splits on first occurrence for simplicity)
function HighlightText({ text, query, baseColor, highlightColor = colors.accent }: {
  text: string; query: string; baseColor: string; highlightColor?: string;
}) {
  if (!query) return <Text color={baseColor}>{text}</Text>;
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx < 0) return <Text color={baseColor}>{text}</Text>;
  return (
    <Text>
      <Text color={baseColor}>{text.slice(0, idx)}</Text>
      <Text color={highlightColor} bold backgroundColor={colors.bgHighlight}>{text.slice(idx, idx + query.length)}</Text>
      <Text color={baseColor}>{text.slice(idx + query.length)}</Text>
    </Text>
  );
}

function MessagesPanelInner({ session, maxHeight, isActive, searchQuery = "", jumpToLine }: MessagesPanelProps) {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [expandedReasoningIds, setExpandedReasoningIds] = useState<Set<string>>(new Set());
  const [scrollOffset, setScrollOffset] = useState(0);
  const [cursor, setCursor] = useState(0);
  const [filter, setFilter] = useState<"all" | "errors" | "tools" | "text">("all");

  // Reset all state when session changes
  useEffect(() => {
    setExpandedIds(new Set());
    setExpandedReasoningIds(new Set());
    setScrollOffset(0);
    setCursor(0);
    setFilter("all");
  }, [session?.id]);

  // When jumpToLine changes (driven externally by n/N), snap to that line
  useEffect(() => {
    if (jumpToLine === undefined) return;
    const target = jumpToLine.line;
    // Auto-expand tool at target line if match is in input/output
    const lines = filteredLinesRef.current;
    const targetLine = lines[target];
    if (targetLine?.kind === "tool" && !targetLine.expanded) {
      const sq = searchQueryRef.current.toLowerCase();
      if (targetLine.rawInput.toLowerCase().includes(sq) || targetLine.rawOutput.toLowerCase().includes(sq)) {
        setExpandedIds((prev) => { const s = new Set(prev); s.add(targetLine.callId); return s; });
      }
    }
    setCursor(target);
    setScrollOffset((o) => {
      const vh = viewHeightRef.current;
      const mo = maxOffsetRef.current;
      if (target < o) return target;
      if (target >= o + vh) return Math.min(mo, target - Math.floor(vh / 2));
      return o;
    });
  }, [jumpToLine]);

  const contentWidth = 80;
  const viewHeight = maxHeight - 1; // minus the counter row

  const allLines = useMemo(
    () => (session ? buildLines(session, contentWidth, expandedIds, expandedReasoningIds) : []),
    [session, expandedIds, expandedReasoningIds]
  );

  const filteredLines = useMemo(() => {
    if (filter === "all") return allLines;
    return allLines.filter((line) => {
      if (line.kind === "header") return true;
      if (filter === "errors") return line.kind === "tool" && line.iconColor === colors.error;
      if (filter === "tools") return line.kind === "tool" || line.kind === "tool-detail";
      if (filter === "text") return line.kind === "text";
      return false;
    });
  }, [allLines, filter]);

  const matchIndices = useMemo(() => {
    if (!searchQuery.trim()) return [];
    const q = searchQuery.toLowerCase();
    return filteredLines.reduce<number[]>((acc, line, i) => {
      if (lineMatchesQuery(line, q)) acc.push(i);
      return acc;
    }, []);
  }, [filteredLines, searchQuery]);

  const maxOffset = Math.max(0, filteredLines.length - viewHeight);

  // Keep cursor in view: scroll to follow cursor
  const clampedCursor = Math.min(cursor, Math.max(0, filteredLines.length - 1));

  // Refs so useInput closure always reads current values (avoids stale closure bug)
  const matchIndicesRef = useRef(matchIndices);
  matchIndicesRef.current = matchIndices;
  const clampedCursorRef = useRef(clampedCursor);
  clampedCursorRef.current = clampedCursor;
  const maxOffsetRef = useRef(maxOffset);
  maxOffsetRef.current = maxOffset;
  const viewHeightRef = useRef(viewHeight);
  viewHeightRef.current = viewHeight;
  const filteredLengthRef = useRef(filteredLines.length);
  filteredLengthRef.current = filteredLines.length;
  const filteredLinesRef = useRef(filteredLines);
  filteredLinesRef.current = filteredLines;
  const searchQueryRef = useRef(searchQuery);
  searchQueryRef.current = searchQuery;

  const clampedOffset = Math.max(
    0,
    Math.min(
      scrollOffset,
      Math.min(maxOffset, Math.max(scrollOffset, clampedCursor - viewHeight + 1))
    )
  );

  useInput((input, key) => {
    const fl = filteredLengthRef.current;
    const cur = clampedCursorRef.current;
    const vh = viewHeightRef.current;
    const mo = maxOffsetRef.current;
    if (key.downArrow || input === "j") {
      setCursor((c) => Math.min(fl - 1, c + 1));
      setScrollOffset((o) => {
        const newCursor = Math.min(fl - 1, cur + 1);
        if (newCursor >= o + vh) return Math.min(mo, o + 1);
        return o;
      });
      return;
    }
    if (key.upArrow || input === "k") {
      setCursor((c) => Math.max(0, c - 1));
      setScrollOffset((o) => {
        const newCursor = Math.max(0, cur - 1);
        if (newCursor < o) return Math.max(0, o - 1);
        return o;
      });
      return;
    }
    if (key.pageDown || input === "d") {
      const half = Math.floor(vh / 2);
      setScrollOffset((o) => Math.min(mo, o + half));
      setCursor((c) => Math.min(fl - 1, c + half));
      return;
    }
    if (key.pageUp || input === "u") {
      const half = Math.floor(vh / 2);
      setScrollOffset((o) => Math.max(0, o - half));
      setCursor((c) => Math.max(0, c - half));
      return;
    }
    if (input === "g") {
      setScrollOffset(0);
      setCursor(0);
      return;
    }
    if (input === "G") {
      setScrollOffset(mo);
      setCursor(fl - 1);
      return;
    }
    if (input === "f") {
      setFilter((prev) => {
        if (prev === "all") return "errors";
        if (prev === "errors") return "tools";
        if (prev === "tools") return "text";
        return "all";
      });
      setScrollOffset(0);
      setCursor(0);
      return;
    }
    if (key.return) {
      const line = filteredLines[clampedCursor];
      if (line?.kind === "tool") {
        const id = line.callId;
        setExpandedIds((prev) => {
          const next = new Set(prev);
          if (next.has(id)) next.delete(id);
          else next.add(id);
          return next;
        });
      } else if (line?.kind === "reasoning-header") {
        const id = line.reasoningId;
        setExpandedReasoningIds((prev) => {
          const next = new Set(prev);
          if (next.has(id)) next.delete(id);
          else next.add(id);
          return next;
        });
      }
      return;
    }
  }, { isActive });

  if (!session) {
    return (
      <Box height={maxHeight} paddingX={1}>
        <Text color={colors.textDim}>Select a session</Text>
      </Box>
    );
  }

  if (filteredLines.length === 0) {
    return (
      <Box height={maxHeight} paddingX={1}>
        <Text color={colors.textDim}>No messages</Text>
      </Box>
    );
  }

  const visibleLines = filteredLines.slice(clampedOffset, clampedOffset + viewHeight);
  const cursorLine = filteredLines[clampedCursor];
  const cursorCumTokens = cursorLine?.cumTokens ?? 0;
  const totalTokens = filteredLines[filteredLines.length - 1]?.cumTokens ?? 0;

  return (
    <Box flexDirection="column" height={maxHeight} paddingX={1}>
      {/* Counter row */}
      <Box flexDirection="row" height={1}>
        <Text color={colors.textDim}>
          {clampedOffset + 1}–{Math.min(clampedOffset + viewHeight, filteredLines.length)}/{filteredLines.length}
        </Text>
        {totalTokens > 0 && (
          <>
            <Text color={colors.textDim}> · </Text>
            <Text color={colors.info}>{formatTokens(cursorCumTokens)}</Text>
            <Text color={colors.textDim}>/{formatTokens(totalTokens)} tok</Text>
          </>
        )}
        {filter !== "all" && (
          <>
            <Text color={colors.textDim}> · </Text>
            <Text color={colors.warning}>{filter}</Text>
          </>
        )}
        {matchIndices.length > 0 && (
          <>
            <Text color={colors.textDim}> · </Text>
            <Text color={colors.teal}>
              {matchIndices.indexOf(clampedCursor) >= 0
                ? `match ${matchIndices.indexOf(clampedCursor) + 1}/${matchIndices.length}`
                : `${matchIndices.length} matches`}
            </Text>
          </>
        )}
        <Box flexGrow={1} />
        <Text color={colors.textDim}>
          {session.interactions.filter((i) => i.role === "assistant").length} turns
        </Text>
        {clampedOffset > 0 && <Text color={colors.textDim}> ↑</Text>}
        {clampedOffset < maxOffset && <Text color={colors.textDim}> ↓</Text>}
      </Box>

      {visibleLines.map((line, i) => {
        const absIdx = clampedOffset + i;
        const isCursor = absIdx === clampedCursor && isActive;
        const isMatch = searchQuery.trim() !== "" && matchIndices.includes(absIdx);
        const sq = searchQuery.trim().toLowerCase();

        switch (line.kind) {
          case "header":
            return (
              <Box key={line.id} flexDirection="row" height={1}>
                <Text color={isCursor ? colors.accent : colors.textDim}>{isCursor ? "›" : " "}</Text>
                <Text color={isCursor ? colors.accent : colors.purple} bold>◆ </Text>
                <Text color={isCursor ? colors.accent : colors.info}>{truncate(line.modelId, 22)}</Text>
                {line.agent && <Text color={colors.cyan}> [{line.agent}]</Text>}
                <Box flexGrow={1} />
                {line.tokensIn > 0 && <><Text color={colors.textDim}>↓</Text><Text color={colors.warning}>{formatTokens(line.tokensIn)}</Text><Text> </Text></>}
                {line.tokensOut > 0 && <><Text color={colors.textDim}>↑</Text><Text color={colors.success}>{formatTokens(line.tokensOut)}</Text><Text> </Text></>}
                {line.duration && <Text color={colors.cyan}>{line.duration} </Text>}
                <Text color={colors.textDim}>{line.time}</Text>
              </Box>
            );

          case "tool":
            return (
              <Box key={line.id} flexDirection="row" height={1} paddingLeft={1}>
                <Text color={isCursor ? colors.accent : isMatch ? colors.teal : colors.textDim}>{isCursor ? "›" : isMatch ? "◈" : " "}</Text>
                <Text color={line.iconColor}>{line.icon} </Text>
                {isMatch && !isCursor
                  ? <HighlightText text={line.name} query={sq} baseColor={colors.text} />
                  : <Text color={isCursor ? colors.accent : colors.text} bold={isCursor}>{line.name}</Text>}
                {line.title && <Text color={colors.textDim}> {line.title}</Text>}
                <Box flexGrow={1} />
                <Text color={colors.textDim}>{line.expanded ? "▼ " : "▶ "}</Text>
                {line.right && <Text color={colors.textDim}>{line.right}</Text>}
              </Box>
            );

          case "tool-detail":
            if (line.isSection) {
              return (
                <Box key={line.id} height={1} paddingLeft={3}>
                  <Text color={isCursor ? colors.accent : colors.textDim}>{isCursor ? "›" : " "}</Text>
                  <Text color={colors.purple}>── {line.label} </Text>
                </Box>
              );
            }
            return (
              <Box key={line.id} height={1} paddingLeft={4}>
                <Text color={isCursor ? colors.accent : isMatch ? colors.teal : colors.textDim}>{isCursor ? "›" : isMatch ? "◈" : " "}</Text>
                {line.label
                  ? <><Text color={colors.cyan}>{line.label}</Text><Text color={colors.textDim}>: </Text>
                      {isMatch && !isCursor
                        ? <HighlightText text={line.value} query={sq} baseColor={colors.text} />
                        : <Text color={isCursor ? colors.accent : colors.text}>{line.value}</Text>}
                    </>
                  : isMatch && !isCursor
                    ? <HighlightText text={line.value} query={sq} baseColor={colors.textDim} />
                    : <Text color={isCursor ? colors.accent : colors.textDim}>{line.value}</Text>
                }
              </Box>
            );

          case "text":
            return (
              <Box key={line.id} flexDirection="row" height={1} paddingLeft={1}>
                <Text color={isCursor ? colors.accent : isMatch ? colors.teal : colors.textDim}>{isCursor ? "›" : isMatch ? "◈" : " "}</Text>
                {isMatch && !isCursor
                  ? <><Text color={colors.text}> </Text><HighlightText text={line.text} query={sq} baseColor={colors.text} /></>
                  : <Text color={isCursor ? colors.accent : colors.text}> {line.text}</Text>}
              </Box>
            );

          case "reasoning-header":
            return (
              <Box key={line.id} flexDirection="row" height={1} paddingLeft={1}>
                <Text color={isCursor ? colors.accent : isMatch ? colors.teal : colors.textDim}>{isCursor ? "›" : isMatch ? "◈" : " "}</Text>
                <Text color={isCursor ? colors.accent : colors.accentDim}> ⚡ [reasoning] {line.expanded ? "▼" : "▶"} </Text>
                {isMatch && !isCursor
                  ? <HighlightText text={line.preview.slice(0, 50)} query={sq} baseColor={colors.accentDim} />
                  : <Text color={isCursor ? colors.accent : colors.accentDim}>{line.preview.slice(0, 50)}</Text>}
                <Text color={colors.textDim}> ({line.charCount}c)</Text>
              </Box>
            );

          case "reasoning":
            return (
              <Box key={line.id} flexDirection="row" height={1} paddingLeft={1}>
                <Text color={isCursor ? colors.accent : isMatch ? colors.teal : colors.textDim}>{isCursor ? "›" : isMatch ? "◈" : " "}</Text>
                {isMatch && !isCursor
                  ? <><Text color={colors.accentDim}> ⚡ </Text><HighlightText text={line.text} query={sq} baseColor={colors.accentDim} /></>
                  : <Text color={isCursor ? colors.accent : colors.accentDim}> ⚡ {line.text}</Text>}
              </Box>
            );
        }
      })}
    </Box>
  );
}

export const MessagesPanel = memo(MessagesPanelInner);
