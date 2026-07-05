import { mkdir, writeFile } from "node:fs/promises";
import { dirname, relative } from "node:path";
import type { SwaggerClientConfig } from "./types.js";
import { readOpenApiProject } from "./read-openapi.js";
import { emitModels } from "../generators/models.js";
import { emitEndpoints } from "../generators/endpoints.js";
import { emitAngularClient } from "../generators/angular-client.js";
import { emitReactClient } from "../generators/react-client.js";

/**
 * Generates TypeScript model, endpoint, and client files from a swagger-client configuration.
 *
 * @param config The resolved swagger-client generation configuration.
 * @returns A promise that resolves when all generated files have been written.
 * @throws Error when OpenAPI files cannot be read or generated files cannot be written.
 */
export async function generate(config: SwaggerClientConfig): Promise<void> {
  const project = await readOpenApiProject(config["swaggers-directory"], config["endpoint-name-strategy"]);
  const modelsPath = config.output["api-models.ts"];
  const endpointsPath = config.output["api-endpoints.ts"];
  const clientPath = config.output["client.ts"];

  await writeGeneratedFile(modelsPath, emitModels(project));
  await writeGeneratedFile(endpointsPath, emitEndpoints(project, {
    modelsImportPath: toTypeScriptImportPath(endpointsPath, modelsPath)
  }));
  await writeGeneratedFile(
    clientPath,
    config.client === "angular"
      ? emitAngularClient({ endpointsImportPath: toTypeScriptImportPath(clientPath, endpointsPath) })
      : emitReactClient({ endpointsImportPath: toTypeScriptImportPath(clientPath, endpointsPath) })
  );
}

async function writeGeneratedFile(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${content.trimEnd()}\n`, "utf8");
}

function toTypeScriptImportPath(fromFile: string, toFile: string): string {
  const withoutExtension = relative(dirname(fromFile), toFile).replace(/\.ts$/, "");
  const normalized = withoutExtension.split("\\").join("/");

  return normalized.startsWith(".") ? normalized : `./${normalized}`;
}
