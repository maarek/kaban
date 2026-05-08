import { and, eq, gte, sql } from "drizzle-orm";
import { ulid } from "ulid";
import { boards, columns } from "../db/schema.js";
import type { DB } from "../db/types.js";
import { type Board, type Column, type Config, ExitCode, KabanError } from "../types.js";
import { validateColumnId } from "../validation.js";

export interface AddColumnInput {
  id: string;
  name: string;
  wipLimit?: number;
  isTerminal?: boolean;
  position?: number;
}

function validateColumnName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) {
    throw new KabanError("Column name cannot be empty", ExitCode.VALIDATION);
  }
  if (trimmed.length > 50) {
    throw new KabanError("Column name cannot exceed 50 characters", ExitCode.VALIDATION);
  }
  return trimmed;
}

function validateColumnPosition(position: number): number {
  if (!Number.isInteger(position) || position < 0) {
    throw new KabanError("Column position must be a non-negative integer", ExitCode.VALIDATION);
  }
  return position;
}

function validateWipLimit(wipLimit: number): number {
  if (!Number.isInteger(wipLimit) || wipLimit <= 0) {
    throw new KabanError("WIP limit must be a positive integer", ExitCode.VALIDATION);
  }
  return wipLimit;
}

export class BoardService {
  constructor(private db: DB) {}

  async initializeBoard(config: Config): Promise<Board> {
    const now = new Date();
    const boardId = ulid();

    await this.db.insert(boards).values({
      id: boardId,
      name: config.board.name,
      createdAt: now,
      updatedAt: now,
    });

    for (let i = 0; i < config.columns.length; i++) {
      const col = config.columns[i];
      await this.db.insert(columns).values({
        id: col.id,
        boardId,
        name: col.name,
        position: i,
        wipLimit: col.wipLimit ?? null,
        isTerminal: col.isTerminal ?? false,
      });
    }

    return {
      id: boardId,
      name: config.board.name,
      maxBoardTaskId: 0,
      createdAt: now,
      updatedAt: now,
    };
  }

  async getBoard(): Promise<Board | null> {
    const rows = await this.db.select().from(boards).limit(1);
    return rows[0] ?? null;
  }

  async getColumns(): Promise<Column[]> {
    return this.db.select().from(columns).orderBy(columns.position);
  }

  async addColumn(input: AddColumnInput): Promise<Column> {
    const id = validateColumnId(input.id);
    const name = validateColumnName(input.name);
    const wipLimit = input.wipLimit === undefined ? undefined : validateWipLimit(input.wipLimit);

    const board = await this.getBoard();
    if (!board) {
      throw new KabanError("No board found", ExitCode.NOT_FOUND);
    }

    const existing = await this.getColumn(id);
    if (existing) {
      throw new KabanError(`Column '${id}' already exists`, ExitCode.CONFLICT);
    }

    const maxPositionResult = await this.db
      .select({ max: sql<number>`COALESCE(MAX(position), -1)` })
      .from(columns)
      .where(eq(columns.boardId, board.id));

    const nextPosition = (maxPositionResult[0]?.max ?? -1) + 1;
    const position =
      input.position === undefined ? nextPosition : validateColumnPosition(input.position);

    if (position > nextPosition) {
      throw new KabanError("Column position cannot leave gaps", ExitCode.VALIDATION);
    }

    if (position < nextPosition) {
      await this.db
        .update(columns)
        .set({ position: sql`${columns.position} + 1` })
        .where(and(eq(columns.boardId, board.id), gte(columns.position, position)));
    }

    await this.db.insert(columns).values({
      id,
      boardId: board.id,
      name,
      position,
      wipLimit: wipLimit ?? null,
      isTerminal: input.isTerminal ?? false,
    });

    const column = await this.getColumn(id);
    if (!column) {
      throw new KabanError(`Column '${id}' was not created`, ExitCode.GENERAL_ERROR);
    }

    return column;
  }

  async getColumn(id: string): Promise<Column | null> {
    const rows = await this.db.select().from(columns).where(eq(columns.id, id));
    return rows[0] ?? null;
  }

  async getTerminalColumn(): Promise<Column | null> {
    const rows = await this.db.select().from(columns).where(eq(columns.isTerminal, true));
    return rows[0] ?? null;
  }

  async getTerminalColumns(): Promise<Column[]> {
    return this.db
      .select()
      .from(columns)
      .where(eq(columns.isTerminal, true))
      .orderBy(columns.position);
  }
}
