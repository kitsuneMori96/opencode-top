import React from "react";
import { describe, it, expect } from "vitest";
import { Box } from "ink";
import { render } from "ink-testing-library";
import stringWidth from "string-width";
import { AgentTree } from "../ui/components/AgentTree";
import { DetailsPanel } from "../ui/components/DetailsPanel";
import type { Session, Workflow, AgentNode, FlatNode } from "../core/types";

function sess(id: string, title: string, parentId: string | null = null): Session {
  return {
    id,
    parentId,
    projectId: "p1",
    projectName: "测试项目",
    title,
    timeCreated: 1700000000000,
    timeUpdated: 1700000001000,
    timeArchived: null,
    interactions: [],
    source: "sqlite",
  };
}

function node(session: Session, children: AgentNode[] = [], depth = 0): AgentNode {
  return { session, children, depth };
}

function cjkWorkflow(id: string, title: string, childTitles: string[]): Workflow {
  const main = sess(id, title);
  const kids = childTitles.map((t, i) => node(sess(`${id}-c${i}`, t, id), [], 1));
  const tree = node(main, kids, 0);
  return { id, mainSession: main, subAgentSessions: kids.map((k) => k.session), agentTree: tree };
}

function flatNodesOf(w: Workflow, expanded: boolean): FlatNode[] {
  const out: FlatNode[] = [];
  const walk = (n: AgentNode) => {
    out.push({
      id: n.session.id,
      session: n.session,
      workflowIndex: 0,
      depth: n.depth,
      hasChildren: n.children.length > 0,
      agentNode: n,
    });
    if (n.depth === 0 && !expanded) return;
    for (const c of n.children) walk(c);
  };
  walk(w.agentTree);
  return out;
}

function stripAnsi(s: string): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: intentional ANSI stripping
  return s.replace(/\x1b\[[0-9;?]*[a-zA-Z]|\x1b\([0-9A-B]/g, "");
}

async function lastFrame(element: React.ReactElement, columns: number): Promise<string[]> {
  const inst = render(element, { stdout: { columns } as never });
  await new Promise((r) => setTimeout(r, 100));
  const frame = stripAnsi(inst.lastFrame() ?? "");
  inst.unmount();
  return frame.split("\n");
}

describe("AgentTree layout (CJK overprint regression)", () => {
  it("rows never exceed container width with CJK titles", async () => {
    // 21 CJK chars = 21 chars but 42 cols: old char-count truncate keeps it whole -> overflow
    const w = cjkWorkflow("w1", "图片下载按钮插件测试超长标题一二三四五六七", [
      "[explore] 研究 AstrBot provider",
      "Vocal2Midi添加输出力度曲线",
    ]);
    const lines = await lastFrame(
      <Box width={60}>
        <AgentTree
          workflows={[w]}
          selectedId="w1"
          flatNodes={flatNodesOf(w, true)}
          onSelect={() => {}}
          maxHeight={10}
          expandedIds={new Set(["w1"])}
        />
      </Box>,
      60
    );
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      expect(stringWidth(line) <= 60, `overflow: ${line}`).toBe(true);
    }
    // All three sessions visible on separate rows
    const text = lines.join("\n");
    expect(text).toContain("图片下载");
    expect(text).toContain("Vocal2Midi");
  });

  it("collapsed workflow shows ▸ and only the root row", async () => {
    const w = cjkWorkflow("w1", "设计 OpenUtau到LRC日语歌词", ["[explore] Check"]);
    const lines = await lastFrame(
      <Box width={60}>
        <AgentTree
          workflows={[w]}
          selectedId="w1"
          flatNodes={flatNodesOf(w, false)}
          onSelect={() => {}}
          maxHeight={10}
          expandedIds={new Set()}
        />
      </Box>,
      60
    );
    const text = lines.join("\n");
    expect(text).toContain("▸");
    expect(text).not.toContain("Check");
  });
});

describe("DetailsPanel AGENT CHAIN fold", () => {
  it("auto-collapses chains with more than 5 sub-agents", async () => {
    const w = cjkWorkflow(
      "wbig",
      "Wave Memory",
      Array.from({ length: 8 }, (_, i) => `子任务${i}调研代码位置`)
    );
    const lines = await lastFrame(
      <DetailsPanel workflow={w} height={30} chainCollapsed={null} />,
      80
    );
    const text = lines.join("\n");
    expect(text).toContain("AGENT CHAIN (8)");
    expect(text).toContain("c:expand");
    expect(text).not.toContain("子任务0");
    for (const line of lines) {
      expect(stringWidth(line) <= 64, `overflow: ${line}`).toBe(true);
    }
  });

  it("keeps small chains expanded and caps huge chains at 15 rows", async () => {
    const small = cjkWorkflow("wsmall", "小任务", ["子任务A", "子任务B"]);
    const smallText = (
      await lastFrame(<DetailsPanel workflow={small} height={30} chainCollapsed={null} />, 80)
    ).join("\n");
    expect(smallText).toContain("子任务A");

    const huge = cjkWorkflow(
      "whuge",
      "大任务",
      Array.from({ length: 20 }, (_, i) => `子任务${i}`)
    );
    const hugeText = (
      await lastFrame(<DetailsPanel workflow={huge} height={40} chainCollapsed={false} />, 80)
    ).join("\n");
    expect(hugeText).toContain("子任务0");
    expect(hugeText).toContain("+5 more");
    expect(hugeText).not.toContain("子任务15");
  });
});
