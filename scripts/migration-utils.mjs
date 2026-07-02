import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const defaultStatePath = path.join(projectRoot, ".local-data", "meeting-loop-state.json");
export const defaultExportDir = path.join(projectRoot, ".local-data", "exports");
export const defaultMigrationDir = path.join(projectRoot, "database", "migrations");
export const defaultSchemaPath = path.join(projectRoot, "database", "migrations", "001_postgres_initial_schema.sql");

export function parseArgs(argv = process.argv.slice(2)) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (!item.startsWith("--")) continue;
    const key = item.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      args[key] = true;
    } else {
      args[key] = next;
      index += 1;
    }
  }
  return args;
}

export async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

export async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export function unique(values) {
  return [...new Set(values.filter((value) => value !== undefined && value !== null && value !== ""))];
}

export function toArray(value) {
  return Array.isArray(value) ? value : [];
}

export function toJson(value, fallback = []) {
  return value === undefined || value === null ? fallback : value;
}

export function toPgTimestamp(value) {
  if (!value || typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return `${trimmed}T00:00:00+08:00`;
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(trimmed)) return `${trimmed.replace(" ", "T")}:00+08:00`;
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(trimmed)) return `${trimmed.replace(" ", "T")}+08:00`;
  return trimmed;
}

export function toPgDate(value) {
  if (!value || typeof value !== "string") return null;
  const match = value.match(/\d{4}-\d{2}-\d{2}/);
  return match ? match[0] : null;
}

export function timestampSlug(date = new Date()) {
  const pad = (value) => String(value).padStart(2, "0");
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    "-",
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds())
  ].join("");
}

export function hasId(set, id) {
  return Boolean(id && set.has(id));
}

export async function loadPg() {
  try {
    return await import("pg");
  } catch (error) {
    throw new Error("Missing dependency 'pg'. Run: corepack pnpm add pg");
  }
}

export function getDatabaseUrl(args) {
  return args["database-url"] || process.env.DATABASE_URL || process.env.POSTGRES_URL;
}

export async function connectPg(args) {
  const connectionString = getDatabaseUrl(args);
  if (!connectionString) {
    throw new Error("DATABASE_URL is required. Example: $env:DATABASE_URL='postgres://user:pass@localhost:5432/meeting_loop'");
  }
  const pg = await loadPg();
  const client = new pg.Client({ connectionString });
  await client.connect();
  return client;
}

export function normalizeExportPath(input) {
  return path.resolve(projectRoot, input);
}

export async function readMigrationSql(inputPath) {
  const targetPath = inputPath ? normalizeExportPath(inputPath) : defaultMigrationDir;
  const stat = await fs.stat(targetPath);
  if (stat.isFile()) return fs.readFile(targetPath, "utf8");

  const entries = await fs.readdir(targetPath, { withFileTypes: true });
  const migrationFiles = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".sql"))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));
  const chunks = [];
  for (const fileName of migrationFiles) {
    chunks.push(`-- migration: ${fileName}\n${await fs.readFile(path.join(targetPath, fileName), "utf8")}`);
  }
  return chunks.join("\n\n");
}
