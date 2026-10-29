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


## Publishing from GitHub

The `Publish to npm` workflow (`.github/workflows/publish.yml`) runs when a GitHub
Release is **published**. It tests and builds the tagged source, then publishes
`@let-aurn/swagger-client` to the public npm registry with provenance. It uses
npm trusted publishing (GitHub OIDC), so no `NPM_TOKEN` secret is required.

### One-time npm setup

An npm package owner must open the package's settings at
<https://www.npmjs.com/package/@let-aurn/swagger-client/access>, find **Trusted
Publisher**, select **GitHub Actions**, and enter:

| Setting | Value |
| --- | --- |
| Organization or user | `let-aurn` |
| Repository | `swagger-client` |
| Workflow filename | `publish.yml` |
| Environment name | Leave empty (this workflow does not use an environment) |

Save that trusted publisher before the first automated publication. The workflow
uses a GitHub-hosted runner, Node.js 24, npm 11 (which supports trusted
publishing), and `id-token: write` permission. Repository metadata in
`package.json` identifies the source repository for provenance. If the package
does not exist yet, an npm owner must publish it once before configuring its
trusted publisher.

### Publish a version

1. Update both version files in a PR, for example:
   `npm version 0.8.0 --no-git-tag-version`. For a prerelease use a version such
   as `0.8.0-beta.1`. Commit `package.json` and `package-lock.json` and merge the PR.
2. In GitHub, open **Releases → Draft a new release**. Create a tag matching the
   merged package version exactly, such as `v0.8.0`, targeting the intended commit
   on `main`.
3. Publish the release. For a version containing a prerelease suffix, check
   **Set as a pre-release** as well. Stable versions publish under npm's `latest`
   tag; prerelease versions or GitHub prereleases publish under `next`.
4. Follow the **Publish to npm** run in the repository's **Actions** tab.

Drafting a release, pushing a tag alone, or merging a PR does not publish to npm.
The workflow rejects release tags that do not match `package.json`, installs from
the lockfile, and runs the build/test suite before publishing. npm versions are
immutable: use a new version for another publication. A failed run can be rerun
after fixing npm trusted-publisher setup, provided that version was not already
published. Concurrent publish runs are serialized without cancelling an active
publication.
