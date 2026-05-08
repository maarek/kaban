import { readFileSync, writeFileSync } from "node:fs";
import { type Config, ConfigSchema, ExitCode, KabanError } from "@kaban-board/core";

const DEFAULT_TODOWRITE_MAPPING = {
  inProgress: "in_progress",
  completed: "done",
  cancelled: "backlog",
};

function validationError(message: string): KabanError {
  return new KabanError(`Invalid config.json: ${message}`, ExitCode.VALIDATION);
}

function getDefaultColumn(config: Config): string {
  if (config.columns.some((column) => column.id === config.defaults.column)) {
    return config.defaults.column;
  }

  return (config.columns.find((column) => !column.isTerminal) ?? config.columns[0]).id;
}

function getMappedColumn(
  config: Config,
  mappedColumn: string | undefined,
  fallback: () => string,
): string {
  if (mappedColumn && config.columns.some((column) => column.id === mappedColumn)) {
    return mappedColumn;
  }

  return fallback();
}

function getActiveColumn(config: Config, pendingColumn: string): string {
  const pendingIndex = config.columns.findIndex((column) => column.id === pendingColumn);
  const columnsAfterPending = pendingIndex === -1 ? [] : config.columns.slice(pendingIndex + 1);

  return (
    columnsAfterPending.find((column) => !column.isTerminal) ??
    config.columns.find((column) => column.id === DEFAULT_TODOWRITE_MAPPING.inProgress) ??
    config.columns.find((column) => !column.isTerminal && column.id !== pendingColumn) ??
    config.columns.find((column) => !column.isTerminal) ??
    config.columns[0]
  ).id;
}

function normalizeConfig(config: Config): Config {
  const defaultColumn = getDefaultColumn(config);
  const pending = getMappedColumn(config, config.sync?.todoWrite?.pending, () => defaultColumn);
  const inProgress = getMappedColumn(config, config.sync?.todoWrite?.inProgress, () =>
    getActiveColumn(config, pending),
  );
  const completed = getMappedColumn(
    config,
    config.sync?.todoWrite?.completed,
    () =>
      (
        config.columns.find((column) => column.id === DEFAULT_TODOWRITE_MAPPING.completed) ??
        config.columns.find((column) => column.isTerminal) ??
        config.columns[0]
      ).id,
  );
  const cancelled = getMappedColumn(
    config,
    config.sync?.todoWrite?.cancelled,
    () =>
      (
        config.columns.find((column) => column.id === DEFAULT_TODOWRITE_MAPPING.cancelled) ??
        config.columns.find((column) => column.id === pending) ??
        config.columns[0]
      ).id,
  );

  return {
    ...config,
    defaults: {
      ...config.defaults,
      column: defaultColumn,
    },
    sync: {
      ...config.sync,
      todoWrite: {
        pending,
        inProgress,
        completed,
        cancelled,
      },
    },
  };
}

function shouldWriteNormalizedConfig(config: Config, normalized: Config): boolean {
  return JSON.stringify(config) !== JSON.stringify(normalized);
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

  const normalized = normalizeConfig(result.data);
  if (shouldWriteNormalizedConfig(result.data, normalized)) {
    writeFileSync(configPath, JSON.stringify(normalized, null, 2));
  }

  return normalized;
}

export function validateConfig(config: Config): Config {
  const result = ConfigSchema.safeParse(config);
  if (!result.success) {
    throw validationError(result.error.issues[0]?.message ?? "schema validation failed");
  }

  return normalizeConfig(result.data);
}

export function writeConfig(configPath: string, config: Config): Config {
  const validated = validateConfig(config);

  writeFileSync(configPath, JSON.stringify(validated, null, 2));
  return validated;
}
