import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import {
  universalMcpExcludedRoutes,
  universalMcpRoutePolicy,
} from './universal-mcp-route-policy.mjs';

const worker = fs.readFileSync(new URL('../src/worker.ts', import.meta.url), 'utf8');
const productSources = ['../src/universal-mcp.ts', '../src/orchestrator-mcp.ts', '../src/mcp.ts']
  .map((file) => fs.readFileSync(new URL(file, import.meta.url), 'utf8'))
  .join('\n');
const routePattern = /app\.(get|post|put|patch|delete)\(\s*['"]([^'"]+)/g;
const routes = [];
for (const match of worker.matchAll(routePattern)) {
  const route = `${match[1].toUpperCase()} ${match[2]}`;
  if (match[2] === '/mcp' || match[2].startsWith('/api/')) routes.push(route);
}
const dynamicRoutePattern =
  /for \(const (\w+) of \[([^\]]+)\]\) \{\s*app\.(get|post|put|patch|delete)\(\s*`([^`]+)`/g;
for (const match of worker.matchAll(dynamicRoutePattern)) {
  const values = [...match[2].matchAll(/['"]([^'"]+)['"]/g)].map((value) => value[1]);
  for (const value of values) {
    const routePath = match[4].replace(`\${${match[1]}}`, value);
    if (routePath === '/mcp' || routePath.startsWith('/api/'))
      routes.push(`${match[3].toUpperCase()} ${routePath}`);
  }
}
const uniqueRoutes = [...new Set(routes)].sort();
const unmappedOperations = uniqueRoutes.filter(
  (route) => !(route in universalMcpRoutePolicy) && !(route in universalMcpExcludedRoutes),
);
const manifestProcess = spawnSync(
  'bun',
  [
    '-e',
    "import { universalMcpOperations } from './src/universal-mcp.ts'; console.log(JSON.stringify(universalMcpOperations.map(({name,kind}) => ({name,kind}))));",
  ],
  { encoding: 'utf8' },
);
assert.equal(manifestProcess.status, 0, manifestProcess.stderr);
const manifestOperations = JSON.parse(manifestProcess.stdout);
const mappedNames = new Set(
  Object.values(universalMcpRoutePolicy).flatMap((mapping) =>
    mapping.includes(':') ? mapping.slice(mapping.indexOf(':') + 1).split(',') : [],
  ),
);
const productNativeOperations = new Set([
  'ui_open_conversation',
  'reviews',
  'operation_receipts',
  'fleet_changed',
]);
const unmappedManifestOperations = manifestOperations
  .map((operation) => operation.name)
  .filter((name) => !mappedNames.has(name) && !productNativeOperations.has(name));
const overlapping = Object.keys(universalMcpRoutePolicy).filter(
  (route) => route in universalMcpExcludedRoutes,
);
const invalidMappings = [];
for (const [route, mapping] of Object.entries(universalMcpRoutePolicy)) {
  const names = mapping.includes(':') ? mapping.slice(mapping.indexOf(':') + 1).split(',') : [];
  for (const name of names) {
    if (name === 'universal' || name === 'universal-mcp') continue;
    const generatedJobTool =
      name.startsWith('agent_job_') &&
      productSources.includes('name: `agent_job_${action}`') &&
      productSources.includes(`'${name.slice('agent_job_'.length)}'`);
    if (!productSources.includes(name) && !generatedJobTool) invalidMappings.push({ route, name });
  }
}
assert.deepEqual(overlapping, [], 'A route cannot be both mapped and excluded');
assert.deepEqual(invalidMappings, [], 'Every route mapping must name an implemented MCP operation');
const result = {
  routes: uniqueRoutes,
  mapped: uniqueRoutes.filter((route) => route in universalMcpRoutePolicy),
  excluded: uniqueRoutes
    .filter((route) => route in universalMcpExcludedRoutes)
    .map((route) => ({ route, reason: universalMcpExcludedRoutes[route] })),
  manifestOperations,
  unmappedManifestOperations,
  unmappedOperations: [...unmappedOperations, ...unmappedManifestOperations],
};
if (process.argv.includes('--json')) console.log(JSON.stringify(result, null, 2));
else
  console.log(
    `UNIVERSAL_MCP_COVERAGE routes=${result.routes.length} unmapped=${unmappedOperations.length}`,
  );
if (unmappedOperations.length > 0) process.exitCode = 1;
