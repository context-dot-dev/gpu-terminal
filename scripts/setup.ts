import { readFileSync } from "node:fs";
import { database } from "../src/lib/db";
const sql = database();
async function main() {
  const statements = readFileSync("scripts/schema.sql", "utf8")
    .split(";")
    .filter((s) => s.trim());
  for (const statement of statements) await sql.query(statement);
  console.log("Database schema ready");
}
main().catch(() => {
  console.error("Database initialization failed");
  process.exitCode = 1;
});
