import {
  type Column,
  type Config,
  ExitCode,
  KabanError,
  type UpdateColumnInput,
} from "@kaban-board/core";
import { Command } from "commander";
import { validateConfig, writeConfig } from "../lib/config.js";
import { getContext, getKabanPaths } from "../lib/context.js";
import { outputError, outputSuccess } from "../lib/json-output.js";

interface ColumnOutput {
  id: string;
  name: string;
  taskCount?: number;
  position: number;
  wipLimit: number | null;
  isTerminal: boolean;
}

interface AddColumnOptions {
  after?: string;
  before?: string;
  terminal?: boolean;
  wipLimit?: string;
  json?: boolean;
}

interface MoveColumnOptions {
  after?: string;
  before?: string;
  json?: boolean;
}

interface UpdateColumnOptions {
  wipLimit?: string;
  clearWipLimit?: boolean;
  terminal?: boolean;
  notTerminal?: boolean;
  json?: boolean;
}

interface JsonOptions {
  json?: boolean;
}

interface AddColumnConfigInput {
  id: string;
  name: string;
  wipLimit?: number;
  isTerminal: boolean;
}

type ColumnPlacement =
  | { type: "append" }
  | { type: "before"; targetId: string }
  | { type: "after"; targetId: string };

type RequiredColumnPlacement = Exclude<ColumnPlacement, { type: "append" }>;

function toColumnOutput(column: Column): ColumnOutput {
  return {
    id: column.id,
    name: column.name,
    position: column.position,
    wipLimit: column.wipLimit,
    isTerminal: column.isTerminal,
  };
}

function formatColumnsTable(columns: Required<ColumnOutput>[]): string {
  const headers = ["ID", "Name", "Tasks", "Position", "WIP Limit", "Terminal"];
  const alignRight = new Set([2, 3, 4]);
  const rows = columns.map((column) => [
    column.id,
    column.name,
    String(column.taskCount),
    String(column.position),
    column.wipLimit === null ? "-" : String(column.wipLimit),
    column.isTerminal ? "yes" : "no",
  ]);
  const widths = headers.map((header, index) =>
    Math.max(header.length, ...rows.map((row) => row[index].length)),
  );

  const formatRow = (row: string[]) =>
    row
      .map((cell, index) => {
        if (index === row.length - 1) {
          return cell;
        }
        return alignRight.has(index) ? cell.padStart(widths[index]) : cell.padEnd(widths[index]);
      })
      .join("  ");

  return [
    formatRow(headers),
    widths.map((width) => "-".repeat(width)).join("  "),
    ...rows.map(formatRow),
  ].join("\n");
}

function parseWipLimit(value: string | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new KabanError("WIP limit must be a positive integer", ExitCode.VALIDATION);
  }

  return parsed;
}

function parsePlacement(options: AddColumnOptions): ColumnPlacement {
  if (options.before && options.after) {
    throw new KabanError("Use only one of --before or --after", ExitCode.VALIDATION);
  }
  if (options.before) {
    return { type: "before", targetId: options.before };
  }
  if (options.after) {
    return { type: "after", targetId: options.after };
  }
  return { type: "append" };
}

function parseRequiredPlacement(options: MoveColumnOptions): RequiredColumnPlacement {
  const placement = parsePlacement(options);
  if (placement.type === "append") {
    throw new KabanError("Use --before or --after", ExitCode.VALIDATION);
  }
  return placement;
}

function getPlacementPosition(columns: Column[], placement: ColumnPlacement): number | undefined {
  if (placement.type === "append") {
    return undefined;
  }

  const target = columns.find((column) => column.id === placement.targetId);
  if (!target) {
    throw new KabanError(`Column '${placement.targetId}' does not exist`, ExitCode.VALIDATION);
  }

  return placement.type === "before" ? target.position : target.position + 1;
}

function getMovePosition(
  columns: Column[],
  id: string,
  placement: RequiredColumnPlacement,
): number {
  const sourceIndex = columns.findIndex((column) => column.id === id);
  if (sourceIndex === -1) {
    throw new KabanError(`Column '${id}' does not exist`, ExitCode.VALIDATION);
  }

  const targetIndex = columns.findIndex((column) => column.id === placement.targetId);
  if (targetIndex === -1) {
    throw new KabanError(`Column '${placement.targetId}' does not exist`, ExitCode.VALIDATION);
  }
  if (sourceIndex === targetIndex) {
    throw new KabanError("Cannot move a column relative to itself", ExitCode.VALIDATION);
  }

  const insertIndex = placement.type === "before" ? targetIndex : targetIndex + 1;
  return sourceIndex < insertIndex ? insertIndex - 1 : insertIndex;
}

