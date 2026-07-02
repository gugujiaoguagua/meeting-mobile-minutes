import fs from "node:fs/promises";
import path from "node:path";
import { defaultStatePath, normalizeExportPath, parseArgs, timestampSlug } from "./migration-utils.mjs";

const args = parseArgs();
const statePath = args.state ? normalizeExportPath(args.state) : defaultStatePath;
const backupDir = args.outDir ? normalizeExportPath(args.outDir) : path.join(path.dirname(statePath), "backups");
const backupPath = args.out
  ? normalizeExportPath(args.out)
  : path.join(backupDir, `meeting-loop-state-cutover-backup-${timestampSlug()}.json`);

await fs.mkdir(path.dirname(backupPath), { recursive: true });
await fs.copyFile(statePath, backupPath);

const sourceStat = await fs.stat(statePath);
const backupStat = await fs.stat(backupPath);
if (sourceStat.size !== backupStat.size) {
  throw new Error(`Backup size mismatch: source=${sourceStat.size}, backup=${backupStat.size}`);
}

console.log(`Created cutover backup: ${backupPath}`);
console.log(JSON.stringify({ source: statePath, backup: backupPath, bytes: backupStat.size }, null, 2));
