const RESERVED_WORDS = new Set([
  "break",
  "case",
  "catch",
  "class",
  "const",
  "continue",
  "debugger",
  "default",
  "delete",
  "do",
  "else",
  "export",
  "extends",
  "finally",
  "for",
  "function",
  "if",
  "import",
  "in",
  "instanceof",
  "new",
  "return",
  "super",
  "switch",
  "this",
  "throw",
  "try",
  "typeof",
  "var",
  "void",
  "while",
  "with",
  "yield"
]);

/**
 * Converts a value to a valid PascalCase TypeScript identifier.
 *
 * @param value The value to convert.
 * @returns A PascalCase identifier.
 */
export function toPascalCase(value: string): string {
  const words = value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean);

  const name = words.map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join("");
  return ensureIdentifier(name || "GeneratedType", "GeneratedType");
}

/**
 * Ensures a value is a valid TypeScript identifier.
 *
 * @param value The value to sanitize.
 * @param fallback The prefix to use when the value cannot start an identifier.
 * @returns A valid TypeScript identifier.
 */
export function ensureIdentifier(value: string, fallback: string): string {
  const cleaned = value.replace(/[^A-Za-z0-9_$]/g, "");
  const withStart = /^[A-Za-z_$]/.test(cleaned) ? cleaned : `${fallback}${cleaned}`;
  return RESERVED_WORDS.has(withStart) ? `${withStart}Value` : withStart;
}

/**
 * Returns a name that is unique within a mutable set of used names.
 *
 * @param baseName The preferred name.
 * @param usedNames The set of names already reserved.
 * @returns The unique name that was added to the set.
 */
export function uniqueName(baseName: string, usedNames: Set<string>): string {
  let name = baseName;
  let index = 2;

  while (usedNames.has(name)) {
    name = `${baseName}${index}`;
    index += 1;
  }

  usedNames.add(name);
  return name;
}

/**
 * Serializes a string as a TypeScript string literal.
 *
 * @param value The string value to quote.
 * @returns A quoted string literal.
 */
export function quote(value: string): string {
  return JSON.stringify(value);
}
