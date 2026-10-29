# Responses and preparation

[Back to README](../README.md)

See the [Angular guide](angular.md) and [React guide](react.md) for client setup.

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
as well. The optional `empty` flag lets React distinguish
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
