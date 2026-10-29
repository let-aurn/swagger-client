# Swagger Client

Generate typed Angular and React clients from OpenAPI JSON files.

Requires Node.js 20 or newer. Create a `swagger-client.json` configuration in your
working directory, then run:

```sh
npx @let-aurn/swagger-client generate
npx @let-aurn/swagger-client generate --config=path/to/swagger-client.json
```

Alternatively, install the generator as a development dependency and use its
local executable:

```sh
npm install --save-dev @let-aurn/swagger-client
npx swagger-client generate
```

Generation writes three TypeScript files: models, endpoint definitions, and the
selected framework client. Install the runtime dependencies in the consuming
application: `@angular/common`, `@angular/core`, and `rxjs` for Angular, or `react`
for React.

## Config

```json
{
  "input": "path/to/swaggers",
  "api-models.ts": {
    "output": "src/app/api/generated/api-models.ts"
  },
  "api-endpoints.ts": {
    "output": "src/app/api/generated/api-endpoints.ts",
    "naming": "operationId"
  },
  "swagger-client.ts": {
    "output": "src/app/api/generated/swagger-client.ts",
    "framework": "angular"
  }
}
```

`swagger-client.ts.framework` can be `angular` or `react`. Each generated file
requires an `output` path. Imports between generated files are computed from
these paths, so outputs can live in different directories.

Examples showing only part of a configuration must be combined with the required
input and output sections. Paths, including paths in a custom config file, are
resolved relative to the command's working directory.

### Input files

`input` accepts a directory (all JSON files recursively), a file
glob, or an array of include/exclude glob patterns. Paths are relative to the
command's working directory; absolute paths also work. Use forward slashes in
glob patterns. `*` matches within one directory and `**` matches across nested
directories.

To include only one subtree:

```json
{
  "input": "swaggers/should-not-be-ignored/**/*.json"
}
```

To include JSON files while excluding a subtree:

```json
{
  "input": [
    "swaggers/**/*.json",
    "!swaggers/should-be-ignored/**"
  ]
}
```

Exclusions apply regardless of pattern order. Duplicate matches are processed
once, in sorted file order; only `.json` files are read. Glob selections with
no matching JSON files fail with an error. For glob or array selections,
generated `sourceFile` metadata is relative to the working directory; a plain
directory keeps metadata relative to that directory.

### Server URLs

`api-endpoints.ts.serverIndex` is optional and selects a zero-based index from each document's
top-level `servers` array to prefix generated endpoint paths:

```json
{
  "api-endpoints.ts": {
    "output": "generated/api-endpoints.ts",
    "serverIndex": 0
  }
}
```

For `servers: [{ "url": "/some-api/V01/xxx" }]`, the endpoint `/posts/{id}`
gets the path `/some-api/V01/xxx/posts/{id}` in `api-endpoints.ts`. Relative
server prefixes are appended to the client's configured `baseUrl` when making
requests, preserving any path already in `baseUrl`. Absolute HTTP(S) server
URLs are used directly by both clients, overriding `baseUrl` for that endpoint.
For example, `https://api.example.com/v1` with `/posts` sends requests to
`https://api.example.com/v1/posts`.

Slashes at the join are normalized; an empty operation path uses the
selected server URL exactly, without adding a trailing slash. Omitting this option keeps the
original endpoint paths. Invalid indexes or missing, empty, or non-string
selected URLs fail generation; URL errors identify the source file.

### Endpoint naming and namespaces

`api-endpoints.ts.naming` is optional:

- `operationId` uses the operation ID, normalized to a TypeScript identifier. This is the default.
- `tag_operationId` prefixes the operation ID with the first OpenAPI tag.
- `namespace_operationId` prefixes the operation ID with the document namespace.
- `namespace_tag_operationId` prefixes the operation ID with the document namespace and first tag.

The two namespace naming formats require a top-level `namespace` resolver.
With `tag_operationId`, an operation tagged `SomeController` with `operationId: "someEndpoint"` is generated as:

```ts
ApiEndpoints.SomeController_someEndpoint
```

To include a namespace, configure where it comes from in each Swagger document:

```json
{
  "api-endpoints.ts": {
    "output": "generated/api-endpoints.ts",
    "naming": "namespace_tag_operationId"
  },
  "namespace": {
    "pointer": "/servers/0/url",
    "pattern": "^/([^/]+)"
  }
}
```

For `servers: [{ "url": "/some-namespace/v1" }]`, tag `SomeController`, and
operation ID `someMethod`, this generates:

