import { readFile } from "node:fs/promises";
import { relative } from "node:path";
import type {
  EndpointNameStrategy,
  EndpointNaming,
  ReadOpenApiOptions,
  EnumStyle,
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
import { discoverSwaggerFiles } from "./swagger-files.js";
import { EnumCollector, validateEnumStyle } from "./enums.js";
import { equivalentSchemas, validateMergeDeclarations } from "./merge-declarations.js";
import { resolveDeclarationPrefix, validateDeclarationPrefix } from "./declaration-prefix.js";

const HTTP_METHODS = new Set(["get", "post", "put", "patch", "delete", "head", "options"]);

/**
 * Reads selected OpenAPI documents using grouped generation options.
 *
 * @param swaggerDirectory A directory, file path, or array of include and exclude patterns.
 * @param options The namespace, naming, server, enum, merging, and prefix settings.
 * @returns The normalized schemas and typed endpoint metadata.
 * @throws When options are invalid, files cannot be read or parsed, or namespace or server resolution fails.
 */
export function readOpenApiProject(swaggerDirectory: string | string[], options: ReadOpenApiOptions): Promise<ProjectModel>;

/**
 * Reads selected OpenAPI JSON files and converts them to the generator project model.
 *
 * @param swaggerDirectory A directory, glob, or array of include/exclude glob patterns.
 * @param endpointNameStrategy The strategy used to name generated endpoint constants.
 * @param endpointNamespace Configurable document field and optional namespace extraction regex.
 * @param serverUrlIndex Optional document server URL index to prefix endpoint paths with.
 * @param enumStyle Emit literal unions (default) or named runtime enums.
 * @param mergeDeclarations Reuse equivalent, same-named schemas within each resolved namespace.
 * @returns The normalized schemas and endpoints discovered in the OpenAPI files.
 * @throws When settings are invalid, files cannot be read or parsed, or namespace or server resolution fails.
 */
export function readOpenApiProject(
  swaggerDirectory: string | string[],
  endpointNameStrategy?: EndpointNameStrategy,
  endpointNamespace?: EndpointNamespaceConfig,
  serverUrlIndex?: number,
  enumStyle?: EnumStyle,
  mergeDeclarations?: boolean
): Promise<ProjectModel>;

/**
 * Normalizes grouped or legacy options and reads the selected OpenAPI documents.
 *
 * @param swaggerDirectory The input directory, file path, or include and exclude patterns.
 * @param strategyOrOptions The legacy naming strategy or grouped generation options.
 * @param endpointNamespace The legacy namespace resolver.
 * @param serverUrlIndex The legacy zero-based server index for path prefixes.
 * @param enumStyle The legacy enum output style.
 * @param mergeDeclarations Whether legacy generation reuses equivalent schemas in each namespace.
 * @returns The collected model declarations and endpoint definitions.
 * @throws When configuration is invalid or documents cannot be discovered, parsed, or normalized.
 */
export async function readOpenApiProject(
  swaggerDirectory: string | string[],
  strategyOrOptions: EndpointNameStrategy | ReadOpenApiOptions = "operationId",
  endpointNamespace?: EndpointNamespaceConfig,
  serverUrlIndex?: number,
  enumStyle: EnumStyle = "union",
  mergeDeclarations: boolean = false
): Promise<ProjectModel> {
  const options = typeof strategyOrOptions === "object" ? strategyOrOptions : undefined;
  const endpointNameStrategy = options ? options.naming ?? "operationId" : strategyOrOptions as EndpointNameStrategy;
  if (options) {
    endpointNamespace = options.namespace;
    serverUrlIndex = options.serverIndex;
    enumStyle = options.enumStyle === undefined ? "union" : options.enumStyle;
    mergeDeclarations = options.mergeDeclarations === undefined ? false : options.mergeDeclarations;
    if (!["operationId", "tag_operationId", "namespace_operationId", "namespace_tag_operationId"].includes(endpointNameStrategy)) {
      throw new Error('"naming" must be "operationId", "tag_operationId", "namespace_operationId", or "namespace_tag_operationId".');
    }
    validateDeclarationPrefix(options.prefix, endpointNamespace !== undefined, String(swaggerDirectory));
  }
  validateMergeDeclarations(mergeDeclarations, String(swaggerDirectory));
  validateEnumStyle(enumStyle, String(swaggerDirectory));
  validateServerUrlIndex(serverUrlIndex, String(swaggerDirectory));
  if (usesNamespace(endpointNameStrategy) || (!options && mergeDeclarations) || (options && endpointNamespace !== undefined)) {
    validateEndpointNamespace(endpointNamespace, String(swaggerDirectory));
  }

  const { files, sourceDirectory } = await discoverSwaggerFiles(swaggerDirectory);
  const schemas: SchemaModel[] = [];
  const endpoints: EndpointModel[] = [];
  const usedSchemaNames = new Set<string>();
  const usedEndpointNames = new Set<string>();
  const enums = new EnumCollector(schemas, usedSchemaNames, enumStyle);

  if (mergeDeclarations || options) {
    // Allocate every model name before enum extraction, retaining document-local references.
    const sources = [];
    const scopesByName = new Map<string, Set<string>>();
    for (const file of files) {
      const document = JSON.parse(await readFile(file, "utf8")) as OpenApiDocument;
      const sourceFile = relative(sourceDirectory, file);
      const namespace = endpointNamespace ? extractEndpointNamespace(document, endpointNamespace, sourceFile) : "";
      const sourceSchemas = document.components?.schemas ?? document.definitions ?? {};
      for (const rawName of Object.keys(sourceSchemas)) {
        const baseName = toPascalCase(rawName);
        if (!scopesByName.has(baseName)) scopesByName.set(baseName, new Set());
        scopesByName.get(baseName)!.add(namespace);
      }
      sources.push({ document, sourceFile, namespace, sourceSchemas });
    }
    const documents = [];
    const registry = new Map<string, { name: string; schema: OpenApiSchema; sourceSchemas: Record<string, OpenApiSchema> }[]>();
    for (const { document, sourceFile, namespace, sourceSchemas } of sources) {
      const schemaNameMap = new Map<string, string>();
      const declarations: { name: string; schema: OpenApiSchema; context: string }[] = [];
      for (const [rawName, schema] of Object.entries(sourceSchemas)) {
        const key = JSON.stringify([namespace, rawName]);
        const candidates = registry.get(key) ?? [];
        const existing = mergeDeclarations ? candidates.find(candidate => equivalentSchemas(candidate.schema, schema, candidate.sourceSchemas, sourceSchemas)) : undefined;
        const baseName = toPascalCase(rawName);
        const preferredName = options
          ? `${resolveDeclarationPrefix(options.prefix, namespace)}${baseName}`
          : scopesByName.get(baseName)!.size > 1 ? `${namespace}_${baseName}` : baseName;
        const name = existing?.name ?? uniqueName(preferredName, usedSchemaNames);
        schemaNameMap.set(rawName, name);
        if (!existing) {
          candidates.push({ name, schema, sourceSchemas });
          registry.set(key, candidates);
          declarations.push({ name, schema, context: baseName });
        }
      }
      documents.push({ document, sourceFile, namespace, schemaNameMap, declarations });
    }
    for (const { document, sourceFile, namespace, schemaNameMap, declarations } of documents) {
      const collector = options ? new EnumCollector(schemas, usedSchemaNames, enumStyle,
        context => `${resolveDeclarationPrefix(options.prefix, namespace)}${toPascalCase(context)}`) : enums;
      for (const { name, schema, context } of declarations) {
        collector.addModel(name, rewriteRefs(schema, schemaNameMap), options ? context : name);
      }
      const serverUrl = selectServerUrl(document, serverUrlIndex, sourceFile);
      endpoints.push(...collectEndpoints(document, sourceFile, schemaNameMap, usedEndpointNames, endpointNameStrategy,
        usesNamespace(endpointNameStrategy) ? namespace : undefined, serverUrl, collector));
    }
    return { schemas, endpoints };
  }

  for (const file of files) {
    const document = JSON.parse(await readFile(file, "utf8")) as OpenApiDocument;
    const sourceFile = relative(sourceDirectory, file);
    const serverUrl = selectServerUrl(document, serverUrlIndex, sourceFile);
    const schemaNameMap = collectSchemas(document, enums, usedSchemaNames);

    const namespace = usesNamespace(endpointNameStrategy)
      ? extractEndpointNamespace(document, endpointNamespace!, sourceFile)
      : undefined;
    endpoints.push(...collectEndpoints(document, sourceFile, schemaNameMap, usedEndpointNames, endpointNameStrategy, namespace, serverUrl, enums));
  }

  return { schemas, endpoints };
}

function collectSchemas(
  document: OpenApiDocument,
  enums: EnumCollector,
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

    enums.addModel(generatedName, rewriteRefs(schema, schemaNameMap));
  }

  return schemaNameMap;
}

