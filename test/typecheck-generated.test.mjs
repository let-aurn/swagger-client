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

  const result = await execFileAsync('npx', [
    'tsc',
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
