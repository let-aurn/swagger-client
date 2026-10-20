# Swagger Client

Generate typed Angular and React clients from OpenAPI JSON files.

```sh
npx swagger-client generate
npx swagger-client generate --config=swagger-client.json
```

## Config

```json
{
  "client": "angular",
  "swaggers-directory": "path/to/swaggers",
  "endpoint-name-strategy": "operationId",
  "output": {
    "api-models.ts": "src/app/api/generated/api-models.ts",
    "api-endpoints.ts": "src/app/api/generated/api-endpoints.ts",
    "client.ts": "src/app/api/generated/swagger-client.ts"
  }
}
```

`client` can be `angular` or `react`.

`swaggers-directory` accepts a directory (all JSON files recursively), a file
glob, or an array of include/exclude glob patterns. Paths are relative to the
command's working directory; absolute paths also work. Use forward slashes in
glob patterns. `*` matches within one directory and `**` matches across nested
directories.

To include only one subtree:

```json
{
  "swaggers-directory": "swaggers/should-not-be-ignored/**/*.json"
}
```

To include JSON files while excluding a subtree:

```json
{
  "swaggers-directory": [
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

`serverUrlIndex` is optional and selects a zero-based index from each document's
top-level `servers` array to prefix generated endpoint paths:

```json
{
  "serverUrlIndex": 0
}
```

For `servers: [{ "url": "/some-api/V01/xxx" }]`, the endpoint `/posts/{id}`
gets the path `/some-api/V01/xxx/posts/{id}` in `api-endpoints.ts`. Relative
server prefixes are appended to the client's configured `baseUrl` when making
requests. Slashes at the join are normalized; an empty operation path uses the
selected server URL exactly, without adding a trailing slash. Omitting this option keeps the
original endpoint paths. Invalid indexes or missing, empty, or non-string
selected URLs fail generation; URL errors identify the source file.

`endpoint-name-strategy` is optional:

- `operationId` uses the OpenAPI `operationId` as-is. This is the default.
- `tagAndOperationId` prefixes endpoint exports with the first OpenAPI tag, unless the `operationId` already starts with that tag.
- `namespaceTagAndOperationId` adds a document namespace before the tag and operation ID. Requires `endpoint-namespace`.

With `tagAndOperationId`, an operation tagged `SomeController` with `operationId: "someEndpoint"` is generated as:

```ts
ApiEndpoints.SomeController_someEndpoint
```

To include a namespace, configure where it comes from in each Swagger document:

```json
{
  "endpoint-name-strategy": "namespaceTagAndOperationId",
  "endpoint-namespace": {
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
error. This setting affects endpoint names only, not request URLs.

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
The adapter receives `{ method, url, headers, query, body }` and returns an
`Observable<T>` of the response body. For a transport returning `Promise<{ data: unknown }>`:

```ts
import { Injectable } from '@angular/core';
import { defer, map, Observable } from 'rxjs';
import type {
  SwaggerHttpClient,
  SwaggerHttpRequest
} from './api/generated/swagger-client';
import { NativeTransport } from './native-transport';

@Injectable()
export class MySwaggerHttpClient implements SwaggerHttpClient {
  constructor(private readonly transport: NativeTransport) {}

  request<T>(request: SwaggerHttpRequest): Observable<T> {
    return defer(() => this.transport.request(request)).pipe(
      map(response => response.data as T)
    );
  }
}
```

Register the adapter class through `provideSwaggerClient`:

```ts
provideSwaggerClient({
  baseUrl: 'https://api.example.com',
  httpClient: MySwaggerHttpClient
});
```

## React

```ts
const client = useSwaggerClient(ApiEndpoints.PostsController_getPost, {
  baseUrl: 'https://api.example.com'
});

const post = await client.request({
  pathVariables: { id: 123 }
});
```