function createConfigColumn(input: AddColumnConfigInput) {
  return {
    id: input.id,
    name: input.name.trim(),
    ...(input.wipLimit === undefined ? {} : { wipLimit: input.wipLimit }),
    ...(input.isTerminal ? { isTerminal: true } : {}),
  };
}

function getConfigColumnIndex(config: Config, id: string): number {
  const index = config.columns.findIndex((column) => column.id === id);
  if (index === -1) {
    throw new KabanError(`Column '${id}' does not exist in config.json`, ExitCode.VALIDATION);
  }
  return index;
}

function buildConfigWithColumn(
  config: Config,
  input: AddColumnConfigInput,
  placement: ColumnPlacement,
): Config {
  if (config.columns.some((column) => column.id === input.id)) {
    throw new KabanError(`Column '${input.id}' already exists`, ExitCode.CONFLICT);
  }

  const configColumn = createConfigColumn(input);
  const columns = [...config.columns];
  const targetIndex =
    placement.type === "append"
      ? columns.length
      : columns.findIndex((column) => column.id === placement.targetId);

  if (targetIndex === -1) {
    throw new KabanError(
      `Column '${placement.type === "append" ? input.id : placement.targetId}' does not exist in config.json`,
      ExitCode.VALIDATION,
    );
  }

  const insertIndex = placement.type === "after" ? targetIndex + 1 : targetIndex;
  columns.splice(insertIndex, 0, configColumn);

  return validateConfig({
    ...config,
    columns,
  });
}

function renameConfigColumn(config: Config, id: string, name: string): Config {
  const index = getConfigColumnIndex(config, id);
  const columns = [...config.columns];
  columns[index] = {
    ...columns[index],
    name: name.trim(),
  };

  return validateConfig({ ...config, columns });
}

function moveConfigColumn(config: Config, id: string, placement: RequiredColumnPlacement): Config {
  const columns = [...config.columns];
  const sourceIndex = getConfigColumnIndex(config, id);
  const targetIndex = getConfigColumnIndex(config, placement.targetId);
  if (sourceIndex === targetIndex) {
    throw new KabanError("Cannot move a column relative to itself", ExitCode.VALIDATION);
  }

  const [column] = columns.splice(sourceIndex, 1);
  const adjustedTargetIndex = columns.findIndex((candidate) => candidate.id === placement.targetId);
  const insertIndex = placement.type === "before" ? adjustedTargetIndex : adjustedTargetIndex + 1;
  columns.splice(insertIndex, 0, column);

  return validateConfig({ ...config, columns });
}

function parseColumnUpdate(options: UpdateColumnOptions): UpdateColumnInput {
  if (options.wipLimit !== undefined && options.clearWipLimit) {
    throw new KabanError("Use only one of --wip-limit or --clear-wip-limit", ExitCode.VALIDATION);
  }
  if (options.terminal && options.notTerminal) {
    throw new KabanError("Use only one of --terminal or --not-terminal", ExitCode.VALIDATION);
  }

  const update: UpdateColumnInput = {};
  if (options.wipLimit !== undefined) {
    update.wipLimit = parseWipLimit(options.wipLimit);
  }
  if (options.clearWipLimit) {
    update.wipLimit = null;
  }
  if (options.terminal) {
    update.isTerminal = true;
  }
  if (options.notTerminal) {
    update.isTerminal = false;
  }

  if (Object.keys(update).length === 0) {
    throw new KabanError("No column updates specified", ExitCode.VALIDATION);
  }

  return update;
}

