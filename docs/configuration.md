# Configuration reference

[Back to README](../README.md)

Add the optional `$schema` property for editor completion, hover descriptions,
and validation. The schema ships with the installed package; adjust the relative
path when your config lives in a subdirectory. The generator does not fetch it.
For `npx` without a local installation, use a schema URL pinned to a release tag,
such as `https://raw.githubusercontent.com/let-aurn/swagger-client/v<VERSION>/schema.json`
(replace `<VERSION>` with a release containing the schema). CLI checks still validate
regular expressions and values extracted from OpenAPI documents during generation.

```json
{
  "$schema": "./node_modules/@let-aurn/swagger-client/schema.json",
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

## Input files

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

## Server URLs

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

## Endpoint naming and namespaces

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

## Models, enums, and merging

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
