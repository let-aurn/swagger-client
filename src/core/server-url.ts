import type { OpenApiDocument } from "./types.js";

export function validateServerUrlIndex(index: number | undefined, source: string): void {
  if (index !== undefined && (!Number.isSafeInteger(index) || index < 0)) {
    throw new Error(`${source}: "serverUrlIndex" must be a non-negative safe integer.`);
  }
}

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
