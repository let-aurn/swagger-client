import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import type {
  EndpointNameStrategy,
  EndpointNamespaceConfig,
  EndpointModel,
  HttpMethod,
  OpenApiDocument,
  OpenApiOperation,
  OpenApiParameter,
  OpenApiResponse,
  OpenApiSchema,
  ProjectModel,
  SchemaModel,
  VariableModel
} from "./types.js";
import { schemaToType } from "./schema-to-typescript.js";
import { ensureIdentifier, toPascalCase, uniqueName } from "./names.js";

import { extractEndpointNamespace, validateEndpointNamespace } from "./endpoint-namespace.js";
import { selectServerUrl, validateServerUrlIndex } from "./server-url.js";

const HTTP_METHODS = new Set(["get", "post", "put", "patch", "delete", "head", "options"]);

/**
 * Reads OpenAPI JSON files from a directory and converts them to the generator project model.
 *
 * @param swaggerDirectory The directory containing one or more OpenAPI JSON files.
 * @param endpointNameStrategy The strategy used to name generated endpoint constants.
 * @param endpointNamespace Configurable document field and optional namespace extraction regex.
 * @param serverUrlIndex Optional document server URL index to prefix endpoint paths with.
 * @returns The normalized schemas and endpoints discovered in the OpenAPI files.
 * @throws Error when a JSON file cannot be read or parsed.
 */
export async function readOpenApiProject(
  swaggerDirectory: string,
  endpointNameStrategy: EndpointNameStrategy = "operationId",
  endpointNamespace?: EndpointNamespaceConfig,
  serverUrlIndex?: number
): Promise<ProjectModel> {
  validateServerUrlIndex(serverUrlIndex, swaggerDirectory);
  if (endpointNameStrategy === "namespaceTagAndOperationId") {
    validateEndpointNamespace(endpointNamespace, swaggerDirectory);
  }

  const files = await findJsonFiles(swaggerDirectory);
  const schemas: SchemaModel[] = [];
  const endpoints: EndpointModel[] = [];
  const usedSchemaNames = new Set<string>();
  const usedEndpointNames = new Set<string>();

  for (const file of files) {
    const document = JSON.parse(await readFile(file, "utf8")) as OpenApiDocument;
    const sourceFile = relative(swaggerDirectory, file);
    const serverUrl = selectServerUrl(document, serverUrlIndex, sourceFile);
    const schemaNameMap = collectSchemas(document, schemas, usedSchemaNames);

    const namespace = endpointNameStrategy === "namespaceTagAndOperationId"
      ? extractEndpointNamespace(document, endpointNamespace!, sourceFile)
      : undefined;
    endpoints.push(...collectEndpoints(document, sourceFile, schemaNameMap, usedEndpointNames, endpointNameStrategy, namespace, serverUrl));
  }

  return { schemas, endpoints };
}

async function findJsonFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const path = join(directory, entry.name);

    if (entry.isDirectory()) {
      files.push(...await findJsonFiles(path));
    } else if (entry.isFile() && entry.name.endsWith(".json")) {
      files.push(path);
    }
  }

  return files.sort();
}

function collectSchemas(
  document: OpenApiDocument,
  schemas: SchemaModel[],
  usedSchemaNames: Set<string>
): Map<string, string> {
  const schemaNameMap = new Map<string, string>();
  const sourceSchemas = document.components?.schemas ?? document.definitions ?? {};

  for (const rawName of Object.keys(sourceSchemas)) {
    const generatedName = uniqueName(toPascalCase(rawName), usedSchemaNames);
    schemaNameMap.set(rawName, generatedName);
  }

  for (const [rawName, schema] of Object.entries(sourceSchemas)) {
    const generatedName = schemaNameMap.get(rawName);
    if (!generatedName) {
      continue;
    }

    schemas.push({
      name: generatedName,
      schema: rewriteRefs(schema, schemaNameMap)
    });
  }

  return schemaNameMap;
}

