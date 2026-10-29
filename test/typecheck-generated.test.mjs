import assert from 'node:assert/strict';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { generate } from '../dist/index.js';

const execFileAsync = promisify(execFile);

test('generated endpoint types infer variables and responses', async () => {
  const root = resolve('test/tmp/typecheck');
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

  await writeFile(`${root}/usage.ts`, `
import { ApiEndpoints, type ResponseOf, type QueryVariablesOf, type PathVariablesOf } from './api-endpoints';
import { createSwaggerClient, type SwaggerRequestVariables } from './swagger-client';

type Post = ResponseOf<typeof ApiEndpoints.PostsController_getPost>;
const post: Post = { id: 1, title: 'Hello', content: 'World' };

const pathVariables: PathVariablesOf<typeof ApiEndpoints.PostsController_getPost> = { id: 1 };
const queryVariables: QueryVariablesOf<typeof ApiEndpoints.PostsController_getPosts> = { page: 0, 'page-size': 20 };
const queryOnlyRequest: SwaggerRequestVariables<typeof ApiEndpoints.PostsController_getPosts> = { queryVariables };

post.id.toFixed();
pathVariables.id.toFixed();
queryVariables['page-size']?.toFixed();

const postsClient = createSwaggerClient(ApiEndpoints.PostsController_getPosts, {
  baseUrl: 'https://example.test',
  fetch: globalThis.fetch
});

postsClient.request({ queryVariables: { page: 0 } });
`);

  await writeFile(`${root}/react.d.ts`, `
declare module 'react' {
  export function useMemo<T>(factory: () => T, deps: readonly unknown[]): T;
}
`);

  const result = await execFileAsync(resolve('node_modules/.bin/tsc'), [
    '--ignoreConfig',
    `${root}/api-models.ts`,
    `${root}/api-endpoints.ts`,
    `${root}/swagger-client.ts`,
    `${root}/react.d.ts`,
    `${root}/usage.ts`,
    '--noEmit',
    '--module',
    'ESNext',
    '--moduleResolution',
    'Bundler',
    '--target',
    'ES2022',
    '--strict',
    '--skipLibCheck'
  ]);

  assert.equal(result.stderr, '');
});

for (const framework of ['angular', 'react']) {
  test(`${framework} generated full responses and prepared requests preserve endpoint inference`, async () => {
    const root = resolve(`test/tmp/typecheck-response-${framework}`);
    await rm(root, { recursive: true, force: true });
    await mkdir(root, { recursive: true });
    await generate({
      input: resolve('test/fixtures/posts.json'),
      'api-models.ts': { output: `${root}/api-models.ts` },
      'api-endpoints.ts': { output: `${root}/api-endpoints.ts` },
      'swagger-client.ts': { output: `${root}/swagger-client.ts`, framework }
    });
    const container = framework === 'angular' ? 'Observable' : 'Promise';
    await writeFile(`${root}/usage.ts`, `
${framework === 'angular' ? "import type { Observable } from 'rxjs';" : ''}
import { ApiEndpoints, type ResponseOf } from './api-endpoints';
import { SwaggerClientService, type SwaggerHttpResponse${framework === 'react' ? ', createSwaggerClient' : ''} } from './swagger-client';
declare const client: SwaggerClientService;
const endpoint = ApiEndpoints.PostsController_getPost;
type Body = ResponseOf<typeof endpoint>;
const variables = { pathVariables: { id: 1 } };
const body: ${container}<Body> = client.request(endpoint, variables);
const response: ${container}<SwaggerHttpResponse<Body>> = client.request(endpoint, variables, { observe: 'response' });
const prepared = client.prepare(endpoint, variables, { headers: { 'X-Test': 'value' } });
const preparedBody: ${container}<Body> = prepared.send();
const preparedResponse: ${container}<SwaggerHttpResponse<Body>> = prepared.sendResponse();
// @ts-expect-error path variable type must remain endpoint-specific
client.request(endpoint, { pathVariables: { id: 'wrong' } }, { observe: 'response' });
// @ts-expect-error required path property cannot be omitted from variables
client.prepare(endpoint, {});
// @ts-expect-error preparation preserves query-variable validation
client.prepare(endpoint, { ...variables, queryVariables: { unknown: true } });
declare const full: SwaggerHttpResponse<Body>;
// @ts-expect-error full response bodies are explicitly nullable
const nonnullable: Body = full.body;
const nullable: Body | null = full.body;
${framework === 'react' ? `
const bound = createSwaggerClient(endpoint, { baseUrl: 'https://example.test' });
const boundFull: Promise<SwaggerHttpResponse<Body>> = bound.request(variables, { observe: 'response' });
const boundPrepared: Promise<Body> = bound.prepare(variables).send();
// @ts-expect-error bound client retains variable validation
bound.request({ pathVariables: { id: 'wrong' } }, { observe: 'response' });
` : ''}
`);
    try {
      await execFileAsync(resolve('node_modules/.bin/tsc'), [
        '--ignoreConfig', `${root}/usage.ts`, '--noEmit', '--module', 'ESNext',
        '--moduleResolution', 'Bundler', '--target', 'ES2022', '--strict', '--skipLibCheck', '--experimentalDecorators'
      ]);
    } catch (error) { throw new Error(error.stdout || error.message); }
  });
}