function updateConfigColumn(config: Config, id: string, update: UpdateColumnInput): Config {
  const index = getConfigColumnIndex(config, id);
  const columns = [...config.columns];
  const column = { ...columns[index] };

  if (update.name !== undefined) {
    column.name = update.name.trim();
  }
  if (update.wipLimit !== undefined) {
    if (update.wipLimit === null) {
      delete column.wipLimit;
    } else {
      column.wipLimit = update.wipLimit;
    }
  }
  if (update.isTerminal !== undefined) {
    if (update.isTerminal) {
      column.isTerminal = true;
    } else {
      delete column.isTerminal;
    }
  }

  columns[index] = column;
  return validateConfig({ ...config, columns });
}

function deleteConfigColumn(config: Config, id: string): Config {
  const index = getConfigColumnIndex(config, id);
  const column = config.columns[index];
  const terminalCount = config.columns.filter((candidate) => candidate.isTerminal).length;
  if (column.isTerminal && terminalCount <= 1) {
    throw new KabanError("Cannot delete the only terminal column", ExitCode.VALIDATION);
  }

  const columns = config.columns.filter((candidate) => candidate.id !== id);
  const defaults =
    config.defaults.column === id
      ? {
          ...config.defaults,
          column: (columns.find((candidate) => !candidate.isTerminal) ?? columns[0]).id,
        }
      : config.defaults;

  return validateConfig({ ...config, columns, defaults });
}

function handleColumnsError(error: unknown, json: boolean | undefined): never {
  if (error instanceof KabanError) {
    if (json) outputError(error.code, error.message);
    console.error(`Error: ${error.message}`);
    process.exit(error.code);
  }
  throw error;
}

const listColumnsCommand = new Command("list")
  .description("List board columns with task counts")
  .option("-j, --json", "Output as JSON")
  .action(async (options) => {
    const json = options.json;
    try {
      const { boardService, taskService } = await getContext();
      const tasks = await taskService.listTasks();
      const taskCounts = new Map<string, number>();
      for (const task of tasks) {
        taskCounts.set(task.columnId, (taskCounts.get(task.columnId) ?? 0) + 1);
      }
      const columns = (await boardService.getColumns()).map((column) => ({
        ...toColumnOutput(column),
        taskCount: taskCounts.get(column.id) ?? 0,
      }));

      if (json) {
        outputSuccess(columns);
        return;
      }

      console.log(formatColumnsTable(columns));
    } catch (error) {
      handleColumnsError(error, json);
    }
  });

const addColumnCommand = new Command("add")
  .description("Add a board column and sync config")
  .argument("<id>", "Stable column ID used by tasks and commands")
  .argument("<name>", "Column display name")
  .option("--after <column-id>", "Insert after this existing column")
  .option("--before <column-id>", "Insert before this existing column")
  .option("--terminal", "Mark tasks in this column as complete")
  .option("--wip-limit <n>", "Set a positive WIP limit")
  .option("-j, --json", "Output as JSON")
  .action(async (id: string, name: string, options: AddColumnOptions) => {
    const json = options.json;
    try {
      const { boardService, config } = await getContext();
      const { configPath } = getKabanPaths();
      const wipLimit = parseWipLimit(options.wipLimit);
      const isTerminal = options.terminal ?? false;
      const placement = parsePlacement(options);
      const currentColumns = await boardService.getColumns();
      const position = getPlacementPosition(currentColumns, placement);
      const nextConfig = buildConfigWithColumn(
        config,
        { id, name, wipLimit, isTerminal },
        placement,
      );
      const configColumn = nextConfig.columns.find((column) => column.id === id);
      if (!configColumn) {
        throw new KabanError(`Column '${id}' was not added to config.json`, ExitCode.GENERAL_ERROR);
      }
      const column = await boardService.addColumn({
        id: configColumn.id,
        name: configColumn.name,
        wipLimit: configColumn.wipLimit,
        isTerminal: configColumn.isTerminal ?? false,
        position,
      });

      writeConfig(configPath, nextConfig);

      const output = toColumnOutput(column);
      if (json) {
        outputSuccess(output);
        return;
      }

      console.log(`Added column "${output.name}" (${output.id})`);
      console.log(`  Position: ${output.position}`);
      console.log(`  WIP limit: ${output.wipLimit ?? "none"}`);
      console.log(`  Terminal: ${output.isTerminal ? "yes" : "no"}`);
    } catch (error) {
      handleColumnsError(error, json);
    }
  });

