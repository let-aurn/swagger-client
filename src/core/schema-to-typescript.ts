import type { OpenApiSchema } from "./types.js";
import { quote, toPascalCase } from "./names.js";

/**
 * Converts an OpenAPI schema to a TypeScript type expression.
 *
 * @param schema The OpenAPI schema to convert.
 * @param fallback The type to use when the schema cannot be inferred.
 * @returns A TypeScript type expression.
 */
export function schemaToType(schema: OpenApiSchema | undefined, fallback = "unknown"): string {
  if (!schema) {
    return fallback;
  }

  let type = schemaToNonNullableType(schema, fallback);

  if (schema.nullable) {
    type = `${type} | null`;
  }

  return type;
}

/**
 * Emits a TypeScript declaration for a named OpenAPI schema.
 *
 * @param name The TypeScript declaration name.
 * @param schema The OpenAPI schema to emit.
 * @returns A TypeScript interface or type alias declaration.
 */
export function emitSchemaInterface(name: string, schema: OpenApiSchema): string {
  if (schema.type === "object" || schema.properties || schema.additionalProperties) {
    return emitObjectInterface(name, schema);
  }

  return `export type ${name} = ${schemaToType(schema)};`;
}

function emitObjectInterface(name: string, schema: OpenApiSchema): string {
  const required = new Set(schema.required ?? []);
  const lines = [`export interface ${name} {`];

  for (const [propertyName, propertySchema] of Object.entries(schema.properties ?? {})) {
    const optional = required.has(propertyName) ? "" : "?";
    lines.push(`  ${propertyKey(propertyName)}${optional}: ${schemaToType(propertySchema)};`);
  }

  if (schema.additionalProperties && typeof schema.additionalProperties === "object") {
    lines.push(`  [key: string]: ${schemaToType(schema.additionalProperties)};`);
  } else if (schema.additionalProperties === true) {
    lines.push("  [key: string]: unknown;");
  }

  lines.push("}");
  return lines.join("\n");
}

function schemaToNonNullableType(schema: OpenApiSchema, fallback: string): string {
  if (schema.$ref) {
    return toPascalCase(schema.$ref.split("/").at(-1) ?? fallback);
  }

  if (schema.enum) {
    return schema.enum.map((value) => JSON.stringify(value)).join(" | ") || fallback;
  }

  if (schema.allOf) {
    return schema.allOf.map((item) => schemaToType(item, fallback)).join(" & ") || fallback;
  }

  if (schema.oneOf || schema.anyOf) {
    return (schema.oneOf ?? schema.anyOf ?? []).map((item) => schemaToType(item, fallback)).join(" | ") || fallback;
  }

  if (schema.type === "array") {
    return `${schemaToType(schema.items, "unknown")}[]`;
  }

  if (schema.type === "object" || schema.properties) {
    const entries = Object.entries(schema.properties ?? {});
    if (entries.length === 0) {
      if (schema.additionalProperties && typeof schema.additionalProperties === "object") {
        return `Record<string, ${schemaToType(schema.additionalProperties)}>`;
      }

      return "Record<string, unknown>";
    }

    const required = new Set(schema.required ?? []);
    const props = entries.map(([name, propSchema]) => {
      const optional = required.has(name) ? "" : "?";
      return `${propertyKey(name)}${optional}: ${schemaToType(propSchema)}`;
    });

    return `{ ${props.join("; ")} }`;
  }

  if (schema.type === "integer" || schema.type === "number") {
    return "number";
  }

  if (schema.type === "boolean") {
    return "boolean";
  }

  if (schema.type === "string") {
    return "string";
  }

  return fallback;
}

function propertyKey(name: string): string {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name) ? name : quote(name);
}
