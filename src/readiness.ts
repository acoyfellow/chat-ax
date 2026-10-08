export type ReadinessStatus = {
  status: 'ready' | 'not-ready';
  service: 'chat-ax';
  release: string;
  build: string;
  schema: 5;
};

const requiredBindings = [
  'ROOM',
  'AGENT',
  'CONNECTOR_VAULT',
  'FILES',
  'AI',
  'CF_ACCESS_ISS',
  'CF_ACCESS_AUD',
] as const;

export function readinessStatus(environment: object): ReadinessStatus {
  const value = (name: string): unknown => Reflect.get(environment, name);
  const ready = requiredBindings.every((name) => Boolean(value(name)));
  const release = value('AUTHORITY_RELEASE');
  const build = value('BUILD_ID');
  return {
    status: ready ? 'ready' : 'not-ready',
    service: 'chat-ax',
    release: typeof release === 'string' ? release : 'unknown',
    build: typeof build === 'string' ? build : 'unknown',
    schema: 5,
  };
}
