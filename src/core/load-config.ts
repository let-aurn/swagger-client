import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { validateEndpointNamespace } from "./endpoint-namespace.js";
import { validateServerUrlIndex } from "./server-url.js";
import { resolveSwaggerInput, validateSwaggerInput } from "./swagger-files.js";
import type { SwaggerClientConfig } from "./types.js";

/**
 * Loads and validates a swagger-client configuration file.
 *
 * @param configPath The path to the JSON configuration file.
 * @returns The resolved swagger-client configuration.
 * @throws Error when the configuration file is missing, invalid JSON, or structurally invalid.
 */
export async function loadConfig(configPath: string): Promise<SwaggerClientConfig> {
  const absolutePath = resolve(configPath);
  const raw = await readFile(absolutePath, "utf8");
  const config = JSON.parse(raw) as SwaggerClientConfig;

  validateConfig(config, absolutePath);

  return {
    ...config,
    "swaggers-directory": resolveSwaggerInput(config["swaggers-directory"]),
    output: {
      "api-models.ts": resolve(config.output["api-models.ts"]),
      "api-endpoints.ts": resolve(config.output["api-endpoints.ts"]),
      "client.ts": resolve(config.output["client.ts"])
    }
  };
}

function validateConfig(config: SwaggerClientConfig, configPath: string): void {
  validateServerUrlIndex(config.serverUrlIndex, configPath);

  if (config.client !== "angular" && config.client !== "react") {
    throw new Error(`${configPath}: "client" must be "angular" or "react".`);
  }

  validateSwaggerInput(config["swaggers-directory"], configPath);

  if (
    config["endpoint-name-strategy"] !== undefined &&
    config["endpoint-name-strategy"] !== "operationId" &&
    config["endpoint-name-strategy"] !== "tagAndOperationId" &&
    config["endpoint-name-strategy"] !== "namespaceTagAndOperationId"
  ) {
    throw new Error(`${configPath}: "endpoint-name-strategy" must be "operationId", "tagAndOperationId", or "namespaceTagAndOperationId".`);
  }

  if (config["endpoint-namespace"] !== undefined || config["endpoint-name-strategy"] === "namespaceTagAndOperationId") {
    validateEndpointNamespace(config["endpoint-namespace"], configPath);
  }

  for (const key of ["api-models.ts", "api-endpoints.ts", "client.ts"] as const) {
    if (!config.output?.[key]) {
      throw new Error(`${configPath}: output["${key}"] is required.`);
    }
  }
}
