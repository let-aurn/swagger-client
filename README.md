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

`endpoint-name-strategy` is optional:

- `operationId` uses the OpenAPI `operationId` as-is. This is the default.
- `tagAndOperationId` prefixes endpoint exports with the first OpenAPI tag, unless the `operationId` already starts with that tag.

With `tagAndOperationId`, an operation tagged `SomeController` with `operationId: "someEndpoint"` is generated as:

```ts
ApiEndpoints.SomeController_someEndpoint
```

## Angular

```ts
bootstrapApplication(AppComponent, {
  providers: [
    provideHttpClient(),
    provideSwaggerClient({
      baseUrl: 'https://api.example.com'
    })
  ]
});
```

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
