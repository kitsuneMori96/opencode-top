import stringWidth from "string-width";
import { describe, expect, it } from "vitest";
import { displayWidth, truncateDisplay } from "../ui/text";

describe("displayWidth", () => {
  it("counts ascii as 1", () => {
    expect(displayWidth("hello")).toBe(5);
  });
  it("counts cjk as 2", () => {
    expect(displayWidth("图片下载")).toBe(8);
  });
  it("counts mixed correctly", () => {
    expect(displayWidth("neuro-sama图片下载按钮插件")).toBe(26);
  });
});

describe("truncateDisplay", () => {
  it("returns short strings unchanged", () => {
    expect(truncateDisplay("hello", 10)).toBe("hello");
    expect(truncateDisplay("图片", 4)).toBe("图片");
  });
  it("truncates ascii with ellipsis", () => {
    expect(truncateDisplay("hello world", 8)).toBe("hello w…");
  });
  it("never exceeds maxCols with cjk", () => {
    const cases: [string, number][] = [
      ["neuro-sama图片下载按钮插件", 22],
      ["neuro-sama图片下载按钮插件", 20],
      ["设计 OpenUtau到 LRC日语歌词", 22],
      ["调研 0a/0b 代码位置 (@exp", 20],
      ["[explore] 研究 AstrBot provider", 20],
    ];
    for (const [s, max] of cases) {
      const out = truncateDisplay(s, max);
      expect(stringWidth(out) <= max, `${out} width > ${max}`).toBe(true);
    }
  });
  it("never splits a wide char in half", () => {
    // "ab"=2 cols, "图"=2 cols; ellipsis reserves 1 col
    expect(truncateDisplay("ab图cd", 4)).toBe("ab…");
    expect(truncateDisplay("ab图cd", 5)).toBe("ab图…");
    expect(truncateDisplay("ab图cd", 6)).toBe("ab图cd");
  });
  it("handles edge widths", () => {
    expect(truncateDisplay("hello", 0)).toBe("");
    expect(truncateDisplay("hello", 1)).toBe("…");
  });
});
