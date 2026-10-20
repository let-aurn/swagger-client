import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import { generate, loadConfig, readOpenApiProject } from '../dist/index.js';

const namespace = { pointer: '/servers/0/url', pattern: '^/([^/]+)' };
const ref = name => ({ $ref: `#/components/schemas/${name}` });
const errorSchema = {
  type: 'object', required: ['code', 'message'],
  properties: { code: { type: 'string', enum: ['BAD', 'MISSING'] }, message: { type: 'string' } }
};
const document = (schemas, scope = 'billing') => ({
  openapi: '3.0.1', servers: [{ url: `/${scope}/v1` }], components: { schemas },
  paths: { '/error': { post: {
    operationId: 'getError',
    parameters: [{ name: 'filter', in: 'query', schema: ref('ApiErrorResponse') }],
    requestBody: { content: { 'application/json': { schema: ref('ApiErrorResponse') } } },
    responses: { '200': { content: { 'application/json': { schema: ref('ApiErrorResponse') } } } }
  } } }
});

async function setup(name, documents) {
  const root = resolve(`test/tmp/merge-${name}`);
  await rm(root, { recursive: true, force: true });
  await mkdir(`${root}/swaggers`, { recursive: true });
  for (const [index, doc] of documents.entries()) {
    await writeFile(`${root}/swaggers/${String(index).padStart(2, '0')}.json`, JSON.stringify(doc));
  }
  return root;
}

const read = (root, enabled = true, style = 'union') =>
  readOpenApiProject(`${root}/swaggers`, 'operationId', namespace, undefined, style, enabled);

test('26 repeated schemas share models, inline enums and endpoint references only when enabled', async () => {
  const docs = Array.from({ length: 26 }, (_, index) => document({
    ApiErrorResponse: index % 2 ? {
      description: 'Different documentation', type: 'object', required: ['message', 'code'],
      properties: {
        message: { type: 'string', example: 'Oops' },
        code: { enum: ['MISSING', 'BAD'], type: 'string', description: 'Error code' }
      }
    } : errorSchema
  }));
  const root = await setup('26-files', docs);
  for (const style of ['enum', 'union']) {
    const project = await read(root, true, style);
    assert.deepEqual(project.schemas.map(schema => schema.name), style === 'enum'
      ? ['ApiErrorResponseCode', 'ApiErrorResponse'] : ['ApiErrorResponse']);
    assert.equal(project.endpoints.length, 26);
    for (const endpoint of project.endpoints) {
      assert.equal(endpoint.responseType, 'ApiErrorResponse');
      assert.equal(endpoint.bodyType, 'ApiErrorResponse');
      assert.equal(endpoint.queryVariables[0].type, 'ApiErrorResponse');
    }
    assert.deepEqual(await read(root, true, style), project);
  }
  const disabled = await read(root, false);
  const implicit = await readOpenApiProject(`${root}/swaggers`, 'operationId', namespace);
  assert.deepEqual(disabled, implicit);
  assert.equal(disabled.schemas.length, 26);
  assert.equal(disabled.endpoints[25].responseType, 'ApiErrorResponse26');
});

test('merging respects namespaces, original names and structural variants', async () => {
  const changed = structuredClone(errorSchema);
  changed.properties.code.enum = ['OTHER'];
  const root = await setup('boundaries', [
    document({ ApiErrorResponse: errorSchema, OtherError: errorSchema }),
    document({ ApiErrorResponse: changed }),
    document({ ApiErrorResponse: errorSchema }, 'shipping'),
    document({ ApiErrorResponse: changed }),
    document({ ApiErrorResponse: errorSchema })
  ]);
  const project = await read(root);
  assert.deepEqual(project.schemas.map(schema => schema.name), ['Billing_ApiErrorResponse', 'OtherError', 'Billing_ApiErrorResponse2', 'Shipping_ApiErrorResponse']);
  assert.deepEqual(project.endpoints.map(endpoint => endpoint.responseType),
    ['Billing_ApiErrorResponse', 'Billing_ApiErrorResponse2', 'Shipping_ApiErrorResponse', 'Billing_ApiErrorResponse2', 'Billing_ApiErrorResponse']);
  const namespaced = await readOpenApiProject(`${root}/swaggers`, 'namespaceTagAndOperationId', namespace, undefined, 'union', true);
  assert.equal(namespaced.endpoints[0].name, 'Billing_getError');
  assert.equal(namespaced.endpoints[2].name, 'Shipping_getError');
});

test('follows nested and circular references and preserves dependent differences', async () => {
  const schemas = {
    ApiErrorResponse: { type: 'object', properties: { detail: ref('Detail') } },
    Detail: { type: 'object', properties: { parent: ref('ApiErrorResponse'), state: ref('State') } },
    State: { type: 'string', enum: ['BAD'] }
  };
  const variant = structuredClone(schemas);
  variant.State.enum = ['OTHER'];
  const root = await setup('cycles', [document(schemas), document(schemas), document(variant), document(variant)]);
  const project = await read(root, true, 'enum');
  assert.deepEqual(project.schemas.map(schema => schema.name),
    ['ApiErrorResponse', 'Detail', 'State', 'ApiErrorResponse2', 'Detail2', 'State2']);
  assert.equal(project.schemas.find(schema => schema.name === 'Detail2').schema.properties.parent.$ref,
    '#/components/schemas/ApiErrorResponse2');
  assert.deepEqual(project.endpoints.map(endpoint => endpoint.responseType),
    ['ApiErrorResponse', 'ApiErrorResponse', 'ApiErrorResponse2', 'ApiErrorResponse2']);
});

