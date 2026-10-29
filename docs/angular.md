# Angular

[Back to README](../README.md#angular)

Set `swagger-client.ts.framework` to `"angular"`. The consuming application needs `@angular/common`, `@angular/core`, and RxJS 7 or later.

Register `provideSwaggerClient` in application or route providers. It returns `EnvironmentProviders`. See the [setup and request examples](../README.md#angular).

See [Responses and preparation](responses.md) for full responses, request snapshots, headers, context, and execution behavior.

## Custom HTTP adapters

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

Adapters return `Observable<SwaggerHttpResponse<T>>` with the actual status and nullable body. Use `null` for unavailable headers or final URL. The generated client extracts the body centrally for body-only calls. Regenerate the client and update custom adapters together when adopting this contract.
