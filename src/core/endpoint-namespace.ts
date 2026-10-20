import type { EndpointNamespaceConfig } from "./types.js";
import { toPascalCase } from "./names.js";

/**
 * Validates the JSON Pointer and optional pattern used to resolve namespaces.
 *
 * @param config The namespace resolver configuration.
 * @param source The configuration source to include in validation errors.
 * @throws When the resolver is missing or its pointer or regular expression is invalid.
 */
export function validateEndpointNamespace(config: EndpointNamespaceConfig | undefined, source: string): void {
  if (!config || typeof config.pointer !== "string" || !/^(?:\/(?:[^~]|~[01])*)*$/.test(config.pointer)) {
    throw new Error(`${source}: "endpoint-namespace.pointer" must be a JSON Pointer (for example "/servers/0/url").`);
  }
  if (config.pattern !== undefined) {
    if (typeof config.pattern !== "string") {
      throw new Error(`${source}: "endpoint-namespace.pattern" must be a regex string.`);
    }
    try {
      new RegExp(config.pattern);
    } catch {
      throw new Error(`${source}: "endpoint-namespace.pattern" is not a valid regex.`);
    }
  }
}

/**
 * Extracts a namespace from an OpenAPI document and converts it to PascalCase.
 *
 * @param document The parsed OpenAPI document.
 * @param config The validated JSON Pointer and optional extraction pattern.
 * @param source The document source to include in extraction errors.
 * @returns A valid PascalCase identifier for the resolved namespace.
 * @throws When the selected value is not a string, does not match the pattern, or has no letters or digits.
 */
export function extractEndpointNamespace(document: unknown, config: EndpointNamespaceConfig, source: string): string {
  let value: unknown = document;
  const tokens = config.pointer === "" ? [] : config.pointer.slice(1).split("/");
  for (const token of tokens) {
    const key = token.replace(/~1/g, "/").replace(/~0/g, "~");
    if (value === null || typeof value !== "object" || !Object.hasOwn(value, key)) {
      value = undefined;
      break;
    }
    value = (value as Record<string, unknown>)[key];
  }
  if (typeof value !== "string") {
    throw new Error(`${source}: namespace at "${config.pointer}" must be a string.`);
  }
  if (config.pattern !== undefined) {
    const match = new RegExp(config.pattern).exec(value);
    value = match ? (match.length > 1 ? match[1] : match[0]) : undefined;
  }
  if (typeof value !== "string" || !/[A-Za-z0-9]/.test(value)) {
    throw new Error(`${source}: namespace extracted from "${config.pointer}" is empty or does not match the configured pattern.`);
  }
  return toPascalCase(value);
}
