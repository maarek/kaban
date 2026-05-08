import { KabanError } from "@kaban-board/core";
import { Command } from "commander";
import { getAgent, getContext } from "../lib/context.js";
import { outputError, outputSuccess } from "../lib/json-output.js";

export const addCommand = new Command("add")
  .description("Add a new task")
  .argument("<title>", "Task title")
  .option("-c, --column <column>", "Column to add task to (default: configured default column)")
  .option("-a, --agent <agent>", "Agent creating the task")
  .option("-D, --description <text>", "Task description")
  .option("-d, --depends-on <ids>", "Comma-separated task IDs this depends on")
  .option("-f, --force", "Force creation even if similar tasks exist")
  .option("-j, --json", "Output as JSON")
  .action(async (title, options) => {
    const json = options.json;
    try {
      const { taskService, config } = await getContext();
      const agent = options.agent ?? getAgent();
      const columnId = options.column ?? config.defaults.column;
      const dependsOn = options.dependsOn
        ? options.dependsOn.split(",").map((s: string) => s.trim())
        : [];

      const result = await taskService.addTaskChecked(
        {
          title,
          description: options.description,
          columnId,
          agent,
          dependsOn,
        },
        { force: options.force },
      );

      if (result.rejected) {
        if (json) {
          outputError(409, result.rejectionReason ?? "Similar task exists");
        } else {
          console.error(`Error: ${result.rejectionReason}`);
          console.error("Use --force to create anyway.");
        }
        process.exit(1);
      }

      const task = result.task;
      if (!task) {
        throw new KabanError("Task was not created", 1);
      }

      if (json) {
        outputSuccess(task);
        return;
      }

      console.log(`Created task [${task.id.slice(0, 8)}] "${task.title}"`);
      console.log(`  Column: ${task.columnId}`);
      console.log(`  Agent: ${task.createdBy}`);

      if (result.similarTasks.length > 0) {
        console.log(`  Note: Found ${result.similarTasks.length} similar task(s)`);
      }
    } catch (error) {
      if (error instanceof KabanError) {
        if (json) outputError(error.code, error.message);
        console.error(`Error: ${error.message}`);
        process.exit(error.code);
      }
      throw error;
    }
  });