```ts
ApiEndpoints.SomeNamespace_SomeController_someMethod
```

`pointer` is a JSON Pointer relative to the document root. It can select any
string field, including custom extensions. Array indexes are path segments;
escape `/` in property names as `~1` and `~` as `~0`.
For example, `{ "pointer": "/info/x-namespace" }` uses that field's entire value.

`pattern` is an optional JavaScript regular expression without delimiters or
flags. When present, its first capture group supplies the namespace; without
capture groups, the full match is used. Omit it to use the entire selected string.
The namespace is converted to PascalCase. Only the first tag is used; operations
without tags receive the namespace and operation ID. Existing tag or namespace
prefixes followed by `_` are not repeated. Name collisions receive numeric suffixes.

Extraction runs separately for each Swagger file. Missing or non-string fields,
unmatched patterns, and empty namespaces fail generation with a file-specific
error. The namespace resolver does not change request URLs.

### Models, enums, and merging

The `api-models.ts` section also accepts:

- `enumStyle`: `"union"` (default) emits literal unions; `"enum"` emits named runtime enums.
- `mergeDeclarations`: `false` by default. When `true`, equivalent schemas with the same original name share a declaration within each namespace. Without a namespace, merging applies across all selected documents. Schemas with different structures remain separate.
- `prefix`: a literal prefix applied to every model and named enum declaration. It defaults to an empty string. `${namespace}` substitutes the resolved document namespace and requires a namespace resolver. For example, `"${namespace}_"` produces names such as `Billing_PostResponse`.

```json
{
  "input": "swaggers/**/*.json",
  "namespace": {
    "pointer": "/info/x-namespace"
  },
  "api-models.ts": {
    "output": "generated/api-models.ts",
    "enumStyle": "enum",
    "mergeDeclarations": true,
    "prefix": "${namespace}_"
  },
  "api-endpoints.ts": {
    "output": "generated/api-endpoints.ts",
    "naming": "namespace_tag_operationId"
  },
  "swagger-client.ts": {
    "output": "generated/swagger-client.ts",
    "framework": "react"
  }
}
```

### Legacy configuration

The older flat format remains supported. Use one format per configuration;
mixing grouped and legacy keys fails validation.

| Legacy setting | Grouped setting |
| --- | --- |
| `swaggers-directory` | `input` |
| `client` | `swagger-client.ts.framework` |
| `output["api-models.ts"]` | `api-models.ts.output` |
| `output["api-endpoints.ts"]` | `api-endpoints.ts.output` |
| `output["client.ts"]` | `swagger-client.ts.output` |
| `endpoint-namespace` | `namespace` |
| `endpoint-name-strategy` | `api-endpoints.ts.naming` |
| `serverUrlIndex` | `api-endpoints.ts.serverIndex` |
| `enum-style` | `api-models.ts.enumStyle` |
| `mergeDeclarations` | `api-models.ts.mergeDeclarations` |

For naming, legacy `tagAndOperationId` becomes `tag_operationId`, and
`namespaceTagAndOperationId` becomes `namespace_tag_operationId`.
`operationId` is unchanged. Declaration prefixes and `namespace_operationId`
naming are available in the grouped format only.

## Angular

Use `provideSwaggerClient` to register the client as
`EnvironmentProviders` without spreading a provider array:

```ts
import { provideSwaggerClient } from './api/generated/swagger-client';

bootstrapApplication(AppComponent, {
  providers: [
    provideHttpClient(),
    provideSwaggerClient({
      baseUrl: 'https://api.example.com'
    })
  ]
});
```

Starting with version `0.3.1`, `provideSwaggerClient(config)` returns
`EnvironmentProviders` for application or route configuration. Remove any spread
operator (`...`) when registering it. Version `0.3.0` retains the `Provider[]`
implementation.

### Custom HTTP adapters

Implement `SwaggerHttpClient` and pass the adapter class to `provideSwaggerClient`.
The adapter receives `{ method, url, headers, query, body, context }` and returns
`Observable<SwaggerHttpResponse<T>>`. Select the transport only here; application
request policy can keep using the injected `SwaggerClientService`.

For example, this generic native transport returns `{ code, body }`. It must reject
failed HTTP requests, or the client will reject returned non-2xx responses itself:

