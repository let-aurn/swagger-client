/**
 * Validates a declaration prefix before it is applied to generated names.
 *
 * @param prefix The optional literal prefix, which may contain ${namespace}.
 * @param hasNamespace Whether a namespace resolver is configured.
 * @param source The configuration source to include in validation errors.
 * @throws When the prefix produces invalid identifiers, uses unsupported variables, or requires a missing namespace resolver.
 */
export function validateDeclarationPrefix(prefix: string | undefined, hasNamespace: boolean, source: string): void {
  if (prefix === undefined) return;
  if (typeof prefix !== "string") {
    throw new Error(`${source}: "prefix" must be a string.`);
  }
  const literal = prefix.replaceAll("${namespace}", "Namespace");
  if (literal.includes("${")) {
    throw new Error(`${source}: "prefix" supports only the variable "\${namespace}".`);
  }
  if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(`${literal}SomeType`)) {
    throw new Error(`${source}: "prefix" must form a valid TypeScript identifier when prepended to a type name.`);
  }
  if (prefix.includes("${namespace}") && !hasNamespace) {
    throw new Error(`${source}: "prefix" containing "\${namespace}" requires a namespace resolver.`);
  }
}

/**
 * Resolves namespace placeholders in a declaration prefix.
 *
 * @param prefix The optional prefix template.
 * @param namespace The resolved namespace to substitute.
 * @returns The substituted prefix, or an empty string when omitted.
 */
export function resolveDeclarationPrefix(prefix: string | undefined, namespace: string): string {
  return (prefix ?? "").replaceAll("${namespace}", namespace);
}
