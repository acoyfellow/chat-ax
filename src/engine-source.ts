export type EngineSourceEnv = {
  BUILD_ID?: string;
  ENGINE_REPO?: string;
};

export type EngineSource = { owner: string; repo: string; commit: string };

const commitPattern = /^[0-9a-f]{40}$/;
const repoPattern = /^(?:https:\/\/github\.com\/)?([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?$/;
const pathPattern = /^(?!.*\.\.)[A-Za-z0-9_./-]{1,300}$/;
export const maximumSourceBytes = 60_000;

export function engineSource(env: EngineSourceEnv): EngineSource | null {
  const commit = env.BUILD_ID?.trim() ?? '';
  const match = repoPattern.exec(env.ENGINE_REPO?.trim() ?? '');
  if (!commitPattern.test(commit) || !match) return null;
  return { owner: match[1], repo: match[2], commit };
}

export function safeSourcePath(path: string): string | null {
  const trimmed = path.trim().replace(/^\/+/, '');
  return pathPattern.test(trimmed) ? trimmed : null;
}

function githubHeaders(): HeadersInit {
  return { accept: 'application/vnd.github+json', 'user-agent': 'chat-ax-engine-source' };
}

export async function listEngineFiles(source: EngineSource, prefix: string): Promise<string[]> {
  const response = await fetch(
    `https://api.github.com/repos/${source.owner}/${source.repo}/git/trees/${source.commit}?recursive=1`,
    { headers: githubHeaders() },
  );
  if (!response.ok) throw new Error(`Could not list the engine source (HTTP ${response.status})`);
  const body = (await response.json()) as { tree?: { path?: unknown; type?: unknown }[] };
  return (body.tree ?? [])
    .flatMap((entry) => (entry.type === 'blob' && typeof entry.path === 'string' ? [entry.path] : []))
    .filter((path) => path.startsWith(prefix) && !path.startsWith('node_modules/'))
    .slice(0, 400);
}

export async function readEngineFile(source: EngineSource, path: string): Promise<{ text: string; truncated: boolean }> {
  const response = await fetch(
    `https://raw.githubusercontent.com/${source.owner}/${source.repo}/${source.commit}/${path}`,
    { headers: { 'user-agent': 'chat-ax-engine-source' } },
  );
  if (response.status === 404) throw new Error(`${path} does not exist at engine commit ${source.commit.slice(0, 7)}`);
  if (!response.ok) throw new Error(`Could not read ${path} (HTTP ${response.status})`);
  const text = await response.text();
  return { text: text.slice(0, maximumSourceBytes), truncated: text.length > maximumSourceBytes };
}
