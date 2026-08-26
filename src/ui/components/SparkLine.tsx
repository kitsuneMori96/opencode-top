import React, { memo } from "react";
import { Text } from "ink";
import { colors } from "../theme";
import { buildSparkSeries } from "../../core/session";

interface SparkLineProps {
  values: number[];
  color?: string;
  width?: number;
}

function SparkLineInner({ values, color = colors.info, width }: SparkLineProps) {
  const chartWidth = width
    ? Math.max(1, Math.round(Math.sqrt(width * 12)))
    : values.length;
  const data =
    values.length > chartWidth
      ? values.slice(values.length - chartWidth)
      : values.length < chartWidth
      ? [...values, ...new Array(chartWidth - values.length).fill(0)]
      : values;
  const spark = buildSparkSeries(data);
  return <Text color={color}>{spark}</Text>;
}

export const SparkLine = memo(SparkLineInner);
