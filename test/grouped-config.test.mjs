import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import { generate, loadConfig, readOpenApiProject } from '../dist/index.js';

const run = promisify(execFile);
const namespace = { pointer: '/servers/0/url', pattern: '^/([^/]+)' };
const ref = name => ({ $ref: `#/components/schemas/${name}` });
const status = { type: 'string', enum: ['OPEN', 'CLOSED'] };
const document = scope => ({
  servers: [{ url: `/${scope}/v1` }],
  components: { schemas: {
    Task: { type: 'object', properties: { next: ref('Task'), state: ref('State'), inline: status, nullable: ref('NullableState') } },
    State: status,
    NullableState: { ...status, nullable: true }
  } },
  paths: { '/tasks': { post: {
    operationId: 'createTask', tags: ['Tasks'],
    parameters: [{ name: 'mode', in: 'query', schema: status }, { name: 'task', in: 'query', schema: ref('Task') }],
    requestBody: { content: { 'application/json': { schema: ref('Task') } } },
    responses: { '200': { content: { 'application/json': { schema: ref('Task') } } } }
  } } }
});

async function setup(name, docs = [document('billing')]) {
  const root = resolve(`test/tmp/grouped-${name}`);
  await rm(root, { recursive: true, force: true });
  await mkdir(`${root}/swaggers`, { recursive: true });
  for (const [index, doc] of docs.entries()) {
    await writeFile(`${root}/swaggers/${index}.json`, JSON.stringify(doc));
  }
  return root;
}

function configFor(root) {
  return {
    input: `${root}/swaggers`, namespace,
    'api-models.ts': { output: `${root}/models/api-models.ts`, mergeDeclarations: true, prefix: '${namespace}_', enumStyle: 'enum' },
    'api-endpoints.ts': { output: `${root}/endpoints/api-endpoints.ts`, naming: 'namespace_tag_operationId', serverIndex: 0 },
    'swagger-client.ts': { output: `${root}/client/swagger-client.ts`, framework: 'angular' }
  };
}

async function compile(config) {
  await run('npx', ['tsc', '--ignoreConfig', config['api-models.ts'].output, config['api-endpoints.ts'].output,
    '--noEmit', '--strict', '--skipLibCheck', '--target', 'ES2022', '--module', 'ESNext', '--moduleResolution', 'Bundler']);
}

