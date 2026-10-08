import assert from 'node:assert/strict';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';
import { loadConfig, readOpenApiProject } from '../dist/index.js';

test('selects custom extension fields, escaped pointer tokens, and handles collisions', async () => {
  const root = resolve('test/tmp/namespace-source');
  await rm(root, { recursive: true, force: true });
  await mkdir(root, { recursive: true });
  await writeFile(`${root}/api.json`, JSON.stringify({
    'x/meta': { 'namespace~name': 'billing-api' },
    paths: {
      '/one': { get: { operationId: 'getItem', tags: ['Items'] } },
      '/two': { get: { operationId: 'getItem', tags: ['Items'] } }
    }
  }));
  const strategy = 'namespaceTagAndOperationId';
  const project = await readOpenApiProject(root, strategy, { pointer: '/x~1meta/namespace~0name' });
  assert.deepEqual(project.endpoints.map(endpoint => endpoint.name), ['BillingApi_Items_getItem', 'BillingApi_Items_getItem2']);
  for (const config of [
    { pointer: '/missing' },
    { pointer: '/paths' },
    { pointer: '/x~1meta/namespace~0name', pattern: '^unmatched$' },
    { pointer: '/x~1meta/namespace~0name', pattern: '^()' }
  ]) {
    await assert.rejects(readOpenApiProject(root, strategy, config), /api.json: namespace/);
  }
  await assert.rejects(readOpenApiProject(root, strategy), /endpoint-namespace.pointer/);
});

test('validates namespace configuration loaded from JSON', async () => {
  const root = resolve('test/tmp/namespace-config');
  await rm(root, { recursive: true, force: true });
  await mkdir(root, { recursive: true });
  const path = `${root}/config.json`;
  const config = {
    client: 'angular',
    'swaggers-directory': root,
    'endpoint-name-strategy': 'namespaceTagAndOperationId',
    output: { 'api-models.ts': 'models.ts', 'api-endpoints.ts': 'endpoints.ts', 'client.ts': 'client.ts' }
  };
  for (const namespace of [undefined, { pointer: 'servers[0].url' }, { pointer: '/bad~2key' }, { pointer: '/url', pattern: '[' }, { pointer: '/url', pattern: 1 }]) {
    await writeFile(path, JSON.stringify({ ...config, 'endpoint-namespace': namespace }));
    await assert.rejects(loadConfig(path), /endpoint-namespace/);
  }
  await writeFile(path, JSON.stringify({ ...config, 'endpoint-namespace': { pointer: '/servers/0/url', pattern: '^/([^/]+)' } }));
  assert.equal((await loadConfig(path))['endpoint-name-strategy'], 'namespaceTagAndOperationId');
});
