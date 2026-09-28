import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const script = join(root, "scripts/export-kit.mjs");

test("kit exports portable instructions and verifiable provenance without an active workflow or runtime", () => {
  const temp = mkdtempSync(join(tmpdir(), "factory-kit-"));
  try {
    const output = join(temp, "kit");
    execFileSync(process.execPath, [script, output], { cwd: temp });
    const manifest = JSON.parse(readFileSync(join(output, ".factory-kit/manifest.json"), "utf8"));
    assert.equal(manifest.format, 1);
    assert.ok(existsSync(join(output, "START-HERE.md")));
    assert.equal(readdirSync(join(output, ".agents/skills")).length, 6);
    assert.ok(existsSync(join(output, ".factory-kit/examples/github-checks.yml.example")));
    assert.ok(existsSync(join(output, ".factory-kit/VISION.template.md")));
    for (const forbidden of ["AGENTS.md", "package.json", "src", ".factory", ".github/workflows"])
      assert.equal(existsSync(join(output, forbidden)), false, forbidden);
    for (const { path, sha256 } of manifest.files) {
      const bytes = readFileSync(join(output, path));
      assert.equal(createHash("sha256").update(bytes).digest("hex"), sha256, path);
      if (!path.endsWith(".md")) continue;
      const markdown = bytes.toString().replace(/```[\s\S]*?```/g, "");
      for (const [, target] of markdown.matchAll(/\]\(([^\s)]+)\)/g)) {
        if (/^[a-z]+:|^#/i.test(target)) continue;
        const link = resolve(dirname(join(output, path)), target.split("#")[0]);
        assert.ok(existsSync(link), `${path} has broken local reference ${target}`);
      }
    }
    const second = spawnSync(process.execPath, [script, output], { encoding: "utf8" });
    assert.equal(second.status, 1);
    assert.deepEqual(JSON.parse(readFileSync(join(output, ".factory-kit/manifest.json"), "utf8")), manifest);
  } finally { rmSync(temp, { recursive: true, force: true }); }
});

test("export refuses an existing app and leaves its files and instructions intact", () => {
  const app = mkdtempSync(join(tmpdir(), "factory-existing-app-"));
  try {
    writeFileSync(join(app, "AGENTS.md"), "Project-owned instructions\n");
    writeFileSync(join(app, "app.py"), "print('existing app')\n");
    const result = spawnSync(process.execPath, [script, app], { encoding: "utf8" });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Kit export failed/);
    assert.deepEqual(readdirSync(app).sort(), ["AGENTS.md", "app.py"]);
    assert.equal(readFileSync(join(app, "AGENTS.md"), "utf8"), "Project-owned instructions\n");
    assert.equal(readFileSync(join(app, "app.py"), "utf8"), "print('existing app')\n");
  } finally { rmSync(app, { recursive: true, force: true }); }
});

test("a source ZIP inside another repository does not claim that repository's revision", () => {
  const temp = mkdtempSync(join(tmpdir(), "factory-zip-source-"));
  try {
    execFileSync("git", ["init", "-q"], { cwd: temp });
    execFileSync("git", ["-c", "user.name=Factory fixture", "-c", "user.email=fixture@example.invalid", "commit", "--allow-empty", "-qm", "fixture"], { cwd: temp });
    const source = join(temp, "downloaded-source");
    mkdirSync(join(source, "scripts"), { recursive: true });
    cpSync(script, join(source, "scripts/export-kit.mjs"));
    for (const path of ["adlc", ".github/ISSUE_TEMPLATE", "config", "LICENSE"])
      cpSync(join(root, path), join(source, path), { recursive: true });
    const output = join(temp, "export");
    execFileSync(process.execPath, [join(source, "scripts/export-kit.mjs"), output], { cwd: temp });
    const manifest = JSON.parse(readFileSync(join(output, ".factory-kit/manifest.json"), "utf8"));
    assert.equal(manifest.sourceRevision, null);
    assert.equal(manifest.sourceDirty, null);
  } finally { rmSync(temp, { recursive: true, force: true }); }
});
