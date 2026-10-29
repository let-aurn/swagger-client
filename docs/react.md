# React

[Back to README](../README.md#react)

Set `swagger-client.ts.framework` to `"react"` and install `react` in the consuming application.

See [Responses and preparation](responses.md) for shared response metadata and request construction rules.

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


For custom adapters, `SwaggerHttpError.response` can contain either the original Fetch `Response` or a `SwaggerHttpResponse<unknown>`; narrow that union before using Fetch-specific methods such as `text()`.
