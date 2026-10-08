export type ClientKind = "angular" | "react";
export type EndpointNameStrategy = "operationId" | "tagAndOperationId" | "namespaceTagAndOperationId";

export interface EndpointNamespaceConfig {
  /** JSON Pointer to a string in each OpenAPI document. */
  pointer: string;
  /** Optional regex: uses the first capture group, or the full match if none exists. */
  pattern?: string;
}

export interface SwaggerClientConfig {
  client: ClientKind;
  "swaggers-directory": string;
  "endpoint-name-strategy"?: EndpointNameStrategy;
  "endpoint-namespace"?: EndpointNamespaceConfig;
  /** Index of the document server URL to prefix endpoint paths with. */
  serverUrlIndex?: number;
  output: {
    "api-models.ts": string;
    "api-endpoints.ts": string;
    "client.ts": string;
  };
}

export interface ProjectModel {
  schemas: SchemaModel[];
  endpoints: EndpointModel[];
}

export interface SchemaModel {
  name: string;
  schema: OpenApiSchema;
}

export interface EndpointModel {
  name: string;
  method: HttpMethod;
  path: string;
  operationId: string;
  sourceFile: string;
  pathVariables: VariableModel[];
  queryVariables: VariableModel[];
  headerVariables: VariableModel[];
  bodyType: string | null;
  responseType: string;
}

export interface VariableModel {
  name: string;
  type: string;
  required: boolean;
}

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD" | "OPTIONS";

export interface OpenApiDocument {
  openapi?: string;
  swagger?: string;
  servers?: { url: string }[];
  info?: {
    title?: string;
    version?: string;
  };
  paths?: Record<string, Record<string, OpenApiOperation | unknown>>;
  components?: {
    schemas?: Record<string, OpenApiSchema>;
  };
  definitions?: Record<string, OpenApiSchema>;
}

export interface OpenApiOperation {
  operationId?: string;
  tags?: string[];
  parameters?: OpenApiParameter[];
  requestBody?: {
    required?: boolean;
    content?: Record<string, { schema?: OpenApiSchema }>;
  };
  responses?: Record<string, OpenApiResponse>;
}

export interface OpenApiParameter {
  name: string;
  in: "path" | "query" | "header" | "cookie";
  required?: boolean;
  schema?: OpenApiSchema;
}

export interface OpenApiResponse {
  description?: string;
  content?: Record<string, { schema?: OpenApiSchema }>;
}

export interface OpenApiSchema {
  $ref?: string;
  type?: string;
  format?: string;
  enum?: unknown[];
  nullable?: boolean;
  required?: string[];
  properties?: Record<string, OpenApiSchema>;
  items?: OpenApiSchema;
  additionalProperties?: boolean | OpenApiSchema;
  allOf?: OpenApiSchema[];
  oneOf?: OpenApiSchema[];
  anyOf?: OpenApiSchema[];
}
