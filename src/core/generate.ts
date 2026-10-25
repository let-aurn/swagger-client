import { transpileModule, ModuleKind, ScriptTarget } from "typescript-transpiler";
import { emitFetchClient } from "../generators/fetch-client.js";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import type { GenerationResult, SwaggerClientConfig } from "./types.js";
import { isGroupedConfig, validateConfig } from "./load-config.js";
import { readOpenApiProject } from "./read-openapi.js";
import { emitModels } from "../generators/models.js";
import { emitEndpoints } from "../generators/endpoints.js";
import { emitAngularClient } from "../generators/angular-client.js";
import { emitReactClient } from "../generators/react-client.js";

/**
 * Generates TypeScript model, endpoint, and client files from a swagger-client configuration.
 *
 * @param config The resolved swagger-client generation configuration.
 * @returns Generation counts, client framework, and absolute output paths after all files have been written.
 * @throws When configuration is invalid, OpenAPI documents cannot be read or normalized, or output files cannot be written.
 */
export async function generate(config: SwaggerClientConfig): Promise<GenerationResult> {
  validateConfig(config, "Generation config");
  const grouped = isGroupedConfig(config);
  const project = grouped
    ? await readOpenApiProject(config.input, {
      namespace: config.namespace,
      naming: config["api-endpoints.ts"].naming,
      serverIndex: config["api-endpoints.ts"].serverIndex,
      enumStyle: config["api-models.ts"].enumStyle,
      mergeDeclarations: config["api-models.ts"].mergeDeclarations,
      prefix: config["api-models.ts"].prefix
    })
    : await readOpenApiProject(config["swaggers-directory"], config["endpoint-name-strategy"], config["endpoint-namespace"], config.serverUrlIndex, config["enum-style"], config.mergeDeclarations);
  const modelsPath = grouped ? config["api-models.ts"].output : config.output["api-models.ts"];
  const endpointsPath = grouped ? config["api-endpoints.ts"].output : config.output["api-endpoints.ts"];
  const clientPath = grouped ? config["swagger-client.ts"].output : config.output["client.ts"];
  const framework = grouped ? config["swagger-client.ts"].framework : config.client;

  const javascript = grouped && config.language === "javascript";
  const emit = async (path: string, content: string) => writeGeneratedFile(path, javascript
    ? transpileModule(content, { compilerOptions: { module: ModuleKind.ES2022, target: ScriptTarget.ES2022 } }).outputText
    : content);
  await emit(modelsPath, emitModels(project));
  await emit(endpointsPath, emitEndpoints(project, {
    modelsImportPath: toTypeScriptImportPath(endpointsPath, modelsPath)
  }));
  const options = { endpointsImportPath: toTypeScriptImportPath(clientPath, endpointsPath) };
  await emit(clientPath, framework === "angular" ? emitAngularClient(options)
    : framework === "react" ? emitReactClient(options) : emitFetchClient(options));
  return {
    endpointCount: project.endpoints.length,
    client: framework,
    typeCount: project.schemas.length,
    modelsPath: resolve(modelsPath),
    endpointsPath: resolve(endpointsPath),
    clientPath: resolve(clientPath)
  };
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
