import stringWidth from "string-width";

/** Display column width (CJK = 2, ASCII = 1) */
export function displayWidth(s: string): number {
  return stringWidth(s);
}

/**
 * Truncate a string to fit within maxCols display columns.
 * Appends "…" (1 col) when truncated. Never splits a wide char.
 */
export function truncateDisplay(s: string, maxCols: number): string {
  if (maxCols <= 0) return "";
  if (stringWidth(s) <= maxCols) return s;
  if (maxCols === 1) return "…";
  let width = 0;
  let out = "";
  for (const ch of s) {
    const w = stringWidth(ch);
    if (width + w > maxCols - 1) break;
    out += ch;
    width += w;
  }
  return `${out}…`;
}
