import '@angular/compiler';
import * as rxjs from 'rxjs';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { before, test } from 'node:test';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import { generate } from '../dist/index.js';

const run = promisify(execFile);
const root = resolve('test/tmp/client-runtime');
const clients = {};

// Compile and load the actual generated clients against installed framework types.
before(async () => {
  await rm(root, { recursive: true, force: true });
  await mkdir(root, { recursive: true });
  await writeFile(`${root}/package.json`, JSON.stringify({ type: 'module' }));
  await writeFile(`${root}/frameworks.d.ts`, `
declare module 'react' {
  export function useMemo<T>(factory: () => T, deps: readonly unknown[]): T;
}
`);
  for (const framework of ['angular', 'react']) {
    const directory = `${root}/${framework}`;
    await generate({
      input: resolve('test/fixtures/posts.json'),
      'api-models.ts': { output: `${directory}/api-models.ts` },
      'api-endpoints.ts': { output: `${directory}/api-endpoints.ts` },
      'swagger-client.ts': { output: `${directory}/client.ts`, framework }
    });
    await run(resolve('node_modules/.bin/tsc'), [
      '--ignoreConfig', `${directory}/client.ts`, `${root}/frameworks.d.ts`,
      '--outDir', `${directory}/compiled`, '--module', 'ESNext', '--moduleResolution', 'Bundler',
      '--target', 'ES2022', '--strict', '--skipLibCheck', '--experimentalDecorators'
    ]);
    clients[framework] = await import(pathToFileURL(`${directory}/compiled/client.js`).href);
  }

});

for (const framework of ['angular', 'react']) {
  test(`${framework} preserves absolute URLs and joins relative paths while encoding variables`, async () => {
    const cases = [
      ['https://api.example/v1/posts/{id}', 'https://api.example/v1/posts/a%20b'],
      ['HTTP://api.example/v1/posts/{id}', 'http://api.example/v1/posts/a%20b'],
      ['/v1/posts/{id}', 'https://gateway.example/base/v1/posts/a%20b'],
      ['v1/posts/{id}', 'https://gateway.example/base/v1/posts/a%20b'],
      ['', 'https://gateway.example/base/']
    ];
    for (const [path, expected] of cases) {
      const endpoint = { name: 'getPost', method: 'GET', path };
      const variables = { pathVariables: { id: 'a b' }, queryVariables: { page: 1 } };
      let request;
      if (framework === 'angular') {
        const client = new clients.angular.SwaggerClientService(
          { baseUrl: 'https://gateway.example/base///' },
          { request: value => { request = value; return rxjs.of({ status: 200, body: {}, headers: {}, url: value.url }); } }
        );
        client.request(endpoint, variables).subscribe();
        // Angular delegates query encoding to its HTTP adapter.
        assert.equal(new URL(request.url).href, expected);
        assert.equal(request.query.page, 1);
      } else {
        await clients.react.createSwaggerClient(endpoint, {
          baseUrl: 'https://gateway.example/base///',
          fetch: async (url, init) => {
            request = { url, ...init };
            return new Response('{}');
          }
        }).request(variables);
        assert.equal(request.url, `${expected}?page=1`);
      }
      assert.equal(request.method, 'GET');
    }
  });
}

test('React returns undefined for empty successful responses and HEAD requests', async () => {
  for (const [method, status, body] of [
    ['GET', 200, null], ['POST', 201, ''], ['DELETE', 202, ''],
    ['DELETE', 204, null], ['POST', 205, null], ['HEAD', 200, null]
  ]) {
    const client = clients.react.createSwaggerClient({ name: 'empty', method, path: '/posts' }, {
      baseUrl: 'https://api.example',
      fetch: async () => new Response(body, { status })
    });
    assert.equal(await client.request(), undefined, `${method} ${status}`);
  }

  const response = new Response(null);
  response.text = () => { throw new Error('HEAD responses must not be read'); };
  const client = clients.react.createSwaggerClient({ name: 'head', method: 'HEAD', path: '/posts' }, {
    baseUrl: 'https://api.example', fetch: async () => response
  });
  assert.equal(await client.request(), undefined);
});

test('React still parses JSON values and rejects malformed nonempty JSON', async () => {
  for (const body of ['{"id":1}', '[1,2]', 'null', 'false', '0', '""', 'invalid', ' ']) {
    const client = clients.react.createSwaggerClient({ name: 'getPost', method: 'GET', path: '/posts' }, {
      baseUrl: 'https://api.example', fetch: async () => new Response(body)
    });
    if (body === 'invalid' || body === ' ') {
      await assert.rejects(client.request(), { name: 'SyntaxError' });
    } else {
      assert.equal(JSON.stringify(await client.request()), JSON.stringify(JSON.parse(body)));
    }
  }
});

