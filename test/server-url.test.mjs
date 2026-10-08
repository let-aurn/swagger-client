import assert from 'node:assert/strict';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';
import { generate, loadConfig, readOpenApiProject } from '../dist/index.js';

test('prefixes generated paths with the selected server for each document and client', async () => {
  for (const client of ['angular', 'react']) {
    const root = resolve(`test/tmp/server-url-${client}`);
    const swaggers = `${root}/swaggers`;
    await rm(root, { recursive: true, force: true });
    await mkdir(swaggers, { recursive: true });
    for (const name of ['some-api', 'other-api']) {
      await writeFile(`${swaggers}/${name}.json`, JSON.stringify({
        openapi: '3.0.1',
        servers: [{ url: `/${name}/V01/xxx/` }, { url: `/${name}/v2` }],
        paths: {
          '/posts/{id}': {
            get: {
              operationId: `${name}_getPost`,
              parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }]
            }
          },
          '/': { get: { operationId: `${name}_root` } }
        }
      }));
    }
    const config = {
      client,
      'swaggers-directory': swaggers,
      serverUrlIndex: 0,
      output: {
        'api-models.ts': `${root}/api-models.ts`,
        'api-endpoints.ts': `${root}/api-endpoints.ts`,
        'client.ts': `${root}/client.ts`
      }
    };
    await generate(config);
    const endpoints = await readFile(config.output['api-endpoints.ts'], 'utf8');
    for (const name of ['some-api', 'other-api']) {
      assert.ok(endpoints.includes(`path: "/${name}/V01/xxx/posts/{id}"`));
      assert.ok(endpoints.includes(`path: "/${name}/V01/xxx/"`));
    }
    assert.match(endpoints, /defineEndpoint<\{ id: number \}/);

    const secondServer = await readOpenApiProject(swaggers, undefined, undefined, 1);
    assert.deepEqual(secondServer.endpoints.map(endpoint => endpoint.path), [
      '/other-api/v2/posts/{id}', '/other-api/v2/',
      '/some-api/v2/posts/{id}', '/some-api/v2/'
    ]);
    const original = await readOpenApiProject(swaggers);
    assert.deepEqual(original.endpoints.map(endpoint => endpoint.path), ['/posts/{id}', '/', '/posts/{id}', '/']);
  }
});

test('preserves the server URL for empty GET and PUT paths with namespace naming', async () => {
  const root = resolve('test/tmp/server-url-empty-path');
  const swaggers = `${root}/swaggers`;
  await rm(root, { recursive: true, force: true });
  await mkdir(swaggers, { recursive: true });
  for (const serverUrl of ['/bvn-api/V01/remarks', '/bvn-api/V01/remarks/']) {
    await writeFile(`${swaggers}/testremark.json`, JSON.stringify({
      openapi: '3.0.1',
      servers: [{ url: serverUrl }],
      paths: {
        '': {
          get: { operationId: 'getRemarks', tags: ['Remark operations'] },
          put: { operationId: 'saveRemark', tags: ['Remark operations'] }
        }
      }
    }));
    await generate({
      client: 'react',
      'swaggers-directory': swaggers,
      'endpoint-name-strategy': 'namespaceTagAndOperationId',
      'endpoint-namespace': { pointer: '/servers/0/url', pattern: '^/([^/]+)' },
      serverUrlIndex: 0,
      output: {
        'api-models.ts': `${root}/api-models.ts`,
        'api-endpoints.ts': `${root}/api-endpoints.ts`,
        'client.ts': `${root}/client.ts`
      }
    });
    const endpoints = await readFile(`${root}/api-endpoints.ts`, 'utf8');
    assert.match(endpoints, /export const BvnApi_RemarkOperations_getRemarks/);
    assert.match(endpoints, /export const BvnApi_RemarkOperations_saveRemark/);
    assert.deepEqual([...endpoints.matchAll(/method: "(GET|PUT)",\s+path: "([^"]*)"/g)].map(match => match.slice(1)), [
      ['GET', serverUrl], ['PUT', serverUrl]
    ]);
  }
});

test('rejects invalid server indexes in both JSON config and direct generation', async () => {
  const root = resolve('test/tmp/server-url-config');
  await rm(root, { recursive: true, force: true });
  await mkdir(root, { recursive: true });
  const configPath = `${root}/config.json`;
  const config = {
    client: 'react',
    'swaggers-directory': root,
    output: { 'api-models.ts': `${root}/models.ts`, 'api-endpoints.ts': `${root}/endpoints.ts`, 'client.ts': `${root}/client.ts` }
  };
  for (const serverUrlIndex of [-1, 0.5, '0', null, true, Number.MAX_SAFE_INTEGER + 1]) {
    await writeFile(configPath, JSON.stringify({ ...config, serverUrlIndex }));
    await assert.rejects(loadConfig(configPath), /serverUrlIndex.*non-negative safe integer/);
    await assert.rejects(generate({ ...config, serverUrlIndex }), /serverUrlIndex.*non-negative safe integer/);
  }
  for (const serverUrlIndex of [undefined, 0, 1]) {
    await writeFile(configPath, JSON.stringify({ ...config, serverUrlIndex }));
    assert.equal((await loadConfig(configPath)).serverUrlIndex, serverUrlIndex);
  }
});

test('reports the source file when the selected server URL is unavailable or invalid', async () => {
  const root = resolve('test/tmp/server-url-invalid');
  await rm(root, { recursive: true, force: true });
  await mkdir(root, { recursive: true });
  for (const servers of [undefined, [], [{ url: '/only-server' }], [null, null], [{}, {}], [{}, { url: '' }], [{}, { url: '  ' }], [{}, { url: 42 }], { 1: { url: '/invalid-array' } }]) {
    await writeFile(`${root}/api.json`, JSON.stringify({ servers, paths: { '/posts': { get: {} } } }));
    await assert.rejects(readOpenApiProject(root, undefined, undefined, 1), /api.json: servers\[1\]\.url must be a non-empty string/);
    assert.equal((await readOpenApiProject(root)).endpoints[0].path, '/posts');
  }
});
