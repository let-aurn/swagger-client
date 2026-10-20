import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import { generate, loadConfig, readOpenApiProject } from '../dist/index.js';

const execFileAsync = promisify(execFile);
const stringEnum = { type: 'string', enum: ['PENDING', 'IN_PROGRESS', 'COMPLETED'] };
const document = {
  openapi: '3.0.1',
  components: { schemas: {
    Status: stringEnum,
    NullableStatus: { ...stringEnum, nullable: true },
    NullMember: { type: 'string', enum: ['YES', null] },
    Task: { type: 'object', properties: {
      state: stringEnum,
      status: { $ref: '#/components/schemas/Status' },
      statuses: { type: 'array', items: { $ref: '#/components/schemas/Status' } },
      nested: { type: 'object', properties: { state: stringEnum } },
      items: { type: 'array', items: stringEnum },
      lookup: { type: 'object', additionalProperties: stringEnum },
      choice: { oneOf: [stringEnum, { type: 'number' }] },
      anyChoice: { anyOf: [stringEnum, { type: 'number' }] },
      combined: { allOf: [{ type: 'object', properties: { state: stringEnum } }, { type: 'object', properties: { other: stringEnum } }] },
      nullable: { ...stringEnum, nullable: true }
    } },
    // Reserve this name before extracting the inline state enum.
    TaskState: { type: 'string' },
    OddValues: { enum: ['a-b', 'ab', '', '1st', 'default', 'quote"value', 'line\nbreak', 'ab', '__proto__', 'prototype'] },
    Numbers: { type: 'integer', enum: [-1, 0, 2] },
    Mixed: { enum: ['YES', 1] },
    Booleans: { enum: [true, false] }
  } },
  paths: { '/tasks/{mode}': { post: {
    operationId: 'updateTask',
    parameters: [
      { name: 'mode', in: 'path', schema: stringEnum },
      { name: 'status', in: 'query', schema: { $ref: '#/components/schemas/Status' } },
      { name: 'Status', in: 'query', schema: { $ref: '#/components/schemas/Status' } },
      { name: 'literal', in: 'query', schema: { enum: ['Status', true] } },
      { name: 'flags', in: 'query', schema: { type: 'array', items: stringEnum } },
      { name: 'x-mode', in: 'header', schema: stringEnum }
    ],
    requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { action: stringEnum } } } } },
    responses: { '200': { content: { 'application/json': { schema: { type: 'array', items: stringEnum } } } } }
  } } }
};

function configFor(root, style, client = 'react') {
  return {
    client,
    'enum-style': style,
    'swaggers-directory': `${root}/swaggers`,
    output: {
      'api-models.ts': `${root}/${client}/api-models.ts`,
      'api-endpoints.ts': `${root}/${client}/api-endpoints.ts`,
      'client.ts': `${root}/${client}/client.ts`
    }
  };
}

async function setup(name) {
  const root = resolve(`test/tmp/${name}`);
  await rm(root, { recursive: true, force: true });
  await mkdir(`${root}/swaggers`, { recursive: true });
  await writeFile(`${root}/swaggers/api.json`, JSON.stringify(document));
  return root;
}

