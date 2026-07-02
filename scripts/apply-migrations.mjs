import { connectPg, parseArgs, readMigrationSql } from "./migration-utils.mjs";

const args = parseArgs();
const client = await connectPg(args);

try {
  await client.query(await readMigrationSql(args.schema));
  console.log("Applied PostgreSQL migrations.");
} finally {
  await client.end();
}