test('React preserves HTTP errors even when the error response is empty', async () => {
  for (const status of [400, 404, 500]) {
    const response = new Response(null, { status });
    const client = clients.react.createSwaggerClient({ name: 'getPost', method: 'GET', path: '/posts' }, {
      baseUrl: 'https://api.example', fetch: async () => response
    });
    await assert.rejects(client.request(), error => {
      assert.ok(error instanceof clients.react.SwaggerHttpError);
      assert.equal(error.response, response);
      return true;
    });
  }
});

const endpoint = { name: 'post', method: 'POST', path: '/posts/{id}' };
const variables = { pathVariables: { id: 'a b' }, queryVariables: { tag: ['x y', 'z'] }, bodyVariables: { id: 1 } };

for (const framework of ['angular', 'react']) {
  test(`${framework} prepares an isolated snapshot and executes the configured adapter once per execution`, async () => {
    let calls = 0;
    const requests = [];
    const adapter = { request(request) {
      calls++;
      requests.push(request);
      request.body.id++;
      const response = { status: 201, body: { id: 2 }, headers: { 'x-test': ['a', 'b'] }, url: 'https://resolved.test/posts' };
      return framework === 'angular' ? rxjs.of(response) : Promise.resolve(response);
    } };
    const client = framework === 'angular'
      ? new clients.angular.SwaggerClientService({ baseUrl: 'https://api.test' }, adapter)
      : new clients.react.SwaggerClientService({ baseUrl: 'https://api.test', httpClient: adapter });
    const body = structuredClone(variables);
    const prepared = client.prepare(endpoint, body, { headers: { 'X-Test': 'override' } });
    body.bodyVariables.id = 999;
    prepared.request.body.id = 888;
    prepared.request.query.tag.push('other');
    assert.equal(calls, 0);
    assert.equal(prepared.request.headers['x-test'], 'override');
    const responseExecution = prepared.sendResponse();
    if (framework === 'angular') assert.equal(calls, 0);
    const execute = value => framework === 'angular' ? rxjs.firstValueFrom(value) : value;
    const response = await execute(responseExecution);
    assert.equal(response.status, 201);
    assert.deepEqual(response.headers['x-test'], ['a', 'b']);
    assert.equal(response.url, 'https://resolved.test/posts');
    assert.deepEqual(await execute(prepared.send()), { id: 2 });
    if (framework === 'angular') await execute(responseExecution);
    assert.equal(calls, framework === 'angular' ? 3 : 2);
    assert.ok(requests.every(request => request.body.id === 2));
    assert.ok(requests.every(request => request.query.tag.length === 2));
  });

  test(`${framework} isolates responses completing out of order and preserves errors`, async () => {
    const pending = [];
    const failure = new Error('transport failed');
    const adapter = { request() {
      if (framework === 'angular') return new rxjs.Observable(subscriber => { pending.push({
        resolve: value => { subscriber.next(value); subscriber.complete(); }, reject: error => subscriber.error(error)
      }); });
      return new Promise((resolve, reject) => pending.push({ resolve, reject }));
    } };
    const client = framework === 'angular'
      ? new clients.angular.SwaggerClientService({ baseUrl: 'https://api.test' }, adapter)
      : new clients.react.SwaggerClientService({ baseUrl: 'https://api.test', httpClient: adapter });
    const execute = () => {
      const result = client.request(endpoint, variables, { observe: 'response' });
      return framework === 'angular' ? rxjs.firstValueFrom(result) : result;
    };
    const a = execute(), b = execute();
    pending[1].resolve({ status: 202, body: { id: 2 }, headers: null, url: null });
    pending[0].resolve({ status: 201, body: { id: 1 }, headers: {}, url: '/one' });
    assert.equal((await a).status, 201);
    assert.equal((await b).status, 202);
    const c = execute();
    pending[2].reject(failure);
    await assert.rejects(c, error => error === failure);
    const d = execute();
    pending[3].resolve({ status: 500, body: null, headers: null, url: null });
    await assert.rejects(d, error => error.response.status === 500);
  });
}

// Exercise actual Angular DI, HttpClient, interceptors, and its testing backend.
import { createEnvironmentInjector, ɵINJECTOR_SCOPE, PendingTasks } from '@angular/core';
import { provideHttpClient, withInterceptors, withNoXsrfProtection, HttpContext, HttpContextToken, HttpHeaders } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';

