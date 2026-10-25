import { emitFetchClient, type EmitFetchClientOptions } from "./fetch-client.js";

/** Emits the Fetch client with the React hook adapter. */
export function emitReactClient(options: EmitFetchClientOptions = {}): string {
  return "import { useMemo } from 'react';\n" + emitFetchClient(options) + String.raw`
/**
 * Creates a memoized typed client for a generated API endpoint.
 *
 * @param endpoint The generated endpoint definition to call.
 * @param config The swagger client runtime configuration.
 * @returns A typed endpoint client.
 */
export function useSwaggerClient<TEndpoint extends AnyApiEndpoint>(
  endpoint: TEndpoint,
  config: SwaggerClientConfig
): SwaggerEndpointClient<TEndpoint> {
  return useMemo(() => createSwaggerClient(endpoint, config), [endpoint, config]);
}

`;
}
