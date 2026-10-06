import { cpSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { userInfo } from 'node:os';
import { readClaude, setupClaude } from './claude-setup.mjs';
import { nativeExecutable, within } from './executable.mjs';

const quote = value => JSON.stringify(value);
const CONFIG = 'native.json';
// Account identity, not the launch environment, owns isolation and writer locks.
const accountHome = () => realpathSync(userInfo().homedir);
const writerRoot = () => join(accountHome(),'.local','state','software-defence-factory','native-writers');

export function findNativeCodex(repo, selected) {
  if (selected) return nativeExecutable(selected, repo);
  for (const entry of (process.env.PATH || '').split(':')) {
    if (!isAbsolute(entry) || within(repo, resolve(entry))) continue;
    try { return nativeExecutable(join(entry, 'codex'), repo); } catch { /* Continue to trusted PATH entries. */ }
  }
  throw new Error('Codex executable unavailable. Pass --codex with an absolute external path.');
}
export function nativeEnvironment(config, state) {
  return { HOME: join(state, 'home'), CODEX_HOME: join(state, 'home', '.codex'), TMPDIR: join(state, 'tmp'),
    PATH: [dirname(config.node), dirname(config.codex), '/usr/local/bin', '/usr/bin', '/bin'].join(':'), LANG: 'C.UTF-8' };
}
export function nativePolicy(config, state) {
  const env=nativeEnvironment(config,state);
  return {
    approval_policy:'never', default_permissions:'factory', cli_auth_credentials_store:'file', web_search:'disabled',
    features:{apps:false,plugins:false,remote_plugin:false,hooks:false,browser_use:false,browser_use_external:false,
      in_app_browser:false,computer_use:false,image_generation:false,tool_suggest:false,shell_snapshot:false,
      auth_elicitation:false,mcp_2026_07_28:false,codex_apps_mcp_2026_07_28:false,
      enable_mcp_apps:false,skill_mcp_dependency_install:false,tool_call_mcp_elicitation:false},
    apps:{_default:{enabled:false}},
    projects:{[config.repo]:{trust_level:'trusted'}},
    shell_environment_policy:{inherit:'none',set:{PATH:env.PATH,HOME:env.HOME,TMPDIR:env.TMPDIR}},
    permissions:{factory:{filesystem:{':root':'deny',':minimal':'read',
      ...Object.fromEntries(config.runtime_reads.map(path=>[path,'read'])),[join(env.CODEX_HOME,'skills')]:'read',[env.TMPDIR]:'write',
      ':workspace_roots':{'.':'write','.git':'read','.codex':'read','.agents':'read','VISION.md':'read'}},
      network:{enabled:false}}},
  };
}
export function setupNative(repoPath, statePath, selectedCodex, bundleRead, claude=null) {
  if (process.platform !== 'linux') throw new Error('Native isolation is currently supported only on Linux.');
  const repo = realpathSync(resolve(repoPath));
  if (!lstatSync(repo).isDirectory()) throw new Error('--repo must be a directory.');
  const top = execFileSync('git', ['-C', repo, 'rev-parse', '--show-toplevel'], { encoding:'utf8' }).trim();
  if (realpathSync(top) !== repo) throw new Error('--repo must be the Git root.');
  const requestedState=resolve(statePath);
  const state=join(realpathSync(dirname(requestedState)),basename(requestedState));
  if (within(repo, state) || within(state, repo)) throw new Error('State must be separate from the repository.');
  const lockRoot=writerRoot();
  if (within(repo,lockRoot) || within(lockRoot,repo) || within(state,lockRoot) || within(lockRoot,state))
    throw new Error('Repository and native state must be separate from the writer lock directory.');
  if (existsSync(state)) throw new Error('Native state path already exists; choose an empty new directory.');
  if (claude) {
    if (selectedCodex || bundleRead) throw new Error('--codex and --bundle-read apply only to the Codex harness.');
    return setupClaude({...claude, repo, state});
  }
  const codex = findNativeCodex(repo, selectedCodex);
  const node = realpathSync(process.execPath), codexTarget = realpathSync(codex);
  const reads = [...new Set([node, codex, codexTarget])];
  if (bundleRead) {
    if (!isAbsolute(bundleRead)) throw new Error('--bundle-read needs an absolute path.');
    const bundle = realpathSync(bundleRead);
    const runtimeDirs=[dirname(codexTarget),dirname(dirname(codexTarget))];
    if (!lstatSync(bundle).isDirectory() || !runtimeDirs.includes(bundle)
      || relative('/',bundle).split(sep).filter(Boolean).length<3
      || within(bundle, accountHome()))
      throw new Error('Bundle read must be a narrow Codex executable directory or installation root, never the personal home or its ancestor.');
    reads.push(bundle);
  }
  if (reads.some(path=>within(path,repo)||within(path,state)||within(repo,path)||within(state,path)))
    throw new Error('Selected toolchain read path overlaps repository or native state.');
  const config = { version:1, repo, codex, node, profile:'factory', runtime_reads:reads, writer_root:lockRoot };
  mkdirSync(state, { mode:0o700 });
  mkdirSync(join(state,'home'), { mode:0o700 });
  mkdirSync(join(state,'home','.codex'), { mode:0o700 });
  mkdirSync(join(state,'home','.codex','skills'), { mode:0o700 });
  mkdirSync(join(state,'tmp'), { mode:0o700 });
  mkdirSync(join(state,'receipts'), { mode:0o700 });
  mkdirSync(join(state,'issue-submissions'), { mode:0o700 });
  const home = join(state,'home'), tmp = join(state,'tmp');
  const packaged=join(fileURLToPath(new URL('../../',import.meta.url)),'adlc','skills');
  config.skills={};
  for(const role of ['triage','spec','implement','review','security','evaluate']) {
    const name=`factory-${role}`;
    cpSync(join(packaged,name),join(home,'.codex','skills',name),{recursive:true,errorOnExist:true,force:false});
    config.skills[name]=createHash('sha256').update(readFileSync(join(home,'.codex','skills',name,'SKILL.md'))).digest('hex');
  }
  const policy=nativePolicy(config,state);
  const toml = [
    'approval_policy = "never"',
    'default_permissions = "factory"',
    'cli_auth_credentials_store = "file"',
    'web_search = "disabled"',
    '[features]',
    ...Object.entries(policy.features).map(([name,enabled])=>name+' = '+enabled),
    '[apps._default]',
    'enabled = false',
    '[shell_environment_policy]',
    'inherit = "none"',
    '[shell_environment_policy.set]',
    'PATH = '+quote(policy.shell_environment_policy.set.PATH),
    'HOME = '+quote(home),
    'TMPDIR = '+quote(tmp),
    '[permissions.factory.filesystem]',
    '":root" = "deny"',
    '":minimal" = "read"',
    ...reads.map(path=>quote(path)+' = "read"'),
    quote(join(home,'.codex','skills'))+' = "read"',
    quote(tmp)+' = "write"',
    '[permissions.factory.filesystem.":workspace_roots"]',
    '"." = "write"',
    '".git" = "read"',
    '".codex" = "read"',
    '".agents" = "read"',
    '"VISION.md" = "read"',
    '[permissions.factory.network]',
    'enabled = false',
    '[projects.'+quote(repo)+']',
    'trust_level = \"trusted\"',
    '',
  ].join('\n');
  config.config_sha256=createHash('sha256').update(toml).digest('hex');
  writeFileSync(join(home,'.codex','config.toml'), toml, { mode:0o600, flag:'wx' });
  writeFileSync(join(state,CONFIG), `${JSON.stringify(config,null,2)}\n`, { mode:0o600, flag:'wx' });
  return { state, repo, codex, skills:'staged for native discovery; unqualified', login:'required', qualification:'unverified' };
}
export function readNative(statePath) {
  if (process.platform !== 'linux') throw new Error('Native isolation is currently supported only on Linux.');
  const state = realpathSync(resolve(statePath));
  const config = JSON.parse(readFileSync(join(state,CONFIG),'utf8'));
  if (config.harness === 'claude') return readClaude(state, config);
  if (config.harness !== undefined) throw new Error('Unsupported native harness in state; refuse to start.');
  if (config.version !== 1 || config.profile !== 'factory' || !isAbsolute(config.repo) || !isAbsolute(config.codex)
    || !isAbsolute(config.node) || !lstatSync(state).isDirectory() || (lstatSync(state).mode & 0o077)
    || realpathSync(config.repo) !== config.repo || !Array.isArray(config.runtime_reads)
    || !config.runtime_reads.includes(realpathSync(config.codex))
    || realpathSync(process.execPath) !== config.node || config.writer_root!==writerRoot())
    throw new Error('Native state or selected Node toolchain changed; refuse to start.');
  const expected = nativeEnvironment(config,state);
  verifyNativeConfig(state,config);
  const skillsFolder=join(state,'home','.codex','skills');
  const expectedSkills=['factory-triage','factory-spec','factory-implement','factory-review','factory-security','factory-evaluate'];
  if (Object.keys(config.skills||{}).sort().join(',')!==expectedSkills.sort().join(',')
    || readdirSync(skillsFolder).filter(name=>name!=='.system').sort().join(',')!==expectedSkills.sort().join(',')
    || expectedSkills.some(name=>createHash('sha256').update(readFileSync(join(skillsFolder,name,'SKILL.md'))).digest('hex')!==config.skills[name]))
    throw new Error('Native skill catalog changed; refuse to start.');
  return { state, config, env:expected };
}
export function verifyNativeConfig(state, config) {
  const path=join(state,'home','.codex','config.toml');
  if (!existsSync(path) || (lstatSync(path).mode & 0o077)
    || createHash('sha256').update(readFileSync(path)).digest('hex')!==config.config_sha256)
    throw new Error('Native permissions configuration changed; refuse admission.');
}
