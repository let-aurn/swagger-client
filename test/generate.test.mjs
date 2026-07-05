import assert from 'node:assert/strict';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { generate } from '../dist/index.js';

test('generates Angular client files from OpenAPI JSON', async () => {
  const root = resolve('test/tmp/angular');
  await rm(root, { recursive: true, force: true });
  await mkdir(dirname(`${root}/generated/api-models.ts`), { recursive: true });

  await generate({
    client: 'angular',
    'swaggers-directory': resolve('test/fixtures'),
    output: {
      'api-models.ts': `${root}/generated/api-models.ts`,
      'api-endpoints.ts': `${root}/generated/api-endpoints.ts`,
      'client.ts': `${root}/generated/swagger-client.ts`
    }
  });

  const models = await readFile(`${root}/generated/api-models.ts`, 'utf8');
  const endpoints = await readFile(`${root}/generated/api-endpoints.ts`, 'utf8');
  const client = await readFile(`${root}/generated/swagger-client.ts`, 'utf8');

  assert.match(models, /export interface PostResponse/);
  assert.match(models, /title: string;/);
  assert.match(endpoints, /PostsController_getPost/);
  assert.match(endpoints, /"page-size"\?: number/);
  assert.doesNotMatch(endpoints, /wireName/);
  assert.match(endpoints, /ApiModels\.PostResponse\[\]/);
  assert.match(client, /provideSwaggerClient\(config: SwaggerClientConfig\)/);
  assert.match(client, /httpClient\?: Type<SwaggerHttpClient>/);
});

test('generates React client files from OpenAPI JSON', async () => {
  const root = resolve('test/tmp/react');
  await rm(root, { recursive: true, force: true });
  await mkdir(root, { recursive: true });

  await generate({
    client: 'react',
    'swaggers-directory': resolve('test/fixtures'),
    output: {
      'api-models.ts': `${root}/api-models.ts`,
      'api-endpoints.ts': `${root}/api-endpoints.ts`,
      'client.ts': `${root}/swagger-client.ts`
    }
  });

  const client = await readFile(`${root}/swagger-client.ts`, 'utf8');
  assert.match(client, /useSwaggerClient/);
  assert.match(client, /fetchImpl/);
});

test('generates relative imports for files in different output directories', async () => {
  const root = resolve('test/tmp/split-output');
  await rm(root, { recursive: true, force: true });
  await mkdir(root, { recursive: true });

  await generate({
    client: 'angular',
    'swaggers-directory': resolve('test/fixtures'),
    output: {
      'api-models.ts': `${root}/src/app/core/api/generated/models/api-models.ts`,
      'api-endpoints.ts': `${root}/src/app/core/api/generated/endpoints/api-endpoints.ts`,
      'client.ts': `${root}/src/app/core/api/swagger-client.ts`
    }
  });

  const endpoints = await readFile(`${root}/src/app/core/api/generated/endpoints/api-endpoints.ts`, 'utf8');
  const client = await readFile(`${root}/src/app/core/api/swagger-client.ts`, 'utf8');

  assert.match(endpoints, /from '\.\.\/models\/api-models';/);
  assert.match(client, /from '\.\/generated\/endpoints\/api-endpoints';/);
});

test('can prefix endpoint names with the first OpenAPI tag', async () => {
  const root = resolve('test/tmp/tag-prefixed');
  const swaggers = `${root}/swaggers`;
  await rm(root, { recursive: true, force: true });
  await mkdir(swaggers, { recursive: true });
  await writeFile(`${swaggers}/api.json`, JSON.stringify({
    openapi: '3.0.1',
    info: {
      title: 'Tagged API',
      version: '1.0.0'
    },
    paths: {
      '/token': {
        get: {
          tags: ['SomeController'],
          operationId: 'someEndpoint',
          parameters: [
            {
              name: 'code',
              in: 'query',
              required: true,
              schema: { type: 'string' }
            }
          ],
          responses: {
            '200': {
              description: 'OK'
            }
          }
        }
      }
    }
  }));

  await generate({
    client: 'angular',
    'swaggers-directory': swaggers,
    'endpoint-name-strategy': 'tagAndOperationId',
    output: {
      'api-models.ts': `${root}/generated/api-models.ts`,
      'api-endpoints.ts': `${root}/generated/api-endpoints.ts`,
      'client.ts': `${root}/generated/swagger-client.ts`
    }
  });

  const endpoints = await readFile(`${root}/generated/api-endpoints.ts`, 'utf8');

  assert.match(endpoints, /export const SomeController_someEndpoint/);
  assert.match(endpoints, /name: "SomeController_someEndpoint"/);
  assert.doesNotMatch(endpoints, /export const someEndpoint/);
});
