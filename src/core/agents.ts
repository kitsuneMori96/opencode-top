import type { Session, Workflow, AgentNode } from "./types";

export class AgentRegistry {
  private mainAgents = new Set(["plan", "build"]);
  private subAgents = new Set(["explore"]);

  isMainAgent(agent: string | null): boolean {
    if (!agent) return true;
    return this.mainAgents.has(agent);
  }

  isSubAgent(agent: string | null): boolean {
    if (!agent) return false;
    return this.subAgents.has(agent);
  }

  addMainAgent(agent: string): void {
    this.mainAgents.add(agent);
  }

  addSubAgent(agent: string): void {
    this.subAgents.add(agent);
  }
}

function buildAgentNode(
  session: Session,
  sessionMap: Map<string, Session>,
  depth: number
): AgentNode {
  // Find all direct children of this session
  const children: AgentNode[] = [];
  for (const [, s] of sessionMap) {
    if (s.parentId === session.id) {
      children.push(buildAgentNode(s, sessionMap, depth + 1));
    }
  }
  // Sort children by most recent activity first (timeUpdated preferred)
  children.sort(
    (a, b) =>
      ((b.session.timeUpdated ?? b.session.timeCreated ?? 0) as number) -
      ((a.session.timeUpdated ?? a.session.timeCreated ?? 0) as number)
  );
  return { session, children, depth };
}

function collectAllDescendants(node: AgentNode): Session[] {
  const result: Session[] = [];
  for (const child of node.children) {
    result.push(child.session);
    result.push(...collectAllDescendants(child));
  }
  return result;
}

function latestActivity(sessions: Session[]): number {
  let max = 0;
  for (const s of sessions) {
    const ts = s.timeUpdated ?? s.timeCreated ?? 0;
    if (ts > max) max = ts;
  }
  return max;
}

export function groupSessionsToWorkflows(
  sessions: Session[],
  _registry?: AgentRegistry
): Workflow[] {
  const sessionMap = new Map<string, Session>(sessions.map((s) => [s.id, s]));

  // Find root sessions (no parentId)
  const roots = sessions.filter((s) => s.parentId === null);

  const workflows: Workflow[] = [];

  for (const root of roots) {
    const agentTree = buildAgentNode(root, sessionMap, 0);
    const subAgentSessions = collectAllDescendants(agentTree);

    workflows.push({
      id: root.id,
      mainSession: root,
      subAgentSessions,
      agentTree,
    });
  }

  // Most recently active workflow first
  workflows.sort(
    (a, b) =>
      latestActivity([b.mainSession, ...b.subAgentSessions]) -
      latestActivity([a.mainSession, ...a.subAgentSessions])
  );

  return workflows;
}