function collectEndpoints(
  document: OpenApiDocument,
  sourceFile: string,
  schemaNameMap: Map<string, string>,
  usedEndpointNames: Set<string>,
  endpointNameStrategy: EndpointNameStrategy,
  namespace?: string,
  serverUrl = ""
): EndpointModel[] {
  const endpoints: EndpointModel[] = [];

  for (const [path, pathItem] of Object.entries(document.paths ?? {})) {
    if (!isRecord(pathItem)) {
      continue;
    }

    for (const [method, operation] of Object.entries(pathItem)) {
      if (!HTTP_METHODS.has(method) || !isOperation(operation)) {
        continue;
      }

      const operationId = operation.operationId ?? fallbackOperationId(method, path);
      const endpointName = uniqueName(endpointNameForOperation(operation, operationId, endpointNameStrategy, namespace), usedEndpointNames);
      const parameters = operation.parameters ?? [];

      endpoints.push({
        name: endpointName,
        method: method.toUpperCase() as HttpMethod,
        path: serverUrl && path ? `${serverUrl.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}` : serverUrl || path,
        operationId,
        sourceFile,
        pathVariables: variablesFor(parameters, "path", schemaNameMap),
        queryVariables: variablesFor(parameters, "query", schemaNameMap),
        headerVariables: variablesFor(parameters, "header", schemaNameMap),
        bodyType: requestBodyType(operation, schemaNameMap),
        responseType: responseType(operation.responses, schemaNameMap)
      });
    }
  }

  return endpoints;
}

function endpointNameForOperation(
  operation: OpenApiOperation,
  operationId: string,
  strategy: EndpointNameStrategy,
  namespace?: string
): string {
  const operationName = ensureIdentifier(operationId, "endpoint");

  if (strategy === "operationId") {
    return operationName;
  }

  const tag = operation.tags?.[0];
  const tagName = tag ? ensureIdentifier(toPascalCase(tag), "endpoint") : undefined;
  const taggedName = !tagName || operationName === tagName || operationName.startsWith(`${tagName}_`)
    ? operationName
    : `${tagName}_${operationName}`;

  if (!namespace || taggedName === namespace || taggedName.startsWith(`${namespace}_`)) {
    return taggedName;
  }

  return `${namespace}_${taggedName}`;
}

function variablesFor(
  parameters: OpenApiParameter[],
  location: OpenApiParameter["in"],
  schemaNameMap: Map<string, string>
): VariableModel[] {
  return parameters
    .filter((parameter) => parameter.in === location)
    .map((parameter) => ({
      name: parameter.name,
      type: schemaToType(rewriteRefs(parameter.schema ?? { type: "string" }, schemaNameMap)),
      required: parameter.required === true || location === "path"
    }));
}

function requestBodyType(operation: OpenApiOperation, schemaNameMap: Map<string, string>): string | null {
  const schema = preferredContentSchema(operation.requestBody?.content);
  return schema ? schemaToType(rewriteRefs(schema, schemaNameMap)) : null;
}

function responseType(
  responses: Record<string, OpenApiResponse> | undefined,
  schemaNameMap: Map<string, string>
): string {
  const response = responses?.["200"] ?? responses?.["201"] ?? responses?.["204"] ?? firstSuccessResponse(responses);
  const schema = preferredContentSchema(response?.content);

  if (!schema || response === responses?.["204"]) {
    return "void";
  }

  return schemaToType(rewriteRefs(schema, schemaNameMap));
}

function firstSuccessResponse(responses: Record<string, OpenApiResponse> | undefined): OpenApiResponse | undefined {
  return Object.entries(responses ?? {}).find(([status]) => status.startsWith("2"))?.[1];
}

function preferredContentSchema(content: OpenApiResponse["content"]): OpenApiSchema | undefined {
  return content?.["application/json"]?.schema ?? Object.values(content ?? {})[0]?.schema;
}

function rewriteRefs<T extends OpenApiSchema | undefined>(schema: T, schemaNameMap: Map<string, string>): T {
  if (!schema) {
    return schema;
  }

  const clone = structuredClone(schema);
  rewriteRefsInPlace(clone, schemaNameMap);
  return clone;
}

function rewriteRefsInPlace(schema: OpenApiSchema, schemaNameMap: Map<string, string>): void {
  if (schema.$ref) {
    const rawName = schema.$ref.split("/").at(-1);
    const mappedName = rawName ? schemaNameMap.get(rawName) : undefined;

    if (mappedName) {
      schema.$ref = `#/components/schemas/${mappedName}`;
    }
  }

  for (const child of [
    ...Object.values(schema.properties ?? {}),
    schema.items,
    ...(schema.allOf ?? []),
    ...(schema.oneOf ?? []),
    ...(schema.anyOf ?? []),
    typeof schema.additionalProperties === "object" ? schema.additionalProperties : undefined
  ]) {
    if (child) {
      rewriteRefsInPlace(child, schemaNameMap);
    }
  }
}

function fallbackOperationId(method: string, path: string): string {
  return `${method}_${path.replace(/[{}]/g, "").replace(/[^A-Za-z0-9]+/g, "_")}`;
}

function isOperation(value: unknown): value is OpenApiOperation {
  return isRecord(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
