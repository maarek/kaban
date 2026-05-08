import type { TodoWriteColumnTarget, TodoWriteColumnTargets } from "../lib/todowrite-mapping.js";
import { COLUMN_TO_STATUS, STATUS_PRIORITY } from "./constants.js";
import type { SyncConfig, TodoItem, TodoStatus } from "./schemas.js";
import type { KabanTask } from "./types.js";

export type ConflictWinner = "todo" | "kaban";

export interface ResolveResult {
  winner: ConflictWinner;
  targetColumn: string;
  reason: string;
}

export interface ResolveContext {
  columns: TodoWriteColumnTarget[];
  targets: TodoWriteColumnTargets;
}

const DEFAULT_RESOLVE_CONTEXT: ResolveContext = {
  columns: [
    { id: "backlog", isTerminal: false },
    { id: "todo", isTerminal: false },
    { id: "in_progress", isTerminal: false },
    { id: "review", isTerminal: false },
    { id: "done", isTerminal: true },
  ],
  targets: {
    pending: "todo",
    in_progress: "in_progress",
    completed: "done",
    cancelled: "backlog",
  },
};

export class ConflictResolver {
  constructor(private strategy: SyncConfig["conflictStrategy"]) {}

  resolve(
    todo: TodoItem,
    kabanTask: KabanTask,
    context: ResolveContext = DEFAULT_RESOLVE_CONTEXT,
  ): ResolveResult {
    const kabanStatus = this.columnToStatus(kabanTask.columnId, context);
    const todoColumn = context.targets[todo.status];
    if (!todoColumn) {
      throw new Error(`No TodoWrite column target configured for status '${todo.status}'`);
    }

    if (this.strategy === "todowrite_wins") {
      return {
        winner: "todo",
        targetColumn: todoColumn,
        reason: "todowrite_wins strategy",
      };
    }

    if (this.strategy === "kaban_wins") {
      return {
        winner: "kaban",
        targetColumn: kabanTask.columnId,
        reason: "kaban_wins strategy",
      };
    }

    if (todo.status === "completed") {
      return {
        winner: "todo",
        targetColumn: todoColumn,
        reason: "completed status always wins (terminal state)",
      };
    }

    if (this.isCompletedColumn(kabanTask.columnId, context)) {
      return {
        winner: "kaban",
        targetColumn: kabanTask.columnId,
        reason: "kaban task already completed (terminal state)",
      };
    }

    const todoPriority = STATUS_PRIORITY[todo.status];
    const kabanPriority = STATUS_PRIORITY[kabanStatus];

    if (todoPriority > kabanPriority) {
      return {
        winner: "todo",
        targetColumn: todoColumn,
        reason: `todo status priority (${todoPriority}) > kaban (${kabanPriority})`,
      };
    }

    if (kabanPriority > todoPriority) {
      return {
        winner: "kaban",
        targetColumn: kabanTask.columnId,
        reason: `kaban status priority (${kabanPriority}) > todo (${todoPriority})`,
      };
    }

    return {
      winner: "todo",
      targetColumn: todoColumn,
      reason: "equal priority, todo wins (most recent)",
    };
  }

  shouldSync(todo: TodoItem, cancelledPolicy: SyncConfig["cancelledPolicy"]): boolean {
    if (todo.status === "cancelled") {
      return cancelledPolicy === "backlog";
    }
    return true;
  }

  private columnToStatus(columnId: string, context: ResolveContext): TodoStatus {
    if (this.isCompletedColumn(columnId, context)) {
      return "completed";
    }
    if (columnId === context.targets.in_progress) {
      return "in_progress";
    }
    if (columnId === context.targets.pending || columnId === context.targets.cancelled) {
      return "pending";
    }

    return COLUMN_TO_STATUS[columnId] ?? "pending";
  }

  private isCompletedColumn(columnId: string, context: ResolveContext): boolean {
    const column = context.columns.find((candidate) => candidate.id === columnId);
    return column?.isTerminal === true || columnId === context.targets.completed;
  }
}