test('Angular provider defaults to HttpClient, forwarding context, headers, query, responses and cancellation', async () => {
  const token = new HttpContextToken(() => false);
  let intercepted = 0;
  const injector = createEnvironmentInjector([
    { provide: ɵINJECTOR_SCOPE, useValue: 'root' },
    { provide: PendingTasks, useValue: { add: () => () => {} } },
    provideHttpClient(withNoXsrfProtection(), withInterceptors([(request, next) => {
      intercepted++;
      assert.equal(request.context.get(token), true);
      return next(request);
    }])),
    provideHttpClientTesting(),
    clients.angular.provideSwaggerClient({ baseUrl: 'https://api.test' })
  ]);
  try {
    const client = injector.get(clients.angular.SwaggerClientService);
    const backend = injector.get(HttpTestingController);
    const context = new HttpContext().set(token, true);
    const options = { context, headers: { 'X-Key': 'runtime' } };
    const prepared = client.prepare(endpoint, { ...variables, headerVariables: { 'x-key': 'endpoint' } }, options);
    assert.equal(prepared.request.context, context);
    assert.equal(prepared.request.headers['x-key'], 'runtime');
    backend.expectNone(() => true);
    for (const status of [201, 202, 204]) {
      const result = rxjs.firstValueFrom(prepared.sendResponse());
      const request = backend.expectOne(request => request.url === 'https://api.test/posts/a%20b');
      assert.equal(request.request.headers.get('x-key'), 'runtime');
      assert.deepEqual(request.request.params.getAll('tag'), ['x y', 'z']);
      request.flush(status === 204 ? null : { id: status }, {
        status, statusText: 'Success', headers: new HttpHeaders({ 'X-Repeat': ['a', 'b'] })
      });
      const response = await result;
      assert.equal(response.status, status);
      assert.deepEqual(response.headers['x-repeat'], ['a', 'b']);
      assert.equal(response.url, 'https://api.test/posts/a%20b?tag=x%20y&tag=z');
      assert.deepEqual(response.body, status === 204 ? null : { id: status });
    }
    const body = rxjs.firstValueFrom(prepared.send());
    backend.expectOne(() => true).flush({ id: 42 }, { status: 201, statusText: 'Created' });
    assert.deepEqual(await body, { id: 42 });
    const nullBody = rxjs.firstValueFrom(prepared.send());
    backend.expectOne(() => true).flush(null, { status: 204, statusText: 'No Content' });
    assert.equal(await nullBody, null);
    const failure = rxjs.firstValueFrom(prepared.sendResponse());
    backend.expectOne(() => true).flush(null, { status: 403, statusText: 'Forbidden' });
    await assert.rejects(failure, error => error.status === 403);
    const head = rxjs.firstValueFrom(client.request({ name: 'head', method: 'HEAD', path: '/head' }, undefined, { ...options, observe: 'response' }));
    backend.expectOne(() => true).flush(null);
    assert.equal((await head).body, null);
    const subscription = prepared.sendResponse().subscribe();
    const cancelled = backend.expectOne(() => true);
    subscription.unsubscribe();
    assert.equal(cancelled.cancelled, true);
    assert.equal(intercepted, 8);
    backend.verify();
  } finally { injector.destroy(); }
});

test('Angular provider uses a custom adapter for both execution modes', async () => {
  let calls = 0;
  const context = new HttpContext();
  class CustomAdapter {
    request(request) { assert.equal(request.context, context); assert.equal(request.headers['x-runtime'], 'yes'); calls++; return rxjs.of({ status: 202, body: request.body, headers: null, url: null }); }
  }
  const injector = createEnvironmentInjector([
    clients.angular.provideSwaggerClient({ baseUrl: 'https://api.test', httpClient: CustomAdapter })
  ]);
  try {
    const prepared = injector.get(clients.angular.SwaggerClientService).prepare(endpoint, variables, { context, headers: { 'X-Runtime': 'yes' } });
    assert.equal(calls, 0);
    assert.equal((await rxjs.firstValueFrom(prepared.sendResponse())).status, 202);
    assert.deepEqual(await rxjs.firstValueFrom(prepared.send()), variables.bodyVariables);
    assert.equal(calls, 2);
  } finally { injector.destroy(); }
});

test('React fetch exposes actual statuses, empty responses, headers, resolved URL and AbortSignal', async () => {
  for (const status of [201, 202, 204]) {
    const controller = new AbortController();
    const client = clients.react.createSwaggerClient(endpoint, {
      baseUrl: 'https://api.test', headers: { 'X-Key': 'config' },
      fetch: async (url, init) => {
        assert.equal(init.signal, controller.signal);
        assert.equal(init.headers['x-key'], 'runtime');
        assert.equal(url, 'https://api.test/posts/a%20b?tag=x+y&tag=z');
        const response = new Response(status === 204 ? null : '{"id":1}', {
          status, headers: { 'X-Test': 'value' }
        });
        Object.defineProperty(response, 'url', { value: 'https://resolved.test/final' });
        return response;
      }
    });
    const response = await client.request(variables, { observe: 'response', signal: controller.signal, headers: { 'X-KEY': 'runtime' } });
    assert.equal(response.status, status);
    assert.equal(response.url, 'https://resolved.test/final');
    assert.deepEqual(response.headers['x-test'], ['value']);
    assert.deepEqual(response.body, status === 204 ? null : { id: 1 });
  }
  const controller = new AbortController();
  const client = clients.react.createSwaggerClient(endpoint, {
    baseUrl: 'https://api.test',
    fetch: (_url, init) => new Promise((resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(init.signal.reason));
    })
  });
  const result = client.prepare(variables, { signal: controller.signal }).send();
  controller.abort();
  await assert.rejects(result, error => error.name === 'AbortError');
});
