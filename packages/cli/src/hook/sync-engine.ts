import {
  resolveTodoWriteColumnTargets,
  type TodoWriteColumnTarget,
  type TodoWriteColumnTargets,
} from "../lib/todowrite-mapping.js";
import { ConflictResolver } from "./conflict-resolver.js";
import { KabanClient } from "./kaban-client.js";
import type { SyncConfig, TodoItem } from "./schemas.js";
import type { KabanTask, SyncResult } from "./types.js";

interface SyncContext {
  columns: TodoWriteColumnTarget[];
  targets: TodoWriteColumnTargets;
}

export class SyncEngine {
  private kaban: KabanClient;
  private resolver: ConflictResolver;
  private config: SyncConfig;

  constructor(cwd: string, config: SyncConfig) {
    this.kaban = new KabanClient(cwd);
    this.resolver = new ConflictResolver(config.conflictStrategy);
    this.config = config;
  }

  async sync(todos: TodoItem[]): Promise<SyncResult> {
    const result: SyncResult = {
      success: true,
      created: 0,
      moved: 0,
      skipped: 0,
      errors: [],
    };

    if (!(await this.kaban.boardExists())) {
      result.skipped = todos.length;
      return result;
    }

    if (todos.length === 0) {
      return result;
    }

    const config = this.kaban.getConfig();
    const status = await this.kaban.getStatus();
    if (!config || !status) {
      result.skipped = todos.length;
      return result;
    }

    const context: SyncContext = {
      columns: status.columns,
      targets: resolveTodoWriteColumnTargets(config, status.columns),
    };
    const kabanTasks = await this.kaban.listTasks();
    const tasksByTitle = new Map(kabanTasks.map((t) => [t.title, t]));
    const tasksById = new Map(kabanTasks.map((t) => [t.id, t]));

    for (const todo of todos) {
      if (!this.resolver.shouldSync(todo, this.config.cancelledPolicy)) {
        result.skipped++;
        continue;
      }

      try {
        const syncResult = await this.syncTodo(todo, tasksByTitle, tasksById, context);
        if (syncResult === "created") result.created++;
        else if (syncResult === "moved") result.moved++;
        else result.skipped++;
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        result.errors.push(`${this.truncateTitle(todo.content)}: ${errorMsg}`);
        result.success = false;
      }
    }

    return result;
  }

  private async syncTodo(
    todo: TodoItem,
    tasksByTitle: Map<string, KabanTask>,
    tasksById: Map<string, KabanTask>,
    context: SyncContext,
  ): Promise<"created" | "moved" | "skipped"> {
    const normalizedTitle = this.truncateTitle(todo.content);
    const existing =
      tasksById.get(todo.id) ?? tasksByTitle.get(normalizedTitle) ?? tasksByTitle.get(todo.content);

    if (existing) {
      return this.handleExisting(todo, existing, context);
    }
    return this.handleNew(todo, context);
  }

  private async handleExisting(
    todo: TodoItem,
    existing: KabanTask,
    context: SyncContext,
  ): Promise<"moved" | "skipped"> {
    const resolution = this.resolver.resolve(todo, existing, context);

    if (resolution.winner === "kaban" || existing.columnId === resolution.targetColumn) {
      return "skipped";
    }

    const success = await this.kaban.moveTask(existing.id, resolution.targetColumn);
    if (!success) throw new Error(`failed to move task to ${resolution.targetColumn}`);

    return "moved";
  }

  private async handleNew(todo: TodoItem, context: SyncContext): Promise<"created"> {
    const column = context.targets[todo.status];
    if (!column) {
      throw new Error(`No TodoWrite column target configured for status '${todo.status}'`);
    }

    const title = this.truncateTitle(todo.content);
    const initialColumn = todo.status === "completed" ? context.targets.pending : column;
    if (!initialColumn) {
      throw new Error("No TodoWrite column target configured for new completed task");
    }
    const taskId = await this.kaban.addTask(title, initialColumn);

    if (!taskId) {
      throw new Error("failed to create task");
    }
    if (todo.status === "completed") {
      const success = await this.kaban.moveTask(taskId, column);
      if (!success) throw new Error(`failed to move task to ${column}`);
    }

    return "created";
  }

  private truncateTitle(title: string): string {
    if (title.length <= this.config.maxTitleLength) return title;
    return `${title.slice(0, this.config.maxTitleLength - 3)}...`;
  }
}
