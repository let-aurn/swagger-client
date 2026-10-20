import assert from 'node:assert/strict';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import test from 'node:test';
import { generate, loadConfig, readOpenApiProject } from '../dist/index.js';

async function fixture(name) {
  const root = resolve(`test/tmp/swagger-files-${name}`);
  const swaggers = `${root}/swaggers`;
  await rm(root, { recursive: true, force: true });
  for (const directory of ['should-be-ignored', 'should-not-be-ignored/nested', '.hidden']) {
    await mkdir(`${swaggers}/${directory}`, { recursive: true });
  }
  const document = operationId => JSON.stringify({
    servers: [{ url: '/selected/v1' }],
    paths: { '/item': { get: { operationId, tags: ['Items'] } } }
  });
  await writeFile(`${swaggers}/should-be-ignored/broken.json`, 'This must never be parsed.');
  await writeFile(`${swaggers}/should-not-be-ignored/a.json`, document('getA'));
  await writeFile(`${swaggers}/should-not-be-ignored/nested/b.json`, document('getB'));
  await writeFile(`${swaggers}/.hidden/c.json`, document('getC'));
  await writeFile(`${swaggers}/should-not-be-ignored/notes.txt`, 'This is not JSON.');
  return { root, swaggers };
}

test('selects relative and absolute globs with recursive and single-directory matching', async () => {
  const { swaggers } = await fixture('patterns');
  const relativeRoot = relative(process.cwd(), swaggers).split('\\').join('/');
  for (const root of [swaggers, relativeRoot]) {
    const recursive = await readOpenApiProject(`${root}/should-not-be-ignored/**/*.json`);
    assert.deepEqual(recursive.endpoints.map(endpoint => endpoint.name), ['getA', 'getB']);
    assert.deepEqual(recursive.endpoints.map(endpoint => endpoint.sourceFile), [
      `${relativeRoot}/should-not-be-ignored/a.json`,
      `${relativeRoot}/should-not-be-ignored/nested/b.json`
    ]);
    const shallow = await readOpenApiProject(`${root}/should-not-be-ignored/*.json`);
    assert.deepEqual(shallow.endpoints.map(endpoint => endpoint.name), ['getA']);
  }
  const directory = await readOpenApiProject(`${swaggers}/should-not-be-ignored`);
  assert.deepEqual(directory.endpoints.map(endpoint => endpoint.sourceFile), ['a.json', 'nested/b.json']);
  const singleFile = await readOpenApiProject(`${swaggers}/should-not-be-ignored/a.json`);
  assert.deepEqual(singleFile.endpoints.map(endpoint => endpoint.name), ['getA']);
});

test('config-loaded exclusions skip invalid JSON and duplicate patterns are processed once', async () => {
  const { root, swaggers } = await fixture('exclusions');
  const relativeRoot = relative(process.cwd(), swaggers).split('\\').join('/');
  const configPath = `${root}/config.json`;
  const patterns = [
    `!${relativeRoot}/should-be-ignored/**`,
    `${relativeRoot}/**/*`,
    `${relativeRoot}/should-not-be-ignored/**/*.json`
  ];
  await writeFile(configPath, JSON.stringify({
    client: 'react',
    'swaggers-directory': patterns,
    serverUrlIndex: 0,
    'endpoint-name-strategy': 'namespaceTagAndOperationId',
    'endpoint-namespace': { pointer: '/servers/0/url', pattern: '^/([^/]+)' },
    output: {
      'api-models.ts': `${root}/generated/api-models.ts`,
      'api-endpoints.ts': `${root}/generated/api-endpoints.ts`,
      'client.ts': `${root}/generated/client.ts`
    }
  }));
  const config = await loadConfig(configPath);
  assert.equal(config['swaggers-directory'][0], `!${swaggers}/should-be-ignored/**`);
  await generate(config);
  const endpoints = await readFile(config.output['api-endpoints.ts'], 'utf8');
  assert.deepEqual([...endpoints.matchAll(/export const (\w+)/g)].map(match => match[1]), [
    'Selected_Items_getC', 'Selected_Items_getA', 'Selected_Items_getB'
  ]);
  assert.equal([...endpoints.matchAll(/path: "\/selected\/v1\/item"/g)].length, 3);
  const reversed = await readOpenApiProject([...patterns].reverse());
  assert.deepEqual(reversed.endpoints.map(endpoint => endpoint.name), ['getC', 'getA', 'getB']);
  const directoryArray = await readOpenApiProject([swaggers, `!${swaggers}/should-be-ignored/**`]);
  assert.deepEqual(directoryArray.endpoints.map(endpoint => endpoint.name), ['getC', 'getA', 'getB']);
});

test('validates input selections and reports globs without matching JSON', async () => {
  const { root, swaggers } = await fixture('validation');
  const configPath = `${root}/config.json`;
  for (const input of [undefined, null, '', ' ', 1, {}, [], [''], [null], ['!'], ['!**/*.json']]) {
    await writeFile(configPath, JSON.stringify({
      client: 'react',
      'swaggers-directory': input,
      output: { 'api-models.ts': 'models.ts', 'api-endpoints.ts': 'endpoints.ts', 'client.ts': 'client.ts' }
    }));
    await assert.rejects(loadConfig(configPath), /swaggers-directory/);
    await assert.rejects(readOpenApiProject(input), /swaggers-directory/);
  }
  for (const input of [`${swaggers}/missing/**/*.json`, `${swaggers}/**/*.yaml`, [`${swaggers}/**/*.json`, `!${swaggers}/**`]]) {
    await assert.rejects(readOpenApiProject(input), /No OpenAPI JSON files match/);
  }
  await assert.rejects(readOpenApiProject(`${swaggers}/missing-directory`), /ENOENT/);
});