test('scope prefixes preserve model, enum and endpoint references without colliding with existing names', async () => {
  const schemas = {
    ApiErrorResponse: { ...errorSchema, properties: { ...errorSchema.properties, next: ref('ApiErrorResponse'), state: ref('State') } },
    State: { type: 'string', enum: ['BAD', 'MISSING'] },
    BillingApiErrorResponse: { type: 'string' }
  };
  const root = await setup('scope-prefixes', [
    document(schemas, 'billing'), document(schemas, 'billing'),
    document(schemas, 'shipping'), document(schemas, 'shipping')
  ]);
  const project = await read(root, true, 'enum');
  for (const scope of ['Billing', 'Shipping']) {
    const model = project.schemas.find(schema => schema.name === `${scope}_ApiErrorResponse`);
    assert.equal(model.schema.properties.next.$ref, `#/components/schemas/${scope}_ApiErrorResponse`);
    assert.equal(model.schema.properties.state.$ref, `#/components/schemas/${scope}_State`);
    assert.equal(project.schemas.filter(schema => schema.name === `${scope}_ApiErrorResponse`).length, 1);
  }
  assert.deepEqual(project.endpoints.map(endpoint => endpoint.responseType),
    ['Billing_ApiErrorResponse', 'Billing_ApiErrorResponse', 'Shipping_ApiErrorResponse', 'Shipping_ApiErrorResponse']);
  const output = { 'api-models.ts': `${root}/models.ts`, 'api-endpoints.ts': `${root}/endpoints.ts`, 'client.ts': `${root}/client.ts` };
  await generate({ client: 'react', 'swaggers-directory': `${root}/swaggers`, 'endpoint-namespace': namespace,
    'enum-style': 'enum', mergeDeclarations: true, output });
  const models = await readFile(output['api-models.ts'], 'utf8');
  assert.match(models, /next\?: Billing_ApiErrorResponse;/);
  assert.match(models, /state\?: Shipping_State;/);
  await promisify(execFile)('npx', ['tsc', '--ignoreConfig', output['api-models.ts'], output['api-endpoints.ts'],
    '--noEmit', '--module', 'ESNext', '--moduleResolution', 'Bundler', '--target', 'ES2022', '--strict', '--skipLibCheck']);
});

test('preserves required, nullable, format, arrays, dictionaries and composition differences', async () => {
  const variants = [
    errorSchema,
    { ...errorSchema, required: ['code'] },
    { ...errorSchema, nullable: true },
    { type: 'string', format: 'date' },
    { type: 'string', format: 'date-time' },
    { type: 'array', items: { type: 'string' } },
    { type: 'array', items: { type: 'number' } },
    { type: 'object', additionalProperties: { type: 'string' } },
    { type: 'object', additionalProperties: { type: 'number' } },
    { oneOf: [{ type: 'string' }, { type: 'number' }] },
    { oneOf: [{ type: 'string' }, { type: 'boolean' }] }
  ];
  const root = await setup('structures', [...variants, ...variants].map(schema => document({ ApiErrorResponse: schema })));
  const project = await read(root);
  assert.equal(project.schemas.length, variants.length);
  assert.deepEqual(project.endpoints.slice(variants.length).map(endpoint => endpoint.responseType),
    project.endpoints.slice(0, variants.length).map(endpoint => endpoint.responseType));
});

test('validates merge configuration and compiles generated shared declarations', async () => {
  const root = await setup('generation', [document({ ApiErrorResponse: errorSchema }), document({ ApiErrorResponse: errorSchema })]);
  const config = {
    client: 'react', 'swaggers-directory': `${root}/swaggers`,
    'endpoint-namespace': namespace, 'enum-style': 'enum', mergeDeclarations: true,
    output: { 'api-models.ts': `${root}/api-models.ts`, 'api-endpoints.ts': `${root}/api-endpoints.ts`, 'client.ts': `${root}/client.ts` }
  };
  const configPath = `${root}/config.json`;
  await writeFile(configPath, JSON.stringify(config));
  await generate(await loadConfig(configPath));
  const endpoints = await readFile(config.output['api-endpoints.ts'], 'utf8');
  assert.match(endpoints, /ApiModels.ApiErrorResponse/);
  assert.doesNotMatch(endpoints, /ApiErrorResponse2/);
  await promisify(execFile)('npx', ['tsc', '--ignoreConfig', config.output['api-models.ts'], config.output['api-endpoints.ts'],
    '--noEmit', '--module', 'ESNext', '--moduleResolution', 'Bundler', '--target', 'ES2022', '--strict', '--skipLibCheck']);
  for (const value of [null, 'true', 0, {}, []]) {
    const invalid = { ...config, mergeDeclarations: value };
    await writeFile(configPath, JSON.stringify(invalid));
    await assert.rejects(loadConfig(configPath), /mergeDeclarations.*boolean/);
    await assert.rejects(generate(invalid), /mergeDeclarations.*boolean/);
  }
  const missingNamespace = { ...config, 'endpoint-namespace': undefined };
  await writeFile(configPath, JSON.stringify(missingNamespace));
  await assert.rejects(loadConfig(configPath), /endpoint-namespace.pointer/);
  await assert.rejects(generate(missingNamespace), /endpoint-namespace.pointer/);
  await assert.rejects(readOpenApiProject(`${root}/swaggers`, undefined, { pointer: '/missing' }, undefined, undefined, true), /00.json: namespace/);
});
