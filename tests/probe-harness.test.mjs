import test from "node:test";
import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { delimiter, join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));

function sandbox() {
  const base = mkdtempSync(join(tmpdir(), "factory-codex-probe-"));
  const cwd = join(base, "repo");
  mkdirSync(cwd);
  return { base, cwd };
}

function executable(path, contents) {
  writeFileSync(path, contents);
  chmodSync(path, 0o755);
}

async function probe(cwd, pathValue, extraEnv = {}) {
  const result = spawnSync(process.execPath, [join(root, "scripts/probe-harness.mjs")], {
    cwd, encoding: "utf8", timeout: 10000, maxBuffer: 16 * 1024,
    env: { ...process.env, ...extraEnv, PATH: pathValue },
  });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, "");
  return JSON.parse(result.stdout);
}

test("Codex probe follows absolute PATH shims with spaces and filters credentials", async () => {
  const { base, cwd } = sandbox();
  try {
    const shimDir = join(base, "mise and npm shims with spaces");
    const packageDir = join(base, "npm global packages with spaces");
    mkdirSync(shimDir);
    mkdirSync(packageDir);
    const target = join(packageDir, "codex-cli");
    const shim = join(shimDir, "codex");
    executable(target, "#!/bin/sh\ncase \"$0\" in */codex) ;; *) exit 8;; esac\nif [ -n \"${OPENAI_API_KEY:-}\" ] || [ -n \"${GITHUB_TOKEN:-}\" ]; then printf 'credential leaked\\n'; exit 9; fi\nprintf 'codex-cli 0.99.1\\n'\n");
    symlinkSync(target, shim);

    const result = await probe(cwd, [shimDir, "/usr/bin", "/bin"].join(delimiter), {
      OPENAI_API_KEY: "OPENAI_SENTINEL_SHOULD_NOT_REACH_CODEX",
      GITHUB_TOKEN: "GITHUB_SENTINEL_SHOULD_NOT_REACH_CODEX",
    });
    assert.equal(result.schemaVersion, 1);
    assert.equal(result.harness, "codex");
    assert.equal(result.state, "found");
    assert.equal(result.executablePath, shim);
    assert.equal(result.version, "0.99.1");
    assert.equal(result.authentication, "unknown");
    assert.equal(result.protocol, "unknown");
    assert.equal(result.taskReadiness, "unknown");
    assert.doesNotMatch(JSON.stringify(result), /SENTINEL|credential leaked/);
  } finally { rmSync(base, { recursive: true, force: true }); }
});

test("Codex probe skips empty, relative, cwd and repository-local PATH entries", async () => {
  const { base, cwd } = sandbox();
  try {
    const marker = join(base, "local-impostor-ran");
    const local = join(cwd, "codex");
    const localBin = join(cwd, "tools");
    mkdirSync(localBin);
    executable(local, "#!/bin/sh\nprintf started > \"$PROBE_MARKER\"\nprintf 'codex-cli 1.2.3\\n'\n");
    executable(join(localBin, "codex"), "#!/bin/sh\nprintf started > \"$PROBE_MARKER\"\nprintf 'codex-cli 1.2.3\\n'\n");

    const result = await probe(cwd, ["", ".", cwd, localBin].join(delimiter), { PROBE_MARKER: marker });
    assert.equal(result.state, "missing");
    assert.equal(result.executablePath, null);
    assert.equal(result.authentication, "unknown");
    assert.equal(existsSync(marker), false);
  } finally { rmSync(base, { recursive: true, force: true }); }
});

test("Codex probe reports broken binaries without disclosing output", async () => {
  const { base, cwd } = sandbox();
  try {
    const bin = join(base, "bin");
    mkdirSync(bin);
    executable(join(bin, "codex"), "#!/bin/sh\nprintf 'PRIVATE_STDOUT_SENTINEL\\n'\nprintf 'PRIVATE_STDERR_SENTINEL\\n' >&2\nexit 7\n");

    const result = await probe(cwd, [bin, "/usr/bin", "/bin"].join(delimiter));
    assert.equal(result.state, "broken");
    assert.equal(result.failureReason, "nonzero_exit");
    assert.equal(result.version, null);
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE_(?:STDOUT|STDERR)_SENTINEL/);
  } finally { rmSync(base, { recursive: true, force: true }); }
});

test("Codex probe bounds a hung version command and reports timeout", async () => {
  const { base, cwd } = sandbox();
  try {
    const bin = join(base, "bin");
    mkdirSync(bin);
    executable(join(bin, "codex"), "#!/bin/sh\nexec /bin/sleep 10\n");
    const started = Date.now();
    const result = await probe(cwd, [bin, "/usr/bin", "/bin"].join(delimiter));
    assert.equal(result.state, "timeout");
    assert.equal(result.version, null);
    assert.ok(Date.now() - started < 7000, "probe should stop waiting after its fixed deadline");
  } finally { rmSync(base, { recursive: true, force: true }); }
});

for (const [name, command, reason] of [
  ["invalid version", "printf 'UNEXPECTED_PRIVATE_TEXT\\n'", "invalid_version"],
  ["excessive output", "head -c 4096 /dev/zero", "output_limit"],
]) test(`Codex probe rejects ${name} without exposing output`, async () => {
  const { base, cwd } = sandbox();
  try {
    const bin = join(base, "bin"); mkdirSync(bin);
    executable(join(bin, "codex"), `#!/bin/sh\n${command}\n`);
    const result = await probe(cwd, [bin, "/usr/bin", "/bin"].join(delimiter));
    assert.equal(result.state, "broken");
    assert.equal(result.failureReason, reason);
    assert.doesNotMatch(JSON.stringify(result), /UNEXPECTED_PRIVATE_TEXT/);
  } finally { rmSync(base, { recursive: true, force: true }); }
});

test("probe deadline also stops a wrapper with inherited child pipes", async () => {
  const { base, cwd } = sandbox();
  try {
    const bin = join(base, "bin"); mkdirSync(bin);
    executable(join(bin, "codex"), "#!/bin/sh\ntrap '' TERM\n/bin/sleep 30 &\nwait\n");
    const started = Date.now();
    const result = await probe(cwd, [bin, "/usr/bin", "/bin"].join(delimiter));
    assert.equal(result.state, "timeout");
    assert.ok(Date.now() - started < 7000);
  } finally { rmSync(base, { recursive: true, force: true }); }
});

test("nested project launches cannot execute repository-local PATH binaries", async () => {
  const { base, cwd } = sandbox();
  try {
    mkdirSync(join(cwd, ".git"));
    const nested = join(cwd, "src"); mkdirSync(nested);
    const bin = join(cwd, "node_modules/.bin"); mkdirSync(bin, { recursive: true });
    const marker = join(base, "impostor-ran");
    executable(join(bin, "codex"), "#!/bin/sh\nprintf started > \"$PROBE_MARKER\"\nprintf 'codex-cli 1.2.3\\n'\n");
    const result = await probe(nested, bin, { PROBE_MARKER: marker });
    assert.equal(result.state, "missing");
    assert.equal(existsSync(marker), false);
  } finally { rmSync(base, { recursive: true, force: true }); }
});