const renameColumnCommand = new Command("rename")
  .description("Rename a column display name")
  .argument("<id>", "Column ID to keep unchanged")
  .argument("<name>", "New display name")
  .option("-j, --json", "Output as JSON")
  .action(async (id: string, name: string, options: JsonOptions) => {
    const json = options.json;
    try {
      const { boardService, config } = await getContext();
      const { configPath } = getKabanPaths();
      const nextConfig = renameConfigColumn(config, id, name);
      const configColumn = nextConfig.columns.find((column) => column.id === id);
      if (!configColumn) {
        throw new KabanError(
          `Column '${id}' was not renamed in config.json`,
          ExitCode.GENERAL_ERROR,
        );
      }
      const column = await boardService.renameColumn(id, configColumn.name);

      writeConfig(configPath, nextConfig);

      const output = toColumnOutput(column);
      if (json) {
        outputSuccess(output);
        return;
      }

      console.log(`Renamed column "${id}" to "${output.name}"`);
    } catch (error) {
      handleColumnsError(error, json);
    }
  });

const moveColumnCommand = new Command("move")
  .description("Move a board column before or after another column")
  .argument("<id>", "Column ID to move")
  .option("--after <column-id>", "Move after this existing column")
  .option("--before <column-id>", "Move before this existing column")
  .option("-j, --json", "Output as JSON")
  .action(async (id: string, options: MoveColumnOptions) => {
    const json = options.json;
    try {
      const { boardService, config } = await getContext();
      const { configPath } = getKabanPaths();
      const placement = parseRequiredPlacement(options);
      const currentColumns = await boardService.getColumns();
      const position = getMovePosition(currentColumns, id, placement);
      const nextConfig = moveConfigColumn(config, id, placement);
      const column = await boardService.moveColumn(id, position);

      writeConfig(configPath, nextConfig);

      const output = toColumnOutput(column);
      if (json) {
        outputSuccess(output);
        return;
      }

      console.log(`Moved column "${output.id}" to position ${output.position}`);
    } catch (error) {
      handleColumnsError(error, json);
    }
  });

const updateColumnCommand = new Command("update")
  .description("Update WIP limit or terminal status")
  .argument("<id>", "Column ID")
  .option("--wip-limit <n>", "Set a positive WIP limit")
  .option("--clear-wip-limit", "Remove the WIP limit")
  .option("--terminal", "Mark tasks in this column as complete")
  .option("--not-terminal", "Mark tasks in this column as incomplete")
  .option("-j, --json", "Output as JSON")
  .action(async (id: string, options: UpdateColumnOptions) => {
    const json = options.json;
    try {
      const { boardService, config } = await getContext();
      const { configPath } = getKabanPaths();
      const update = parseColumnUpdate(options);
      const nextConfig = updateConfigColumn(config, id, update);
      const column = await boardService.updateColumn(id, update);

      writeConfig(configPath, nextConfig);

      const output = toColumnOutput(column);
      if (json) {
        outputSuccess(output);
        return;
      }

      console.log(`Updated column "${output.id}"`);
      console.log(`  WIP limit: ${output.wipLimit ?? "none"}`);
      console.log(`  Terminal: ${output.isTerminal ? "yes" : "no"}`);
    } catch (error) {
      handleColumnsError(error, json);
    }
  });

const deleteColumnCommand = new Command("delete")
  .description("Delete an empty board column and choose a new default if needed")
  .argument("<id>", "Column ID to delete")
  .option("-j, --json", "Output as JSON")
  .action(async (id: string, options: JsonOptions) => {
    const json = options.json;
    try {
      const { boardService, config } = await getContext();
      const { configPath } = getKabanPaths();
      const nextConfig = deleteConfigColumn(config, id);

      await boardService.deleteColumn(id);
      writeConfig(configPath, nextConfig);

      const output = { id, deleted: true };
      if (json) {
        outputSuccess(output);
        return;
      }

      console.log(`Deleted column "${id}"`);
    } catch (error) {
      handleColumnsError(error, json);
    }
  });

export const columnsCommand = new Command("columns")
  .description("Manage board columns and config sync")
  .addCommand(listColumnsCommand)
  .addCommand(addColumnCommand)
  .addCommand(renameColumnCommand)
  .addCommand(moveColumnCommand)
  .addCommand(updateColumnCommand)
  .addCommand(deleteColumnCommand);
