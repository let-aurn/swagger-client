#!/usr/bin/env node
import { resolve } from "node:path";
import { generate } from "../core/generate.js";
import { loadConfig } from "../core/load-config.js";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0];

  if (command !== "generate") {
    printHelp();
    process.exit(command ? 1 : 0);
  }

  const configPath = readConfigPath(args) ?? "swagger-client.json";
  const config = await loadConfig(resolve(configPath));

  await generate(config);

  console.log("Swagger client generated.");
}

function readConfigPath(args: string[]): string | undefined {
  const inline = args.find((arg) => arg.startsWith("--config="));
  if (inline) {
    return inline.slice("--config=".length);
  }

  const index = args.indexOf("--config");
  return index === -1 ? undefined : args[index + 1];
}

function printHelp(): void {
  console.log(`Usage:
  swagger-client generate
  swagger-client generate --config=swagger-client.json`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