test('enum style generates runtime enums and correctly typed model and endpoint references', async () => {
  const root = await setup('enums');
  for (const client of ['react', 'angular']) {
    await generate(configFor(root, 'enum', client));
    const models = await readFile(`${root}/${client}/api-models.ts`, 'utf8');
    const endpoints = await readFile(`${root}/${client}/api-endpoints.ts`, 'utf8');
    assert.match(models, /export enum Status \{/);
    assert.match(models, /PENDING = "PENDING"/);
    assert.match(models, /state\?: TaskState2;/);
    assert.match(models, /export type NullableStatus = NullableStatusValue \| null;/);
    assert.match(models, /export type NullMember = NullMemberValue \| null;/);
    assert.match(models, /nested\?: \{ state\?: TaskNestedState \}/);
    assert.match(models, /lookup\?: Record<string, TaskLookupValue>/);
    assert.match(models, /choice\?: TaskChoiceOneOf1 \| number/);
    assert.match(models, /anyChoice\?: TaskAnyChoiceAnyOf1 \| number/);
    assert.match(models, /combined\?: \{ state\?: TaskCombinedAllOf1State \} & \{ other\?: TaskCombinedAllOf2Other \}/);
    assert.match(models, /export type Booleans = true \| false;/);
    assert.match(endpoints, /mode: ApiModels.UpdateTaskPathMode/);
    assert.match(endpoints, /status\?: ApiModels.Status/);
    assert.match(endpoints, /Status\?: ApiModels.Status/);
    assert.match(endpoints, /literal\?: "Status" \| true/);
    assert.match(endpoints, /flags\?: Array<ApiModels.UpdateTaskQueryFlagsItem>/);
    assert.match(endpoints, /"x-mode"\?: ApiModels.UpdateTaskHeaderXMode/);
    assert.match(endpoints, /action\?: ApiModels.UpdateTaskBodyAction/);
    assert.match(endpoints, /Array<ApiModels.UpdateTaskResponseItem>/);
  }

  const output = `${root}/react`;
  await writeFile(`${output}/usage.ts`, `
import {
  Status, NullableStatusValue, NullMemberValue, OddValues, Numbers, Mixed,
  TaskState2 as State,
  TaskItemsItem as Item,
  TaskNullable as Nullable,
  UpdateTaskPathMode, UpdateTaskQueryFlagsItem, UpdateTaskHeaderXMode,
  UpdateTaskBodyAction, UpdateTaskResponseItem,
  type Task, type NullableStatus, type NullMember
} from './api-models.js';
import { ApiEndpoints, type PathVariablesOf, type QueryVariablesOf,
  type HeaderVariablesOf, type BodyVariablesOf, type ResponseOf } from './api-endpoints.js';

const model: Task = {
  state: State.PENDING,
  status: Status.IN_PROGRESS,
  statuses: [Status.COMPLETED],
  items: [Item.PENDING],
  nullable: null
};
model.nullable = Nullable.PENDING;
const nullable: NullableStatus = NullableStatusValue.PENDING;
const nullStatus: NullableStatus = null;
const nullMember: NullMember = NullMemberValue.YES;
const nullValue: NullMember = null;
// @ts-expect-error Raw strings require an enum member in enum style.
model.state = 'PENDING';
// @ts-expect-error A nullable item does not make the array itself nullable.
model.items = null;
const path: PathVariablesOf<typeof ApiEndpoints.updateTask> = { mode: UpdateTaskPathMode.PENDING };
const query: QueryVariablesOf<typeof ApiEndpoints.updateTask> = { status: Status.PENDING, Status: Status.PENDING, literal: 'Status', flags: [UpdateTaskQueryFlagsItem.PENDING] };
const headers: HeaderVariablesOf<typeof ApiEndpoints.updateTask> = { 'x-mode': UpdateTaskHeaderXMode.PENDING };
const body: BodyVariablesOf<typeof ApiEndpoints.updateTask> = { action: UpdateTaskBodyAction.PENDING };
const response: ResponseOf<typeof ApiEndpoints.updateTask> = [UpdateTaskResponseItem.PENDING];
`);

  await execFileAsync('npx', ['tsc', '--ignoreConfig', `${output}/api-models.ts`, `${output}/api-endpoints.ts`, `${output}/usage.ts`,
    '--outDir', `${output}/compiled`, '--module', 'ESNext', '--moduleResolution', 'Bundler', '--target', 'ES2022', '--strict', '--skipLibCheck']);
  const enums = await import(pathToFileURL(`${output}/compiled/api-models.js`).href);
  assert.equal(enums.Status.PENDING, 'PENDING');
  assert.equal(JSON.stringify({ state: enums.Status.PENDING }), '{"state":"PENDING"}');
  assert.deepEqual(Object.values(enums.OddValues), ['a-b', 'ab', '', '1st', 'default', 'quote"value', 'line\nbreak', '__proto__', 'prototype']);
  assert.equal(enums.Numbers.Value_Minus_1, -1);
  assert.equal(enums.Mixed.YES, 'YES');
  assert.equal(enums.Mixed.Value_1, 1);
});

test('union style is the default and preserves existing literal types', async () => {
  const root = await setup('enum-unions');
  await generate(configFor(root, undefined));
  const implicit = await readFile(`${root}/react/api-models.ts`, 'utf8');
  await generate(configFor(root, 'union'));
  const explicit = await readFile(`${root}/react/api-models.ts`, 'utf8');
  assert.equal(implicit, explicit);
  assert.doesNotMatch(explicit, /export enum/);
  assert.match(explicit, /state\?: "PENDING" \| "IN_PROGRESS" \| "COMPLETED"/);
});

test('enum declarations and references remain unique across multiple Swagger files', async () => {
  const root = await setup('enum-multiple-files');
  await writeFile(`${root}/swaggers/second.json`, JSON.stringify(document));
  const project = await readOpenApiProject(`${root}/swaggers`, undefined, undefined, undefined, 'enum');
  const names = project.schemas.map((schema) => schema.name);
  assert.equal(new Set(names).size, names.length);
  const secondStatus = project.schemas.find((schema) => schema.name === 'Status2');
  assert.deepEqual(secondStatus.enumValues, stringEnum.enum);
  assert.equal(project.endpoints[1].queryVariables.find((variable) => variable.name === 'status').type, 'Status2');
  assert.match(project.endpoints[1].responseType, /^Array<UpdateTask2ResponseItem>$/);
  const repeated = await readOpenApiProject(`${root}/swaggers`, undefined, undefined, undefined, 'enum');
  assert.deepEqual(repeated, project);
});

test('enum style validates JSON config and direct generation', async () => {
  const root = await setup('enum-config');
  const config = configFor(root, 'enum');
  const configPath = `${root}/config.json`;
  await writeFile(configPath, JSON.stringify(config));
  assert.equal((await loadConfig(configPath))['enum-style'], 'enum');
  for (const style of [null, '', 'enums', 1, {}, []]) {
    const invalid = { ...config, 'enum-style': style };
    await writeFile(configPath, JSON.stringify(invalid));
    await assert.rejects(loadConfig(configPath), /"enum-style" must be "union" or "enum"/);
    await assert.rejects(generate(invalid), /"enum-style" must be "union" or "enum"/);
    await assert.rejects(readOpenApiProject(config['swaggers-directory'], undefined, undefined, undefined, style), /"enum-style"/);
  }
});
