import type { OpenApiSchema } from "./types.js";

/**
 * Validates whether equivalent model declarations should be reused.
 *
 * @param value The optional merge setting; omitted values use the default behavior.
 * @param source The configuration source to include in validation errors.
 * @throws When the supplied merge setting is not a boolean.
 */
export function validateMergeDeclarations(value: boolean | undefined, source: string): void {
  if (value !== undefined && typeof value !== "boolean") {
    throw new Error(`${source}: "mergeDeclarations" must be a boolean.`);
  }
}

type Schemas = Record<string, OpenApiSchema>;
const annotations = new Set(["title", "description", "example", "examples", "externalDocs", "$comment"]);

/**
 * Compares schema structures and local references while ignoring documentation annotations.
 *
 * @param left The first schema before reference rewriting or enum extraction.
 * @param right The second schema to compare.
 * @param leftSchemas The document-local schemas used to resolve references from the first schema.
 * @param rightSchemas The document-local schemas used to resolve references from the second schema.
 * @returns Whether both schema graphs have equivalent structures, including circular dependencies.
 */
export function equivalentSchemas(left: OpenApiSchema, right: OpenApiSchema, leftSchemas: Schemas, rightSchemas: Schemas): boolean {
  const visited = new Map<OpenApiSchema, Set<OpenApiSchema>>();

  function compare(a: OpenApiSchema, b: OpenApiSchema): boolean {
    if (visited.get(a)?.has(b)) return true;
    if (!visited.has(a)) visited.set(a, new Set());
    visited.get(a)!.add(b);

    const keys = (schema: OpenApiSchema) => Object.keys(schema).filter(key => !annotations.has(key)).sort();
    if (!equalJson(keys(a), keys(b))) return false;
    for (const key of keys(a)) {
      if (key === "$ref") {
        const leftName = localSchemaName(a.$ref!);
        const rightName = localSchemaName(b.$ref!);
        if (leftName === undefined || rightName === undefined) {
          if (a.$ref !== b.$ref) return false;
        } else {
          if (leftName !== rightName) return false;
          const leftTarget = leftSchemas[leftName];
          const rightTarget = rightSchemas[rightName];
          if (!leftTarget || !rightTarget) {
            if (leftTarget !== rightTarget || a.$ref !== b.$ref) return false;
          } else if (!compare(leftTarget, rightTarget)) return false;
        }
      } else if (key === "properties") {
        const ap = a.properties!;
        const bp = b.properties!;
        if (!equalJson(Object.keys(ap).sort(), Object.keys(bp).sort())) return false;
        for (const name of Object.keys(ap)) {
          if (!compare(ap[name]!, bp[name]!)) return false;
        }
      } else if (key === "items") {
        if (!compare(a.items!, b.items!)) return false;
      } else if (key === "additionalProperties" && typeof a.additionalProperties === "object" && typeof b.additionalProperties === "object") {
        if (!compare(a.additionalProperties, b.additionalProperties)) return false;
      } else if (key === "allOf" || key === "oneOf" || key === "anyOf") {
        const aa = a[key]!;
        const ba = b[key]!;
        if (aa.length !== ba.length || !aa.every((child, index) => compare(child, ba[index]!))) return false;
      } else {
        const av = (a as Record<string, unknown>)[key];
        const bv = (b as Record<string, unknown>)[key];
        if (key === "required" || key === "enum") {
          if (!equalJson(canonicalSet(av), canonicalSet(bv))) return false;
        } else if (!equalJson(av, bv)) return false;
      }
    }
    return true;
  }

  return compare(left, right);
}

function localSchemaName(ref: string): string | undefined {
  const match = /^#\/(?:components\/schemas|definitions)\/([^/]+)$/.exec(ref);
  return match?.[1]?.replace(/~1/g, "/").replace(/~0/g, "~");
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, canonical(child)]));
  }
  return value;
}

function canonicalSet(value: unknown): unknown {
  return Array.isArray(value) ? [...new Set(value.map(child => JSON.stringify(canonical(child))))].sort() : value;
}

function equalJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
}