function collectEndpoints(
  document: OpenApiDocument,
  sourceFile: string,
  schemaNameMap: Map<string, string>,
  usedEndpointNames: Set<string>,
  endpointNameStrategy: EndpointNameStrategy | EndpointNaming,
  namespace: string | undefined,
  serverUrl: string,
  enums: EnumCollector
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
        deprecated: operation.deprecated === true,
        description: typeof operation.description === "string" ? operation.description : undefined,
        pathVariables: variablesFor(parameters, "path", schemaNameMap, enums, endpointName),
        queryVariables: variablesFor(parameters, "query", schemaNameMap, enums, endpointName),
        headerVariables: variablesFor(parameters, "header", schemaNameMap, enums, endpointName),
        bodyType: requestBodyType(operation, schemaNameMap, enums, endpointName),
        responseType: responseType(operation.responses, schemaNameMap, enums, endpointName)
      });
    }
  }

  return endpoints;
}

function endpointNameForOperation(
  operation: OpenApiOperation,
  operationId: string,
  strategy: EndpointNameStrategy | EndpointNaming,
  namespace?: string
): string {
  const operationName = ensureIdentifier(operationId, "endpoint");

  if (strategy === "operationId") {
    return operationName;
  }

  if (strategy === "namespace_operationId") {
    return namespace && operationName !== namespace && !operationName.startsWith(`${namespace}_`) ? `${namespace}_${operationName}` : operationName;
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

function usesNamespace(strategy: EndpointNameStrategy | EndpointNaming): boolean {
  return strategy === "namespaceTagAndOperationId" || strategy === "namespace_operationId" || strategy === "namespace_tag_operationId";
}

function variablesFor(
  parameters: OpenApiParameter[],
  location: OpenApiParameter["in"],
  schemaNameMap: Map<string, string>,
  enums: EnumCollector,
  endpointName: string
): VariableModel[] {
  return parameters
    .filter((parameter) => parameter.in === location)
    .map((parameter) => ({
      name: parameter.name,
      type: schemaToType(enums.normalize(rewriteRefs(parameter.schema ?? { type: "string" }, schemaNameMap), `${toPascalCase(endpointName)}${toPascalCase(location)}${toPascalCase(parameter.name)}`)),
      required: parameter.required === true || location === "path"
    }));
}

function requestBodyType(operation: OpenApiOperation, schemaNameMap: Map<string, string>, enums: EnumCollector, endpointName: string): string | null {
  const schema = preferredContentSchema(operation.requestBody?.content);
  return schema ? schemaToType(enums.normalize(rewriteRefs(schema, schemaNameMap), `${toPascalCase(endpointName)}Body`)) : null;
}

function responseType(
  responses: Record<string, OpenApiResponse> | undefined,
  schemaNameMap: Map<string, string>,
  enums: EnumCollector,
  endpointName: string
): string {
  const response = responses?.["200"] ?? responses?.["201"] ?? responses?.["204"] ?? firstSuccessResponse(responses);
  const schema = preferredContentSchema(response?.content);

  if (!schema || response === responses?.["204"]) {
    return "void";
  }

  return schemaToType(enums.normalize(rewriteRefs(schema, schemaNameMap), `${toPascalCase(endpointName)}Response`));
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
