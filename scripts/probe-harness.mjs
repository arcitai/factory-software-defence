import { accessSync, constants, existsSync, lstatSync, realpathSync, statSync } from "node:fs";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { delimiter, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const PROBE_TIMEOUT_MS = 2000;
const MAX_OUTPUT_BYTES = 2048;
const SECRET_ENV_NAME = /(?:^|_)(?:API[_-]?KEY|KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIALS?|AUTH(?:ORIZATION)?|PRIVATE|BEARER|COOKIE|CERT|SIGNING)(?:_|$)/i;

function pathValue(environment) {
  const entry = Object.entries(environment).find(([name]) => name.toUpperCase() === "PATH");
  return typeof entry?.[1] === "string" ? entry[1] : "";
}

function isWithin(root, candidate) {
  const rel = relative(root, candidate);
  return rel === "" || (!isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${sep}`));
}

function trustedPathEntries(environment, cwd) {
  let canonicalCwd;
  try { canonicalCwd = realpathSync(cwd); }
  catch { canonicalCwd = resolve(cwd); }

  // A launch from repo/src must not trust repo/node_modules/.bin either.
  for (let parent = canonicalCwd; ; parent = dirname(parent)) {
    if (existsSync(join(parent, ".git"))) { canonicalCwd = parent; break; }
    if (dirname(parent) === parent) break;
  }
  const entries = [];
  const seen = new Set();
  for (const entry of pathValue(environment).split(delimiter)) {
    if (!entry || !isAbsolute(entry)) continue;
    let canonicalEntry;
    try { canonicalEntry = realpathSync(entry); }
    catch { continue; }
    // Skip the containing repository (or working directory) and descendants, even when PATH spells
    // them absolutely or reaches them through a symlink.
    if (isWithin(canonicalCwd, canonicalEntry) || seen.has(canonicalEntry)) continue;
    seen.add(canonicalEntry);
    entries.push({ entry: resolve(entry), canonical: canonicalEntry });
  }
  return { canonicalCwd, entries };
}

function inspectCandidate(candidate, canonicalCwd, platform) {
  let linkInfo;
  try { linkInfo = lstatSync(candidate); }
  catch { return null; }
  if (!linkInfo.isFile() && !linkInfo.isSymbolicLink()) return null;

  let canonical;
  let info;
  try {
    canonical = realpathSync(candidate);
    info = statSync(candidate);
  } catch {
    return { broken: true, path: candidate, canonical: null };
  }
  if (!info.isFile() || isWithin(canonicalCwd, canonical)) return null;
  if (platform !== "win32") {
    try { accessSync(candidate, constants.X_OK); }
    catch { return { broken: true, path: candidate, canonical }; }
  }
  return { path: candidate, canonical };
}

function findCodex(environment = process.env, cwd = process.cwd(), platform = process.platform) {
  const { canonicalCwd, entries } = trustedPathEntries(environment, cwd);
  const executableNames = platform === "win32" ? ["codex.exe"] : ["codex"];
  let broken;

  for (const { entry } of entries) {
    for (const name of executableNames) {
      const candidate = inspectCandidate(join(entry, name), canonicalCwd, platform);
      if (!candidate) continue;
      if (candidate.broken) broken ||= candidate;
      else return { candidate, pathEntries: entries.map(item => item.canonical) };
    }
  }

  if (platform === "win32") {
    for (const { entry } of entries) {
      for (const name of ["codex.cmd", "codex.ps1"]) {
        const candidate = inspectCandidate(join(entry, name), canonicalCwd, platform);
        if (candidate && !candidate.broken)
          return { unsupportedShim: candidate, pathEntries: entries.map(item => item.canonical) };
      }
    }
  }

  return { broken, pathEntries: entries.map(item => item.canonical) };
}

function baseResult(state, executablePath = null) {
  return {
    schemaVersion: 1,
    harness: "codex",
    state,
    executablePath,
    version: null,
    authentication: "unknown",
    protocol: "unknown",
    taskReadiness: "unknown",
  };
}

function childEnvironment(environment, pathEntries) {
  const safe = {};
  for (const [name, value] of Object.entries(environment)) {
    const upper = name.toUpperCase();
    if (upper === "PATH" || SECRET_ENV_NAME.test(name) || upper === "CODEX_HOME") continue;
    safe[name] = value;
  }
  safe.PATH = pathEntries.join(delimiter);
  return safe;
}

function parseVersion(stdout) {
  const match = /^(?:codex(?:-cli)?\s+)?v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?)$/i.exec(stdout.trim());
  return match?.[1] ?? null;
}

function runVersion(candidate, environment, pathEntries) {
  return new Promise(resolveResult => {
    let child;
    try {
      child = spawn(candidate.path, ["--version"], {
        cwd: tmpdir(),
        env: childEnvironment(environment, pathEntries),
        shell: false,
        windowsHide: true,
        detached: process.platform !== "win32",
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch {
      resolveResult({ state: "broken", failureReason: "spawn_failed" });
      return;
    }

    const stop = () => {
      try {
        if (process.platform === "win32") child.kill("SIGKILL");
        else if (child.pid) process.kill(-child.pid, "SIGKILL");
      } catch (error) { if (error.code !== "ESRCH") child.kill("SIGKILL"); }
      child.stdout.destroy();
      child.stderr.destroy();
    };
    let stdout = Buffer.alloc(0);
    let outputBytes = 0;
    let timedOut = false;
    let outputLimit = false;
    let finished = false;
    let timer;
    const finish = result => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      resolveResult(result);
    };
    const collect = (stream, chunk) => {
      outputBytes += chunk.length;
      if (outputBytes > MAX_OUTPUT_BYTES) {
        outputLimit = true;
        stop();
        finish({ state: "broken", failureReason: "output_limit" });
        return;
      }
      if (stream === "stdout") stdout = Buffer.concat([stdout, chunk]);
    };
    child.stdout.on("data", chunk => collect("stdout", chunk));
    child.stderr.on("data", chunk => collect("stderr", chunk));
    child.once("error", () => finish({ state: "broken", failureReason: "spawn_failed" }));
    child.once("close", code => {
      if (timedOut) return finish({ state: "timeout" });
      if (outputLimit) return finish({ state: "broken", failureReason: "output_limit" });
      if (code !== 0) return finish({ state: "broken", failureReason: "nonzero_exit" });
      const version = parseVersion(stdout.toString("utf8"));
      finish(version ? { state: "found", version } : { state: "broken", failureReason: "invalid_version" });
    });

    timer = setTimeout(() => {
      timedOut = true;
      stop();
      finish({ state: "timeout" });
    }, PROBE_TIMEOUT_MS);
  });
}

export async function probeCodex() {
  const found = findCodex();
  if (!found.candidate) {
    if (found.unsupportedShim) {
      const result = baseResult("broken", found.unsupportedShim.path);
      result.failureReason = "windows_command_shim_unsupported";
      return result;
    }
    if (found.broken) {
      const result = baseResult("broken", found.broken.path);
      result.failureReason = "not_executable";
      return result;
    }
    return baseResult("missing");
  }

  const outcome = await runVersion(found.candidate, process.env, found.pathEntries);
  const result = baseResult(outcome.state, found.candidate.path);
  if (outcome.version) result.version = outcome.version;
  if (outcome.failureReason) result.failureReason = outcome.failureReason;
  return result;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length > 2) {
    process.stderr.write("This probe accepts no arguments.\n");
    process.exitCode = 2;
  } else {
    const result = await probeCodex();
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  }
}
