import type { OpenApiDocument } from "./types.js";

/**
 * Validates the optional index used to select a document server URL.
 *
 * @param index The zero-based server index; undefined disables server prefixing.
 * @param source The configuration source to include in validation errors.
 * @throws When the index is not a non-negative safe integer.
 */
export function validateServerUrlIndex(index: number | undefined, source: string): void {
  if (index !== undefined && (!Number.isSafeInteger(index) || index < 0)) {
    throw new Error(`${source}: "serverUrlIndex" must be a non-negative safe integer.`);
  }
}

/**
 * Selects the server URL to prepend to endpoint paths.
 *
 * @param document The OpenAPI document containing the server definitions.
 * @param index The zero-based server index, or undefined for no prefix.
 * @param sourceFile The document filename to include in selection errors.
 * @returns The selected server URL, or an empty string when no index is configured.
 * @throws When the selected server is missing or its URL is not a non-empty string.
 */
export function selectServerUrl(document: OpenApiDocument, index: number | undefined, sourceFile: string): string {
  if (index === undefined) {
    return "";
  }

  const url = Array.isArray(document.servers) ? document.servers[index]?.url : undefined;
  if (typeof url !== "string" || url.trim() === "") {
    throw new Error(`${sourceFile}: servers[${index}].url must be a non-empty string when "serverUrlIndex" is provided.`);
  }

  return url;
}
