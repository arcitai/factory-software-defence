import { mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";

const root = fileURLToPath(new URL("../", import.meta.url));
const args = process.argv.slice(2);
const usage = "Usage: node scripts/export-kit.mjs NEW_OUTPUT_DIRECTORY";
if (args.length === 1 && args[0] === "--help") {
  console.log(`${usage}\nExports a reviewable adoption kit. Never installs into an app or overwrites a directory.`);
} else if (args.length !== 1 || args[0].startsWith("-")) {
  console.error(usage);
  process.exitCode = 1;
} else {
  let created = false;
  const destination = resolve(args[0]);
  try {
    const sources = new Map();
    for (const name of ["README.md", "policy.md", "installation.md", "delivery.md", "repository.md", "examples/github-checks.yml.example"])
      sources.set(`.factory-kit/${name}`, `kit/${name}`);
    for (const role of ["triage", "spec", "implement", "review", "security", "evaluate"]) {
      const path = `.agents/skills/factory-${role}/SKILL.md`;
      sources.set(path, path);
    }
    sources.set(".factory-kit/LICENSE", "LICENSE");
    sources.set(".factory-kit/labels.json", "config/labels.json");
    sources.set(".github/ISSUE_TEMPLATE/factory-task.yml", ".github/ISSUE_TEMPLATE/factory-task.yml");
    // Read only the public kit allowlist, before creating anything at destination.
    const files = new Map([...sources].map(([target, source]) => [target, readFileSync(join(root, source))]));
    files.set("START-HERE.md", Buffer.from("# Software & Defence Factory kit\n\nRead [the adoption guide](.factory-kit/README.md). The kit folders start with a dot and may be hidden in your file browser. This is a staged package; no app, workflow or service has been configured.\n"));
    let sourceRevision = null, sourceDirty = null;
    try {
      const git = (args) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
      // A ZIP unpacked inside another repository must not inherit its identity.
      if (realpathSync(git(["rev-parse", "--show-toplevel"])) === realpathSync(root)) {
        sourceRevision = git(["rev-parse", "HEAD"]);
        sourceDirty = git(["status", "--porcelain"]).length > 0;
      }
    } catch {
      // A downloaded source ZIP may have no Git metadata; file hashes still apply.
    }
    const manifest = {
      format: 1,
      sourceRevision,
      sourceDirty,
      hashBase: "export root",
      files: [...files].map(([path, bytes]) => ({ path, sha256: createHash("sha256").update(bytes).digest("hex") })),
    };
    files.set(".factory-kit/manifest.json", Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`));
    // Non-recursive creation refuses any existing directory/file/symlink.
    mkdirSync(destination);
    created = true;
    for (const [path, bytes] of files) {
      const target = join(destination, path);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, bytes, { flag: "wx" });
    }
    console.log(`Exported ${files.size} files to ${destination}. Review .factory-kit/README.md before adoption. No app or service was configured.`);
  } catch (error) {
    if (created) rmSync(destination, { recursive: true, force: true });
    console.error(`Kit export failed: ${error.message}`);
    process.exitCode = 1;
  }
}
