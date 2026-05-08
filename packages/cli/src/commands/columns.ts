import { type Column, type Config, ExitCode, KabanError } from "@kaban-board/core";
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

function createConfigColumn(input: AddColumnConfigInput) {
  return {
    id: input.id,
    name: input.name.trim(),
    ...(input.wipLimit === undefined ? {} : { wipLimit: input.wipLimit }),
    ...(input.isTerminal ? { isTerminal: true } : {}),
  };
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

function handleColumnsError(error: unknown, json: boolean | undefined): never {
  if (error instanceof KabanError) {
    if (json) outputError(error.code, error.message);
    console.error(`Error: ${error.message}`);
    process.exit(error.code);
  }
  throw error;
}

const listColumnsCommand = new Command("list")
  .description("List board columns")
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
  .description("Add a board column")
  .argument("<id>", "Stable column ID")
  .argument("<name>", "Column display name")
  .option("--after <column-id>", "Insert after an existing column")
  .option("--before <column-id>", "Insert before an existing column")
  .option("--terminal", "Mark column as terminal")
  .option("--wip-limit <n>", "Set a WIP limit")
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

export const columnsCommand = new Command("columns")
  .description("Manage board columns")
  .addCommand(listColumnsCommand)
  .addCommand(addColumnCommand);
