import { existsSync, mkdirSync } from "node:fs";
import {
  BoardService,
  type Config,
  createDb,
  DEFAULT_CONFIG,
  initializeSchema,
} from "@kaban-board/core";
import { Command } from "commander";
import { readConfig, writeConfig } from "../lib/config.js";
import { getKabanPaths } from "../lib/context.js";

export const initCommand = new Command("init")
  .description("Initialize a new Kaban board in the current directory")
  .option("-n, --name <name>", "Board name", "Kaban Board")
  .action(async (options) => {
    const { kabanDir, dbPath, configPath } = getKabanPaths();

    if (existsSync(dbPath)) {
      console.error("Error: Board already exists in this directory");
      process.exit(1);
    }

    mkdirSync(kabanDir, { recursive: true });

    const rawArgs = process.argv.slice(2);
    const nameOverrideProvided = rawArgs.some(
      (arg) => arg === "--name" || arg === "-n" || arg.startsWith("--name="),
    );

    let config: Config;

    if (existsSync(configPath)) {
      const parsed = readConfig(configPath);
      config = {
        ...parsed,
        board: {
          ...parsed.board,
          name: nameOverrideProvided ? options.name : parsed.board.name,
        },
      };
    } else {
      config = {
        ...DEFAULT_CONFIG,
        board: { name: options.name },
      };
    }

    writeConfig(configPath, config);

    const db = await createDb(dbPath);
    await initializeSchema(db);
    const boardService = new BoardService(db);
    await boardService.initializeBoard(config);

    console.log(`Initialized Kaban board: ${config.board.name}`);
    console.log(`  Database: ${dbPath}`);
    console.log(`  Config: ${configPath}`);
  });
