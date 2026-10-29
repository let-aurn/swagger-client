# Swagger Client

Generate typed Angular and React clients from OpenAPI JSON files.

Requires **Node.js 20+**. Generates models, endpoint definitions, and a client as three TypeScript files.

## Quick start

1. Install the generator:

   ```sh
   npm install --save-dev @let-aurn/swagger-client
   ```

2. Create `swagger-client.json` in your project root:

   ```json
   {
     "$schema": "./node_modules/@let-aurn/swagger-client/schema.json",
     "input": "swaggers",
     "api-models.ts": {
       "output": "src/api/generated/api-models.ts"
     },
     "api-endpoints.ts": {
       "output": "src/api/generated/api-endpoints.ts"
     },
     "swagger-client.ts": {
       "output": "src/api/generated/swagger-client.ts",
       "framework": "angular"
     }
   }
   ```

3. Put your OpenAPI JSON files in `swaggers/` and generate:

   ```sh
   npx swagger-client generate
   ```

Set `framework` to `"react"` for React. Your application needs `@angular/common`, `@angular/core`, and `rxjs` 7+ for Angular, or `react` for React.

Without a local installation, run `npx @let-aurn/swagger-client generate`.

## Usage

These examples assume an operation with `operationId: "PostsController_getPost"` and a required numeric `id` path parameter. Replace the endpoint with one from your API.

### Angular

Register the client in your application configuration:

```ts
import { provideHttpClient } from '@angular/common/http';
import { provideSwaggerClient } from './api/generated/swagger-client';

export const appConfig = {
  providers: [
    provideHttpClient(),
    provideSwaggerClient({ baseUrl: 'https://api.example.com' })
  ]
};
```

Call it from a component or service:

```ts
import { inject, Injectable } from '@angular/core';
import { ApiEndpoints } from './api/generated/api-endpoints';
import { SwaggerClientService } from './api/generated/swagger-client';

@Injectable({ providedIn: 'root' })
export class PostsService {
  private readonly api = inject(SwaggerClientService);

  getPost(id: number) {
    return this.api.request(ApiEndpoints.PostsController_getPost, {
      pathVariables: { id }
    });
  }
}
```

See the [Angular guide](docs/angular.md) for custom HTTP adapters. Both clients support [full responses and request preparation](docs/responses.md).

### React

Use the generated hook inside a component or custom hook:

```ts
import { ApiEndpoints } from './api/generated/api-endpoints';
import { useSwaggerClient } from './api/generated/swagger-client';

const config = { baseUrl: 'https://api.example.com' };

export function usePostClient() {
  const client = useSwaggerClient(ApiEndpoints.PostsController_getPost, config);
  return (id: number) => client.request({ pathVariables: { id } });
}
```

See the [React guide](docs/react.md) for imperative requests and response handling.

## Configuration

| Setting | Purpose | Default |
| --- | --- | --- |
| `$schema` | Editor completion and configuration validation | Optional |
| `input` | Directory, glob, or include/exclude patterns | Required |
| `*.output` | Output path in each generated-file section | Required |
| `swagger-client.ts.framework` | `angular` or `react` | Required |
| `api-endpoints.ts.naming` | Endpoint naming strategy | `operationId` |
| `api-endpoints.ts.serverIndex` | Prefix paths with a document server URL | No prefix |
| `api-models.ts.enumStyle` | Literal unions or runtime enums | `union` |
| `api-models.ts.mergeDeclarations` | Share equivalent model declarations | `false` |

Use `npx swagger-client generate --config=path/to/swagger-client.json` for a custom configuration. All paths resolve relative to the command's working directory.

## Documentation

- [Configuration reference](docs/configuration.md): input selection, server URLs, namespaces, naming, and models
- [Angular guide](docs/angular.md): setup, requests, and custom HTTP adapters
- [React guide](docs/react.md): hooks, imperative requests, and response handling
- [Responses and preparation](docs/responses.md): response metadata, headers, and execution
- [Contributing](CONTRIBUTING.md): local development, validation, and publishing

## License

MIT.
