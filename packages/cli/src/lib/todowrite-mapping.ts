import type { Column, Config } from "@kaban-board/core";

export type TodoWriteStatus = "pending" | "in_progress" | "completed" | "cancelled";

export interface TodoWriteColumnMapping {
  pending: string;
  inProgress: string;
  completed: string;
  cancelled: string;
}

export interface TodoWriteColumnTarget {
  id: string;
  isTerminal: boolean;
  position?: number;
}

export type TodoWriteColumnTargets = Record<TodoWriteStatus, string | null>;

export function getTodoWriteColumnMapping(config: Config): TodoWriteColumnMapping {
  return {
    pending: config.sync?.todoWrite?.pending ?? config.defaults.column,
    inProgress: config.sync?.todoWrite?.inProgress ?? "in_progress",
    completed: config.sync?.todoWrite?.completed ?? "done",
    cancelled: config.sync?.todoWrite?.cancelled ?? "backlog",
  };
}

export function getTodoWriteColumnRoles(
  config: Config,
  columnId: string,
  targets?: TodoWriteColumnTargets,
): string[] {
  const mapping = getTodoWriteColumnMapping(config);
  const resolvedTargets = targets ?? {
    pending: mapping.pending,
    in_progress: mapping.inProgress,
    completed: mapping.completed,
    cancelled: mapping.cancelled,
  };
  const roles: string[] = [];

  if (config.defaults.column === columnId) {
    roles.push("Default");
  }
  if (resolvedTargets.pending === columnId) {
    roles.push("TodoWrite pending");
  }
  if (resolvedTargets.in_progress === columnId) {
    roles.push("TodoWrite in_progress");
  }
  if (resolvedTargets.completed === columnId) {
    roles.push("TodoWrite completed");
  }
  if (resolvedTargets.cancelled === columnId) {
    roles.push("TodoWrite cancelled");
  }

  return roles;
}

function findActiveFallback(
  columns: TodoWriteColumnTarget[],
  pending: string | null,
): TodoWriteColumnTarget | null {
  const pendingIndex = pending ? columns.findIndex((column) => column.id === pending) : -1;
  const columnsAfterPending = pendingIndex === -1 ? [] : columns.slice(pendingIndex + 1);

  return (
    columnsAfterPending.find((column) => !column.isTerminal) ??
    columns.find((column) => !column.isTerminal && column.id !== pending) ??
    columns.find((column) => !column.isTerminal) ??
    columns[0] ??
    null
  );
}

export function resolveTodoWriteColumnTargets(
  config: Config,
  columns: TodoWriteColumnTarget[],
): TodoWriteColumnTargets {
  const mapping = getTodoWriteColumnMapping(config);
  const byId = new Map(columns.map((column) => [column.id, column]));
  const nonTerminalColumns = columns.filter((column) => !column.isTerminal);
  const terminalColumns = columns.filter((column) => column.isTerminal);
  const defaultColumn =
    byId.get(config.defaults.column) ?? nonTerminalColumns[0] ?? columns[0] ?? null;

  const pending = byId.get(mapping.pending)?.id ?? defaultColumn?.id ?? null;
  const inProgress =
    byId.get(mapping.inProgress)?.id ??
    byId.get("in_progress")?.id ??
    findActiveFallback(columns, pending)?.id ??
    pending;
  const completed =
    byId.get(mapping.completed)?.id ?? byId.get("done")?.id ?? terminalColumns[0]?.id ?? null;
  const cancelled =
    byId.get(mapping.cancelled)?.id ??
    byId.get("backlog")?.id ??
    pending ??
    defaultColumn?.id ??
    null;

  return {
    pending,
    in_progress: inProgress,
    completed,
    cancelled,
  };
}

export function formatTodoWriteRoles(config: Config, column: Pick<Column, "id">): string {
  const roles = getTodoWriteColumnRoles(config, column.id);
  return roles.length === 0 ? "-" : roles.join(", ");
}
