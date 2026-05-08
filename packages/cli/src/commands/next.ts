import {
  createBlockingScorer,
  dueDateScorer,
  fifoScorer,
  KabanError,
  LinkService,
  priorityScorer,
  ScoringService,
} from "@kaban-board/core";
import { Command } from "commander";
import { getContext } from "../lib/context.js";
import { outputError, outputSuccess } from "../lib/json-output.js";

export const nextCommand = new Command("next")
  .description("Get the next highest-priority task")
  .option("-c, --column <column>", "Column to pick from (default: configured default column)")
  .option("-j, --json", "Output as JSON")
  .action(async (options) => {
    const json = options.json;
    try {
      const { taskService, db, config } = await getContext();
      const linkService = new LinkService(db);

      const scoringService = new ScoringService();
      scoringService.addScorer(priorityScorer);
      scoringService.addScorer(dueDateScorer);
      scoringService.addScorer(
        createBlockingScorer(async (taskId) => {
          const blocking = await linkService.getBlocking(taskId);
          return blocking.length;
        }),
      );
      scoringService.addScorer(fifoScorer);

      const columnId = options.column ?? config.defaults.column;
      const tasks = await taskService.listTasks({ columnId });
      const unblocked = tasks.filter((t) => !t.blockedReason && t.dependsOn.length === 0);

      if (unblocked.length === 0) {
        if (json) {
          outputSuccess({ task: null, message: "No actionable tasks" });
          return;
        }
        console.log("No actionable tasks in", columnId);
        return;
      }

      const ranked = await scoringService.rankTasks(unblocked);
      const next = ranked[0];

      if (json) {
        outputSuccess(next);
        return;
      }

      console.log(`\n  Next: [${next.task.id.slice(0, 8)}] "${next.task.title}"`);
      console.log(
        `  Score: ${next.score} (${Object.entries(next.breakdown)
          .map(([k, v]) => `${k}:${v}`)
          .join(", ")})`,
      );
      if (next.task.dueDate) console.log(`  Due: ${next.task.dueDate.toISOString().split("T")[0]}`);
      console.log();
    } catch (error) {
      if (error instanceof KabanError) {
        if (json) outputError(error.code, error.message);
        console.error(`Error: ${error.message}`);
        process.exit(error.code);
      }
      throw error;
    }
  });