```ts
import { Injectable } from '@angular/core';
import { defer, map, Observable } from 'rxjs';
import type {
  SwaggerHttpClient, SwaggerHttpRequest, SwaggerHttpResponse
} from './api/generated/swagger-client';
import { NativeTransport } from './native-transport';

@Injectable()
export class MySwaggerHttpClient implements SwaggerHttpClient {
  constructor(private readonly transport: NativeTransport) {}

  request<T>(request: SwaggerHttpRequest): Observable<SwaggerHttpResponse<T>> {
    return defer(() => this.transport.request(request)).pipe(
      map(response => ({
        status: response.code, // actual native status, never a default 200
        body: request.method === 'HEAD' || response.code === 204 || response.code === 205
          ? null : (response.body ?? null) as T | null,
        headers: null, // this transport does not expose received headers
        url: null // final response URL is unavailable
      }))
    );
  }
}
```

The native transport remains application code: it handles query encoding and body
serialization and receives `context` unchanged. The library has no Capacitor,
platform detection, session recovery, caching, logging, authentication, or retry
policy. A promise-based native transport cannot necessarily cancel a native
operation on unsubscription; cancellation depends on the adapter. Angular's
default adapter retains HttpClient interceptors and cancellation.

Register the adapter class through `provideSwaggerClient`:

```ts
provideSwaggerClient({
  baseUrl: 'https://api.example.com',
  httpClient: MySwaggerHttpClient
});
```

### Responses and preparation (Angular and React)

Both generated clients export `SwaggerHttpResponse<T>`:

```ts
interface SwaggerHttpResponse<T> {
  status: number;
  body: T | null;
  headers: Readonly<Record<string, readonly string[]>> | null;
  url: string | null;
  empty?: boolean;
}
```

`status` is the actual HTTP status; an adapter unable to obtain it must fail rather
than invent a value. Response header names are lowercase. Arrays retain every
value exposed by the transport. Angular uses `HttpHeaders.getAll()`. Fetch combines
most repeated values into one string, which is retained without guessing how to
split it; separately exposed `getSetCookie()` values are preserved where available.
Browser/CORS restrictions can hide headers. `{}` means none were exposed;
`null` means header metadata was unavailable. Custom adapters must follow the same
lowercase-name and repeated-value convention. `url` is the final response URL when
exposed, otherwise `null`; it is never fabricated from the request URL.

The full-response body is nullable, including JSON `null`, empty responses, HEAD,
204 and 205. Adapters normalize absent bodies to `null` and may set `empty: true`
when they know no body was received. HEAD, 204 and 205 are normalized by the client
as well. The optional `empty` flag lets React preserve its legacy distinction
between an empty response (`undefined` in body mode) and JSON `null` (`null`).
Custom React adapters should set it for empty 200/201/202 responses too. Angular
body mode retains HttpClient's `null` for empty bodies. Existing body-mode types
remain `ResponseOf<typeof endpoint>` for compatibility, even where an empty
response yields null/undefined at runtime. Use full-response mode for an explicit
nullable-body type.

For an injected Angular client:

```ts
const variables = { pathVariables: { id: 123 } };
const body$ = client.request(ApiEndpoints.PostsController_getPost, variables);
const response$ = client.request(ApiEndpoints.PostsController_getPost, variables, {
  observe: 'response',
  headers: { 'X-Request-Id': 'example' },
  context: new HttpContext().set(MY_APPLICATION_TOKEN, true)
});
// Observable<SwaggerHttpResponse<ResponseOf<typeof ApiEndpoints.PostsController_getPost>>>

const prepared = client.prepare(ApiEndpoints.PostsController_getPost, variables, {
  headers: { 'X-Request-Id': 'example' },
  context: new HttpContext().set(MY_APPLICATION_TOKEN, true)
});
prepared.request;        // method, URL, headers, query, body and context; no execution
prepared.send();         // cold Observable of the body
prepared.sendResponse(); // cold Observable of the full response
```

`request()` and `prepare()` share request construction. The snapshot contains
resolved path parameters; query parameters are retained separately for the adapter
to encode. Caller headers override endpoint `headerVariables`, case-insensitively.
React additionally supports configuration headers with the lowest precedence.
Request header names are normalized to lowercase. Only the default React Fetch
adapter adds `content-type: application/json` when serializing a body, unless set
by the caller.

Preparation copies headers, query data and body data. Changing the original
variables or the exposed inspection snapshot does not change later executions.
Each execution receives another copy, so adapter mutations cannot leak into
another execution. JSON data and structured-cloneable body values are supported;
Angular also preserves FormData, URLSearchParams and immutable HttpParams bodies.
`HttpContext` and React's `AbortSignal` retain their identity and are intentionally
shared with the caller. Concurrent requests have their own response metadata.

