import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  type SimulationNodeDatum,
} from 'd3-force';
import type { CommunicationEvent } from './agent-communication';
import type { ThreadNode } from './thread-tree';

export type FleetOperationsAgent = Pick<
  ThreadNode,
  'id' | 'parentId' | 'title' | 'avatarSeed' | 'status'
> & {
  context: { used: number; capacity: number; ratio: number };
};

export type FleetOperationsEvent = Pick<
  CommunicationEvent,
  'id' | 'type' | 'fromAgentId' | 'toAgentId' | 'action' | 'occurredAt'
>;

export type FleetPoint = FleetOperationsAgent & { x: number; y: number; radius: number };

function hash(value: string): number {
  let result = 2166136261;
  for (const character of value) {
    result ^= character.charCodeAt(0);
    result = Math.imul(result, 16777619);
  }
  return result >>> 0;
}

function randomSource(seed: number): () => number {
  let value = seed || 1;
  return () => {
    value = Math.imul(value, 1664525) + 1013904223;
    return (value >>> 0) / 4294967296;
  };
}

export function contextRadius(ratio: number): number {
  return 26 + Math.round(Math.max(0, Math.min(1, ratio)) * 16);
}

export function createFleetLayout(
  agents: readonly FleetOperationsAgent[],
  width: number,
  height: number,
): FleetPoint[] {
  const ordered = [...agents].sort((left, right) => left.id.localeCompare(right.id));
  const nodes: Array<FleetOperationsAgent & SimulationNodeDatum> = ordered.map((agent, index) => {
    const angle = (index / Math.max(ordered.length, 1)) * Math.PI * 2;
    const spread = Math.min(width, height) * 0.28;
    return {
      ...agent,
      x: width / 2 + Math.cos(angle) * spread,
      y: height / 2 + Math.sin(angle) * spread,
    };
  });
  const links = ordered
    .filter(
      (agent) => agent.parentId && ordered.some((candidate) => candidate.id === agent.parentId),
    )
    .map((agent) => ({ source: agent.parentId as string, target: agent.id }));
  const simulation = forceSimulation(nodes)
    .randomSource(randomSource(hash(ordered.map((agent) => agent.id).join('|'))))
    .force(
      'link',
      forceLink<(typeof nodes)[number], (typeof links)[number]>(links)
        .id((node) => node.id)
        .distance(120)
        .strength(0.8),
    )
    .force('charge', forceManyBody().strength(-280))
    .force('center', forceCenter(width / 2, height / 2))
    .force(
      'collision',
      forceCollide<(typeof nodes)[number]>((node) => contextRadius(node.context.ratio) + 28),
    )
    .stop();
  for (let index = 0; index < 500; index += 1) simulation.tick();
  const positioned = nodes.map((node) => ({
    ...node,
    x: node.x ?? width / 2,
    y: node.y ?? height / 2,
    radius: contextRadius(node.context.ratio),
  }));
  const bounds = positioned.reduce(
    (result, node) => ({
      minimumX: Math.min(result.minimumX, node.x - node.radius),
      maximumX: Math.max(result.maximumX, node.x + node.radius),
      minimumY: Math.min(result.minimumY, node.y - node.radius),
      maximumY: Math.max(result.maximumY, node.y + node.radius),
    }),
    { minimumX: Infinity, maximumX: -Infinity, minimumY: Infinity, maximumY: -Infinity },
  );
  const graphWidth = Math.max(1, bounds.maximumX - bounds.minimumX);
  const graphHeight = Math.max(1, bounds.maximumY - bounds.minimumY);
  const scale = Math.min(1, (width - 108) / graphWidth, (height - 108) / graphHeight);
  const graphCenterX = (bounds.minimumX + bounds.maximumX) / 2;
  const graphCenterY = (bounds.minimumY + bounds.maximumY) / 2;
  return positioned.map((node) => ({
    ...node,
    x: Math.round((width / 2 + (node.x - graphCenterX) * scale) * 100) / 100,
    y: Math.round((height / 2 + (node.y - graphCenterY) * scale) * 100) / 100,
    radius: node.radius * scale,
  }));
}

export function boundedCommunicationEvents(
  events: readonly CommunicationEvent[],
  agentIds: ReadonlySet<string>,
  limit = 80,
): FleetOperationsEvent[] {
  const safeLimit = Math.max(0, Math.min(100, Math.floor(limit)));
  return events
    .filter((event) => agentIds.has(event.fromAgentId) && agentIds.has(event.toAgentId))
    .sort((left, right) => right.occurredAt.localeCompare(left.occurredAt))
    .slice(0, safeLimit)
    .map(({ id, type, fromAgentId, toAgentId, action, occurredAt }) => ({
      id,
      type,
      fromAgentId,
      toAgentId,
      action,
      occurredAt,
    }));
}
