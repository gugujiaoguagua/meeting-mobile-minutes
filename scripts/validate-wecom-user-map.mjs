import fs from "node:fs";

const filePath = process.argv[2] || process.env.WECOM_USER_MAP_FILE;

if (!filePath) {
  console.error("Usage: node scripts/validate-wecom-user-map.mjs <map-json-file>");
  process.exit(1);
}

const raw = fs.readFileSync(filePath, "utf8");
const parsed = JSON.parse(raw);

if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
  console.error("WECOM user map must be a JSON object.");
  process.exit(1);
}

const entries = Object.entries(parsed);
const invalid = entries.filter(([key, value]) => !key.trim() || typeof value !== "string" || !value.trim());
if (invalid.length) {
  console.error(`Invalid map entries: ${invalid.length}`);
  process.exit(1);
}

const useridSet = new Set(entries.map(([, value]) => value.trim()));
console.log(JSON.stringify({
  filePath,
  mapEntries: entries.length,
  uniqueWecomUserIds: useridSet.size,
}, null, 2));
