import { ensureIdentifier, toPascalCase, uniqueName } from "./names.js";
import type { EnumStyle, OpenApiSchema, SchemaModel } from "./types.js";

/**
 * Validates the output style used for OpenAPI enums.
 *
 * @param style The optional enum style; omitted values use literal unions.
 * @param source The configuration source to include in validation errors.
 * @throws When the supplied style is neither union nor enum.
 */
export function validateEnumStyle(style: EnumStyle | undefined, source: string): void {
  if (style !== undefined && style !== "union" && style !== "enum") {
    throw new Error(`${source}: "enum-style" must be "union" or "enum".`);
  }
}

function enumValues(schema: OpenApiSchema): (string | number)[] | undefined {
  if (schema.$ref || !schema.enum?.length) return undefined;
  const values = schema.enum.filter((value) => value !== null);
  if (!values.length || !values.every((value) =>
    typeof value === "string" || (typeof value === "number" && Number.isFinite(value)))) {
    return undefined;
  }
  return [...new Set(values)] as (string | number)[];
}

/**
 * Collects model declarations and extracts named enums from nested schemas.
 */
export class EnumCollector {

  /**
   * Creates a collector that shares declaration storage and name reservations.
   *
   * @param schemas The mutable list that receives generated model and enum declarations.
   * @param usedNames The shared set of reserved declaration names.
   * @param style Whether enums remain literal unions or become named declarations.
   * @param declarationName The function that derives enum names from their schema context.
   */
  constructor(
    private readonly schemas: SchemaModel[],
    private readonly usedNames: Set<string>,
    private readonly style: EnumStyle,
    private readonly declarationName: (context: string) => string = toPascalCase
  ) {}

  /**
   * Adds a model declaration and extracts its supported enums when enum output is enabled.
   *
   * @param name The reserved model declaration name.
   * @param schema The schema whose references already use generated names.
   * @param context The base context used to name enums extracted from the model.
   */
  addModel(name: string, schema: OpenApiSchema, context: string = name): void {
    const values = this.style === "enum" ? enumValues(schema) : undefined;
    if (values && !schema.nullable && !schema.enum!.includes(null)) {
      this.schemas.push({ name, schema, enumValues: values });
    } else {
      this.schemas.push({ name, schema: this.normalize(schema, values ? `${context}Value` : context) });
    }
  }

  /**
   * Replaces supported inline enums with references to collected enum declarations.
   *
   * @param schema The schema to normalize recursively.
   * @param context The naming context for enums found in this schema.
   * @returns The original schema in union style, or a normalized schema preserving enum nullability.
   */
  normalize(schema: OpenApiSchema, context: string): OpenApiSchema {
    if (this.style === "union") return schema;
    const values = enumValues(schema);
    if (values) {
      const name = uniqueName(this.declarationName(context), this.usedNames);
      this.schemas.push({ name, schema: { enum: values }, enumValues: values });
      return {
        $ref: `#/components/schemas/${name}`,
        nullable: schema.nullable === true || schema.enum!.includes(null)
      };
    }

    const result = { ...schema };
    if (schema.properties) {
      result.properties = Object.fromEntries(Object.entries(schema.properties).map(([key, child]) =>
        [key, this.normalize(child, `${context}${toPascalCase(key)}`)]));
    }
    if (schema.items) result.items = this.normalize(schema.items, `${context}Item`);
    if (typeof schema.additionalProperties === "object") {
      result.additionalProperties = this.normalize(schema.additionalProperties, `${context}Value`);
    }
    for (const kind of ["allOf", "oneOf", "anyOf"] as const) {
      if (schema[kind]) {
        result[kind] = schema[kind].map((child, index) =>
          this.normalize(child, `${context}${toPascalCase(kind)}${index + 1}`));
      }
    }
    return result;
  }
}

/**
 * Emits a TypeScript enum while preserving its serialized values.
 *
 * @param name The generated enum declaration name.
 * @param values The string or numeric values used to create unique, valid member names.
 * @returns The TypeScript enum declaration source.
 */
export function emitEnum(name: string, values: (string | number)[]): string {
  const usedNames = new Set<string>();
  const members = values.map((value) => {
    const preferred = typeof value === "number" ? `Value_${String(value).replace(/-/g, "Minus_").replace(/\./g, "_")}` : value;
    const identifier = ensureIdentifier(preferred || "Value", "Value");
    // These names conflict with the enum object's prototype or its JS setter.
    const safeIdentifier = identifier === "prototype" || identifier === "__proto__"
      ? `${identifier}Value`
      : identifier;
    const member = uniqueName(safeIdentifier, usedNames);
    return `  ${member} = ${JSON.stringify(value)},`;
  });
  return [`export enum ${name} {`, ...members, "}"].join("\n");
}