test('grouped config loads and CLI generates scoped models, enums and relative imports', async () => {
  const root = await setup('cli', [document('billing'), document('billing'), document('shipping')]);
  const config = configFor(root);
  const path = `${root}/config.json`;
  await writeFile(path, JSON.stringify(config));
  assert.deepEqual(await loadConfig(path), config);
  const result = await run(process.execPath, ['dist/cli/index.js', 'generate', '--config', path]);
  assert.match(result.stdout, /✅ Swagger client:\n   - Angular client generated in file:\/\//);
  const models = await readFile(config['api-models.ts'].output, 'utf8');
  assert.equal((models.match(/export interface Billing_Task \{/g) ?? []).length, 1);
  assert.match(models, /next\?: Billing_Task;/);
  assert.match(models, /state\?: Shipping_State;/);
  assert.match(models, /inline\?: Shipping_TaskInline;/);
  assert.match(models, /export type Billing_NullableState = Billing_NullableStateValue \| null;/);
  const endpoints = await readFile(config['api-endpoints.ts'].output, 'utf8');
  assert.match(endpoints, /from '..\/models\/api-models'/);
  assert.match(endpoints, /export const Billing_Tasks_createTask/);
  assert.match(endpoints, /path: "\/billing\/v1\/tasks"/);
  assert.match(endpoints, /ApiModels.Billing_Task/);
  assert.match(endpoints, /ApiModels.Shipping_Task/);
  const client = await readFile(config['swagger-client.ts'].output, 'utf8');
  assert.match(client, /from '..\/endpoints\/api-endpoints'/);
  assert.match(client, /EnvironmentProviders/);
  await compile(config);
});

test('prefixes are applied literally once to every declaration with merging enabled or disabled', async () => {
  const root = await setup('prefixes', [document('billing'), document('billing')]);
  for (const prefix of ['', 'LoremIpsum', 'LoremIpsum_', '${namespace}_', 'api_', '$']) {
    const config = configFor(root);
    config['swagger-client.ts'].framework = 'react';
    config['api-models.ts'].prefix = prefix;
    const resolvedPrefix = prefix.replace('${namespace}', 'Billing');
    for (const merge of [true, false]) {
      config['api-models.ts'].mergeDeclarations = merge;
      await generate(config);
      const models = await readFile(config['api-models.ts'].output, 'utf8');
      assert.ok(models.includes(`export interface ${resolvedPrefix}Task {`));
      assert.ok(models.includes(`export enum ${resolvedPrefix}State {`));
      assert.ok(models.includes(`inline?: ${resolvedPrefix}TaskInline;`));
      assert.ok(models.includes(`export enum ${resolvedPrefix}BillingTasksCreateTaskQueryMode {`));
      assert.equal(models.includes(`export interface ${resolvedPrefix}Task2 {`), !merge);
      await compile(config);
    }
  }
});

test('single files and global merging work without a namespace in the grouped format', async () => {
  const doc = document('billing');
  delete doc.servers;
  const root = await setup('no-namespace', [doc, doc]);
  const config = {
    input: `${root}/swaggers/0.json`,
    'api-models.ts': { output: `${root}/models.ts` },
    'api-endpoints.ts': { output: `${root}/endpoints.ts` },
    'swagger-client.ts': { output: `${root}/client.ts`, framework: 'react' }
  };
  await generate(config);
  let models = await readFile(config['api-models.ts'].output, 'utf8');
  assert.match(models, /export interface Task/);
  assert.doesNotMatch(models, /Billing_|export enum/);
  config.input = `${root}/swaggers`;
  config['api-models.ts'].mergeDeclarations = true;
  await generate(config);
  models = await readFile(config['api-models.ts'].output, 'utf8');
  assert.doesNotMatch(models, /Task2/);
  await compile(config);
});

test('all endpoint naming formats use the configured namespace and first tag', async () => {
  const doc = document('pet-api');
  doc.paths['/untagged'] = { get: { operationId: 'getTask' } };
  doc.paths['/prefixed'] = { get: { operationId: 'PetApi_existing' } };
  const root = await setup('naming', [doc]);
  const cases = {
    operationId: ['createTask', 'getTask', 'PetApi_existing'],
    tag_operationId: ['Tasks_createTask', 'getTask', 'PetApi_existing'],
    namespace_operationId: ['PetApi_createTask', 'PetApi_getTask', 'PetApi_existing'],
    namespace_tag_operationId: ['PetApi_Tasks_createTask', 'PetApi_getTask', 'PetApi_existing']
  };
  for (const [naming, expected] of Object.entries(cases)) {
    const project = await readOpenApiProject(`${root}/swaggers`, { namespace, naming });
    assert.deepEqual(project.endpoints.map(endpoint => endpoint.name), expected);
  }
});

test('grouped configuration rejects mixed settings and invalid prefixes before generating files', async () => {
  const root = await setup('validation');
  const base = configFor(root);
  const invalid = [
    [{ ...base, client: 'angular' }, /cannot mix/],
    [{ ...base, namespace: undefined }, /requires a namespace resolver/],
    [{ ...base, 'api-models.ts': { ...base['api-models.ts'], namespacePrefix: 'always' } }, /unknown setting/],
    ...[null, true, 1, {}, []].map(prefix => [{ ...base, 'api-models.ts': { ...base['api-models.ts'], prefix } }, /prefix.*string/]),
    ...['bad-prefix_', '1Invalid', '${other}_'].map(prefix => [{ ...base, 'api-models.ts': { ...base['api-models.ts'], prefix } }, /prefix/]),
    [{ ...base, 'api-models.ts': { ...base['api-models.ts'], mergeDeclarations: 'true' } }, /boolean/],
    [{ ...base, 'api-models.ts': { ...base['api-models.ts'], enumStyle: 'invalid' } }, /enumStyle/],
    [{ ...base, 'api-endpoints.ts': { ...base['api-endpoints.ts'], naming: 'invalid' } }, /naming/],
    [{ ...base, 'api-endpoints.ts': { ...base['api-endpoints.ts'], serverIndex: -1 } }, /serverIndex/],
    [{ ...base, 'swagger-client.ts': { ...base['swagger-client.ts'], framework: 'vue' } }, /framework/],
    [{ ...base, 'swagger-client.ts': {} }, /output/]
  ];
  const path = `${root}/config.json`;
  for (const [config, error] of invalid) {
    await writeFile(path, JSON.stringify(config));
    await assert.rejects(loadConfig(path), error);
    await assert.rejects(generate(config), error);
  }
  await assert.rejects(readOpenApiProject(base.input, { prefix: '${namespace}_' }), /namespace resolver/);
  await assert.rejects(readOpenApiProject(base.input, { naming: 'namespace_operationId' }), /namespace/);
});
