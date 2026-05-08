import { readFileSync, writeFileSync } from "node:fs";
import { type Config, ConfigSchema, ExitCode, KabanError } from "@kaban-board/core";

function validationError(message: string): KabanError {
  return new KabanError(`Invalid config.json: ${message}`, ExitCode.VALIDATION);
}

export function readConfig(configPath: string): Config {
  let parsed: unknown;

  try {
    parsed = JSON.parse(readFileSync(configPath, "utf-8"));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw validationError(message);
  }

  const result = ConfigSchema.safeParse(parsed);
  if (!result.success) {
    throw validationError(result.error.issues[0]?.message ?? "schema validation failed");
  }

  return result.data;
}

export function validateConfig(config: Config): Config {
  const result = ConfigSchema.safeParse(config);
  if (!result.success) {
    throw validationError(result.error.issues[0]?.message ?? "schema validation failed");
  }

  return result.data;
}

export function writeConfig(configPath: string, config: Config): Config {
  const validated = validateConfig(config);

  writeFileSync(configPath, JSON.stringify(validated, null, 2));
  return validated;
}
