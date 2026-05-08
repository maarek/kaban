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
  terminal?: boolean;
  wipLimit?: string;
  json?: boolean;
}

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

function buildConfigWithColumn(
  config: Config,
  input: {
    id: string;
    name: string;
    wipLimit?: number;
    isTerminal: boolean;
  },
): Config {
  if (config.columns.some((column) => column.id === input.id)) {
    throw new KabanError(`Column '${input.id}' already exists`, ExitCode.CONFLICT);
  }

  return validateConfig({
    ...config,
    columns: [
      ...config.columns,
      {
        id: input.id,
        name: input.name.trim(),
        ...(input.wipLimit === undefined ? {} : { wipLimit: input.wipLimit }),
        ...(input.isTerminal ? { isTerminal: true } : {}),
      },
    ],
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
      const nextConfig = buildConfigWithColumn(config, { id, name, wipLimit, isTerminal });
      const configColumn = nextConfig.columns[nextConfig.columns.length - 1];
      const column = await boardService.addColumn({
        id: configColumn.id,
        name: configColumn.name,
        wipLimit: configColumn.wipLimit,
        isTerminal: configColumn.isTerminal ?? false,
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
