import React, { memo } from "react";
import { Box, Text } from "ink";
import { colors } from "../theme";

export function buildAxisLine(labels: string[], chartWidth: number, tickIdx?: number[]): string {
  const count = labels.length;
  if (count <= 1) return labels[0] ?? "";
  const ticks = tickIdx ?? (count <= 8 ? [0, count - 1] : [0, Math.round((count - 1) / 2), count - 1]);
  const arr = Array(chartWidth).fill(" ");
  for (const t of ticks) {
    const lab = labels[t] ?? "";
    let col = Math.round(t * (chartWidth - 1) / (count - 1));
    if (t === count - 1) col = chartWidth - lab.length;
    for (let k = 0; k < lab.length && col + k < chartWidth; k++) arr[col + k] = lab[k];
  }
  return arr.join("");
}

interface BarChartProps {
  values: number[];
  color?: string;
  width: number;
  height?: number;
}

function BarChartInner({ values, color = colors.accentAlt, width, height = 3 }: BarChartProps) {
  const max = Math.max(...values, 0);
  const rows: React.ReactNode[] = [];
  for (let d = 0; d < height; d++) {
    let line = "";
    for (let c = 0; c < width; c++) {
      const idx = values.length === width
        ? c
        : Math.min(values.length - 1, Math.floor(c * values.length / width));
      const v = values[idx] ?? 0;
      const filled = max > 0 ? (v / max) * height : 0;
      line += filled >= height - d ? "█" : filled >= height - d - 0.5 ? "▄" : " ";
    }
    rows.push(<Text key={d} color={color}>{line}</Text>);
  }
  return <Box flexDirection="column">{rows}</Box>;
}

export const BarChart = memo(BarChartInner);
