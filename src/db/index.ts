import { mkdirSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import * as schema from "./schema";

/** 默认落在项目根目录 data/app.db，可用环境变量覆盖路径 */
const DB_PATH = process.env.DATABASE_PATH ?? "data/app.db";

let instance: BetterSQLite3Database<typeof schema> | null = null;

/** 打开（并按需初始化）数据库连接：进程内单例 */
export function getDb(): BetterSQLite3Database<typeof schema> {
  instance ??= createDb();
  return instance;
}

function createDb(): BetterSQLite3Database<typeof schema> {
  mkdirSync(path.dirname(DB_PATH), { recursive: true });
  const sqlite = new Database(DB_PATH);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema });
  // 幂等：按 journal 记录补齐未执行的迁移，首次运行自动建表
  migrate(db, { migrationsFolder: "drizzle" });
  return db;
}
