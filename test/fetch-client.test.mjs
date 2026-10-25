import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { generate } from '../dist/index.js';

function config(directory, language = 'javascript', framework = 'fetch') {
  const extension = language === 'javascript' ? 'js' : 'ts';
  return {
    input: resolve('test/fixtures/posts.json'), language,
    'api-models.ts': { output: `${directory}/models.${extension}`, enumStyle: 'enum' },
    'api-endpoints.ts': { output: `${directory}/endpoints.${extension}` },
    'swagger-client.ts': { output: `${directory}/client.${extension}`, framework }
  };
}

test('JavaScript Fetch client runs as ES modules without framework dependencies', async () => {
  const root = resolve('test/tmp/javascript-fetch');
  await mkdir(root, { recursive: true });
  await writeFile(`${root}/package.json`, '{"type":"module"}');
  await generate(config(root));
  const { ApiEndpoints } = await import(pathToFileURL(`${root}/endpoints.js`));
  const { createSwaggerClient, SwaggerHttpError } = await import(pathToFileURL(`${root}/client.js`));
  const generated = Object.values(ApiEndpoints)[0];
  assert.ok(generated.method);
  let captured;
  const endpoint = { ...generated, name: 'test', method: 'POST', path: '/posts/{id}' };
  const client = createSwaggerClient(endpoint, {
    baseUrl: 'https://example.com/api', headers: { authorization: 'token' },
    fetch: async (url, init) => { captured = { url, ...init }; return new Response('{"ok":true}'); }
  });
  assert.deepEqual(await client.request({ pathVariables: { id: 'a/b' }, queryVariables: { tag: ['a', 'b'] }, headerVariables: { 'x-test': 1 }, bodyVariables: { title: 'test' } }), { ok: true });
  assert.equal(captured.url, 'https://example.com/api/posts/a%2Fb?tag=a&tag=b');
  assert.equal(captured.headers['x-test'], '1');
  assert.equal(captured.headers.authorization, 'token');
  assert.equal(captured.body, '{"title":"test"}');
  await assert.rejects(client.request(), /Missing path variable/);
  for (const [body, status] of [[null, 204], ['', 200], ['bad json', 200], [null, 404]]) {
    const response = new Response(body, { status });
    const request = createSwaggerClient({ ...endpoint, path: '/posts' }, { baseUrl: 'https://example.com', fetch: async () => response }).request();
    if (status === 404) await assert.rejects(request, error => error instanceof SwaggerHttpError && error.response === response);
    else if (body === 'bad json') await assert.rejects(request, SyntaxError);
    else assert.equal(await request, undefined);
  }
  assert.doesNotMatch(await readFile(`${root}/client.js`, 'utf8'), /from ['"]react['"]|useMemo/);
});

test('JavaScript requires Fetch and .js outputs', async () => {
  await assert.rejects(generate(config('test/tmp/invalid', 'javascript', 'react')), /requires the Fetch/);
  const invalid = config('test/tmp/invalid');
  invalid['api-endpoints.ts'].output = 'endpoints.ts';
  await assert.rejects(generate(invalid), /must end in .js/);
});