Preparing does no transport work. Every Angular execution subscription calls the
configured adapter exactly once, even when subscribing repeatedly to the same
observable. There is no automatic subscription, retry or response cache. Errors
from HttpClient/custom adapters pass through the error channel unchanged. Returned
non-2xx responses from custom adapters become `SwaggerHttpError`; adapters should
normally emit their own native errors. No second client or platform selection is
needed by application request infrastructure.

### Migrating to 0.8.0

This is a **breaking change for existing Angular custom adapters**: change
`request<T>(): Observable<T>` to
`request<T>(): Observable<SwaggerHttpResponse<T>>`, preserving the actual status,
nullable body, exposed headers and final URL. Do not add body extraction to each
adapter: the generated client performs it centrally. Use `null` for unavailable
headers or URL. Regenerate your client and migrate every custom adapter together.
Existing body-only application calls remain valid; the adapter change is not
fully backward compatible. Version 0.8.0 is the next breaking minor in the current
pre-1.0 version series. Angular consumers now require RxJS 7 or later.
For React custom adapters, `SwaggerHttpError.response` can contain either the
original Fetch `Response` or a `SwaggerHttpResponse<unknown>`; narrow that union
before using Fetch-specific methods such as `text()`.

## React

Call `useSwaggerClient` inside a React component or custom hook:

```ts
import { ApiEndpoints } from './api/generated/api-endpoints';
import { useSwaggerClient } from './api/generated/swagger-client';

export function usePostClient() {
  return useSwaggerClient(ApiEndpoints.PostsController_getPost, {
    baseUrl: 'https://api.example.com'
  });
}
```

For imperative use, call `createSwaggerClient` with the same endpoint and
configuration:

```ts
import { ApiEndpoints } from './api/generated/api-endpoints';
import { createSwaggerClient } from './api/generated/swagger-client';

const client = createSwaggerClient(ApiEndpoints.PostsController_getPost, {
  baseUrl: 'https://api.example.com'
});

const post = await client.request({
  pathVariables: { id: 123 }
});
```

Successful responses with a body are parsed as JSON. Empty successful responses
(including HTTP 200, 201, 204, and 205) and HEAD requests resolve to `undefined`.
Nonempty malformed JSON rejects with a parsing error. HTTP failures reject with
`SwaggerHttpError`, whose `response` property contains the original Fetch response.

React supports the same response and preparation options on its existing endpoint
client; execution returns promises and begins when `send()` or `sendResponse()`
is called (promises do not have subscriptions):

```ts
const response = await client.request({ pathVariables: { id: 123 } }, {
  observe: 'response', headers: { 'X-Request-Id': 'example' }
});
const controller = new AbortController();
const prepared = client.prepare({ pathVariables: { id: 123 } }, {
  signal: controller.signal
});
prepared.request; // inspection only; no fetch yet
const pending = prepared.sendResponse(); // one fetch
controller.abort(); // cancellation forwarded to Fetch
```

For the same endpoint-based call shape as Angular, React also exports
`SwaggerClientService`:

```ts
const service = new SwaggerClientService({ baseUrl: 'https://api.example.com' });
const prepared = service.prepare(ApiEndpoints.PostsController_getPost, {
  pathVariables: { id: 123 }
});
const response = await prepared.sendResponse();
```

React selects its adapter once in configuration: `httpClient` takes precedence
over `fetch`; otherwise `FetchSwaggerHttpClient` uses the configured `fetch` or
global Fetch. A custom React adapter implements
`request<T>(request: SwaggerHttpRequest): Promise<SwaggerHttpResponse<T>>` and
receives runtime headers and `signal` unchanged. Existing `fetch` configuration
and `useSwaggerClient`/`createSwaggerClient` calls continue to work. Fetch errors
and abort errors reject unchanged. Unsuccessful Fetch responses still reject
with `SwaggerHttpError` containing the original `Response`.

## Local development

```sh
npm ci
npm test
node dist/cli/index.js generate
npm pack --dry-run
```

`npm test` builds the generator and runs the tests, including compilation and
runtime checks of generated clients. The default configuration reads
`test/fixtures` and writes examples to `generated/`. `npm pack` builds `dist/`
through the `prepack` script.

Dependencies, build output, generated examples, and temporary test files are
ignored by Git and can be recreated from the tracked source, lockfile, and
fixtures.
