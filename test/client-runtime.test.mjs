import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { before, test } from 'node:test';
import { promisify } from 'node:util';
import { runInNewContext } from 'node:vm';
import { generate } from '../dist/index.js';

const run = promisify(execFile);
const root = resolve('test/tmp/client-runtime');
const clients = {};

// Compile the actual generated clients. Framework stubs isolate request behavior
// without requiring Angular or React to be installed in the generator project.
before(async () => {
  await rm(root, { recursive: true, force: true });
  await mkdir(root, { recursive: true });
  await writeFile(`${root}/package.json`, JSON.stringify({ type: 'commonjs' }));
  await writeFile(`${root}/frameworks.d.ts`, `
declare module 'react' {
  export function useMemo<T>(factory: () => T, deps: readonly unknown[]): T;
}
declare module 'rxjs' { export class Observable<T> {} }
declare module '@angular/core' {
  export interface EnvironmentProviders {}
  export interface Type<T> extends Function { new (...args: any[]): T; }
  export class InjectionToken<T> { constructor(name: string); }
  export function Inject(token: unknown): ParameterDecorator;
  export function Injectable(): ClassDecorator;
  export function makeEnvironmentProviders(providers: unknown[]): EnvironmentProviders;
}
declare module '@angular/common/http' {
  import { Observable } from 'rxjs';
  export class HttpClient {
    request<T>(method: string, url: string, options: unknown): Observable<T>;
  }
  export class HttpHeaders { constructor(headers: Record<string, string>); }
  export class HttpParams { append(key: string, value: string): HttpParams; set(key: string, value: string): HttpParams; }
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
      '--outDir', `${directory}/compiled`, '--module', 'Node16', '--moduleResolution', 'Node16',
      '--target', 'ES2022', '--strict', '--skipLibCheck', '--experimentalDecorators'
    ]);
    const exports = {};
    const modules = {
      react: { useMemo: factory => factory() },
      '@angular/common/http': {},
      '@angular/core': {
        InjectionToken: class {},
        Inject: () => () => {},
        Injectable: () => target => target,
        makeEnvironmentProviders: providers => providers
      }
    };
    runInNewContext(await readFile(`${directory}/compiled/client.js`, 'utf8'), {
      exports, URL,
      require(name) {
        assert.ok(Object.hasOwn(modules, name), `Unexpected runtime dependency: ${name}`);
        return modules[name];
      }
    });
    clients[framework] = exports;
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
          { request: value => { request = value; } }
        );
        client.request(endpoint, variables);
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
