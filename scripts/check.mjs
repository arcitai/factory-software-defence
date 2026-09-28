import { readdirSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
function walk(path) {
  return readdirSync(path, { withFileTypes: true }).flatMap((f) =>
    f.isDirectory() ? (f.name === "node_modules" ? [] : walk(join(path, f.name))) : [join(path, f.name)],
  );
}
for (const file of ["scripts", "tests", "factory", "bin"]
  .flatMap(walk)
  .filter((f) => f.endsWith(".mjs")))
  execFileSync(process.execPath, ["--check", file], { stdio: "pipe" });
for (const file of ["adlc", "factory"]
  .flatMap(walk)
  .filter((f) => f.endsWith(".json")))
  JSON.parse(readFileSync(file, "utf8"));
console.log("JavaScript syntax and JSON files valid.");
