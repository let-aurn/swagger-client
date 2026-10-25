import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { validateEndpointNamespace } from "./endpoint-namespace.js";
import { validateServerUrlIndex } from "./server-url.js";
import { resolveSwaggerInput, validateSwaggerInput } from "./swagger-files.js";
import type { GroupedSwaggerClientConfig, SwaggerClientConfig } from "./types.js";
import { validateEnumStyle } from "./enums.js";
import { validateMergeDeclarations } from "./merge-declarations.js";
import { validateDeclarationPrefix } from "./declaration-prefix.js";

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

  if (isGroupedConfig(config)) {
    return {
      ...config,
      input: resolveSwaggerInput(config.input),
      "api-models.ts": { ...config["api-models.ts"], output: resolve(config["api-models.ts"].output) },
      "api-endpoints.ts": { ...config["api-endpoints.ts"], output: resolve(config["api-endpoints.ts"].output) },
      "swagger-client.ts": { ...config["swagger-client.ts"], output: resolve(config["swagger-client.ts"].output) }
    };
  }

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

/**
 * Identifies configurations that use settings grouped by generated file.
 *
 * @param config The configuration to inspect.
 * @returns Whether the configuration contains a grouped-format top-level setting.
 */
export function isGroupedConfig(config: SwaggerClientConfig): config is GroupedSwaggerClientConfig {
  return ["input", "namespace", "api-models.ts", "api-endpoints.ts", "swagger-client.ts"].some(key => Object.hasOwn(config, key));
}

/**
 * Validates the settings required to generate models, endpoints, and a client.
 *
 * @param config The grouped or legacy generation configuration.
 * @param configPath The configuration path or label to include in validation errors.
 * @throws When required settings are missing, values are invalid, or configuration formats are mixed.
 */
export function validateConfig(config: SwaggerClientConfig, configPath: string): void {
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    throw new Error(`${configPath}: configuration must be an object.`);
  }
  if (isGroupedConfig(config)) {
    validateGroupedConfig(config, configPath);
    return;
  }
  validateEnumStyle(config["enum-style"], configPath);
  validateMergeDeclarations(config.mergeDeclarations, configPath);
  validateServerUrlIndex(config.serverUrlIndex, configPath);

  if (config.client !== "angular" && config.client !== "react" && config.client !== "fetch") {
    throw new Error(`${configPath}: "client" must be "angular", "react", or "fetch".`);
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

  if (config["endpoint-namespace"] !== undefined || config["endpoint-name-strategy"] === "namespaceTagAndOperationId" || config.mergeDeclarations) {
    validateEndpointNamespace(config["endpoint-namespace"], configPath);
  }

  for (const key of ["api-models.ts", "api-endpoints.ts", "client.ts"] as const) {
    if (!config.output?.[key]) {
      throw new Error(`${configPath}: output["${key}"] is required.`);
    }
  }
}

function validateGroupedConfig(config: GroupedSwaggerClientConfig, source: string): void {
  const legacyKeys = ["client", "swaggers-directory", "endpoint-name-strategy", "endpoint-namespace", "mergeDeclarations", "enum-style", "serverUrlIndex", "output"];
  if (legacyKeys.some(key => Object.hasOwn(config, key))) {
    throw new Error(`${source}: cannot mix legacy configuration keys with the grouped configuration.`);
  }
  assertKeys(config, ["input", "language", "namespace", "api-models.ts", "api-endpoints.ts", "swagger-client.ts"], source);
  validateSwaggerInput(config.input, `${source}: input`);
  for (const key of ["api-models.ts", "api-endpoints.ts", "swagger-client.ts"] as const) {
    const section = config[key];
    if (!section || typeof section !== "object" || Array.isArray(section) || typeof section.output !== "string" || !section.output.trim()) {
      throw new Error(`${source}: "${key}.output" must be a non-empty path string.`);
    }
  }
  if (config.language !== undefined && !["typescript", "javascript"].includes(config.language)) {
    throw new Error(`${source}: "language" must be "typescript" or "javascript".`);
  }
  if (config.language === "javascript") {
    if (config["swagger-client.ts"].framework !== "fetch") {
      throw new Error(`${source}: JavaScript output requires the Fetch framework.`);
    }
    for (const key of ["api-models.ts", "api-endpoints.ts", "swagger-client.ts"] as const) {
      if (!config[key].output.endsWith(".js")) throw new Error(`${source}: JavaScript output paths must end in .js.`);
    }
  }
  const models = config["api-models.ts"];
  const endpoints = config["api-endpoints.ts"];
  const client = config["swagger-client.ts"];
  assertKeys(models, ["output", "mergeDeclarations", "prefix", "enumStyle"], `${source}: api-models.ts`);
  assertKeys(endpoints, ["output", "naming", "serverIndex"], `${source}: api-endpoints.ts`);
  assertKeys(client, ["output", "framework"], `${source}: swagger-client.ts`);
  validateEnumStyle(models.enumStyle, `${source}: api-models.ts.enumStyle`);
  validateMergeDeclarations(models.mergeDeclarations, `${source}: api-models.ts`);
  validateDeclarationPrefix(models.prefix, config.namespace !== undefined, source);
  validateServerUrlIndex(endpoints.serverIndex, `${source}: api-endpoints.ts.serverIndex`);
  if (endpoints.naming !== undefined && !["operationId", "tag_operationId", "namespace_operationId", "namespace_tag_operationId"].includes(endpoints.naming)) {
    throw new Error(`${source}: "api-endpoints.ts.naming" must be "operationId", "tag_operationId", "namespace_operationId", or "namespace_tag_operationId".`);
  }
  if (config.namespace !== undefined || endpoints.naming?.startsWith("namespace_")) {
    validateEndpointNamespace(config.namespace, `${source}: namespace`);
  }
  if (client.framework !== "angular" && client.framework !== "react" && client.framework !== "fetch") {
    throw new Error(`${source}: "swagger-client.ts.framework" must be "angular", "react", or "fetch".`);
  }
}

function assertKeys(value: object, allowed: string[], source: string): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) throw new Error(`${source}: unknown setting "${key}".`);
  }
}
