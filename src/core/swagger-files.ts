import { readdir, stat } from "node:fs/promises";
import { join, posix, resolve } from "node:path";
import { glob, isDynamicPattern } from "tinyglobby";

export function validateSwaggerInput(input: string | string[], source: string): void {
  const patterns = Array.isArray(input) ? input : [input];
  if (patterns.length === 0 || patterns.some(pattern => typeof pattern !== "string" || pattern.trim() === "" || pattern === "!")) {
    throw new Error(`${source}: "swaggers-directory" must be a non-empty directory, glob, or array of patterns.`);
  }
  if (patterns.every(isExclusion)) {
    throw new Error(`${source}: "swaggers-directory" must include at least one positive pattern.`);
  }
}

export function resolveSwaggerInput(input: string | string[]): string | string[] {
  const resolvePattern = (pattern: string): string => {
    const excluded = isExclusion(pattern);
    const path = excluded ? pattern.slice(1) : pattern;
    return (excluded ? "!" : "") + posix.resolve(process.cwd().split("\\").join("/"), path);
  };
  return Array.isArray(input) ? input.map(resolvePattern) : resolvePattern(input);
}

export async function discoverSwaggerFiles(input: string | string[]): Promise<{ files: string[]; sourceDirectory: string }> {
  validateSwaggerInput(input, "OpenAPI input");
  if (typeof input === "string" && !isDynamicPattern(input)) {
    const path = resolve(input);
    if ((await stat(path)).isDirectory()) {
      return { files: await findJsonFiles(path), sourceDirectory: path };
    }
  }

  const matches = await glob(input, {
    absolute: true,
    onlyFiles: true,
    dot: true,
    followSymbolicLinks: false
  });
  const files = [...new Set(matches.filter(file => file.endsWith(".json")))].sort();
  if (files.length === 0) {
    throw new Error(`No OpenAPI JSON files match "swaggers-directory": ${JSON.stringify(input)}.`);
  }
  return { files, sourceDirectory: process.cwd() };
}

function isExclusion(pattern: string): boolean {
  return pattern.startsWith("!") && !pattern.startsWith("!(");
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
