import { cpSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { userInfo } from 'node:os';
import { nativeExecutable, within } from './executable.mjs';

const sha = value => createHash('sha256').update(value).digest('hex');
const accountHome = () => realpathSync(userInfo().homedir);
const writerRoot = () => join(accountHome(),'.local','state','software-defence-factory','native-writers');
const executableChecks=new WeakMap();
export const claudeTempPath=state=>join(realpathSync('/tmp'),`factory-c-${userInfo().uid}-${sha(state).slice(0,12)}`);
export function prepareClaudeTemp(state) {
  const path=claudeTempPath(state);
  try {mkdirSync(path,{mode:0o700});} catch(error) {if(error.code!=='EEXIST')throw error;}
  privateDirectory(path,'Claude temporary directory');
  return path;
}
export const CLAUDE_TOOLS = ['Bash','Read','Edit','Write','Glob','Grep','Skill'];
export const FACTORY_SKILLS = ['factory-triage','factory-spec','factory-implement','factory-review','factory-security','factory-evaluate'];
// Native built-ins that stay visible with the user setting source on the pinned
// CLI. Skills are matched with their source so a user or plugin skill cannot
// pass under a colliding name. Anything else refuses work.
export const FACTORY_SKILL_SOURCE = 'userSettings';
export const CLAUDE_BUILTIN_SKILLS = [{name:'plugin-authoring',source:'built-in'}];
// system/init lists skill names only; it also includes the built-in doctor command.
export const CLAUDE_INIT_BUILTIN_SKILLS = ['doctor','plugin-authoring'];
export const CLAUDE_BUILTIN_PLUGINS = [
  {name:'cc-plugin-agents-md',path:'builtin',source:'cc-plugin-agents-md@builtin'},
  {name:'cc-plugin-plugin-authoring',path:'builtin',source:'cc-plugin-plugin-authoring@builtin'}];
const EFFORTS = ['low','medium','high','xhigh','max'];

export function findNativeClaude(repo, selected) {
  if (selected) return nativeExecutable(selected, repo, 'Claude');
  for (const entry of (process.env.PATH || '').split(':')) {
    if (!isAbsolute(entry) || within(repo, resolve(entry))) continue;
    try { return nativeExecutable(join(entry, 'claude'), repo, 'Claude'); } catch { /* Continue to trusted PATH entries. */ }
  }
  throw new Error('Claude executable unavailable. Pass --claude with an absolute external path.');
}
export const claudeSettingsPath = state => join(state,'claude-settings.json');
export function claudeEnvironment(config, state) {
  // The host environment and its secrets are never forwarded.
  return { HOME: join(state,'home'), TMPDIR: config.tmp_dir || join(state,'tmp'), CLAUDE_CONFIG_DIR: config.config_dir, LANG: 'C.UTF-8',
    PATH: [dirname(config.node), dirname(config.claude), '/usr/local/bin', '/usr/bin', '/bin'].join(':'),
    ENABLE_CLAUDEAI_MCP_SERVERS: 'false', CLAUDE_CODE_AUTO_CONNECT_IDE: '0', CLAUDE_CODE_IDE_SKIP_AUTO_INSTALL: '1',
    DISABLE_AUTOUPDATER: '1', CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1', CLAUDE_CODE_DISABLE_BG_EXIT_HANDOFF: '1' };
}
export function claudeLoginEnvironment(config,state,host=process.env) {
  const env=claudeEnvironment(config,state);
  // Only native interactive login can reach the user's desktop/browser opener.
  for (const key of ['DISPLAY','WAYLAND_DISPLAY','XDG_RUNTIME_DIR','DBUS_SESSION_BUS_ADDRESS','BROWSER'])
    if (typeof host[key]==='string' && host[key]) env[key]=host[key];
  return env;
}
export function claudeSettings(config, state) {
  const repo=config.repo, abs=path=>`/${path}`; // `//abs/path` is an absolute permission rule.
  const protectedDirs=['.git','.claude','.agents'].map(name=>join(repo,name));
  const protectedFiles=['AGENTS.md','VISION.md'].map(name=>join(repo,name));
  return {
    disableAllHooks: true,
    autoMemoryEnabled: false,
    disableBundledSkills: true,
    enabledPlugins: {},
    worktree: { bgIsolation: 'none' },
    permissions: { defaultMode: 'dontAsk', allow: [...CLAUDE_TOOLS],
      deny: [...protectedDirs.flatMap(path=>[`Edit(${abs(path)}/**)`,`Write(${abs(path)}/**)`]),
        ...protectedFiles.flatMap(path=>[`Edit(${abs(path)})`,`Write(${abs(path)})`])],
      blockReadsOutsideWorkingDirectories: true },
    sandbox: { enabled: true, failIfUnavailable: true, autoAllowBashIfSandboxed: true, allowUnsandboxedCommands: false,
      filesystem: { denyRead: [config.account_home], allowRead: [repo, config.tmp_dir || join(state,'tmp'), ...config.runtime_reads],
        allowWrite: [config.tmp_dir || join(state,'tmp')], denyWrite: [...protectedDirs, ...protectedFiles] },
      network: { allowedDomains: [], strictAllowlist: true, allowLocalBinding: false } },
  };
}
// Every native run uses the same pinned flags. `--bg`, `--restricted` and bare
// mode are deliberately not used; see docs/setup.md.
export function claudeArgs(config, state, { session = null, resume = null, probe = false } = {}) {
  const args=['-p','--input-format','stream-json','--output-format','stream-json','--verbose','--replay-user-messages',
    '--model',config.model,'--effort',config.effort,'--setting-sources','user','--strict-mcp-config',
    '--settings',claudeSettingsPath(state),'--no-chrome','--tools',CLAUDE_TOOLS.join(',')];
  if (config.instructions) args.push('--append-system-prompt-file',join(config.repo,config.instructions));
  if (probe) args.push('--no-session-persistence');
  else if (resume) args.push('--resume',resume);
  else args.push('--session-id',session);
  return args;
}
// Read-only native inventory of live sessions for this repository. It loads no
// settings so it cannot run profile hooks or plugins.
export const claudeInventoryArgs = config => ['--safe-mode','--setting-sources','','agents','--json','--all','--cwd',config.repo];
export const claudeAuthArgs = ['auth','status','--json'];
export function claudeVersion(config, env) {
  return execFileSync(config.claude,['--version'],{cwd:config.repo,env,encoding:'utf8',timeout:15000,stdio:['ignore','pipe','ignore']}).trim();
}
function stageSkills(skills) {
  const packaged=join(fileURLToPath(new URL('../../',import.meta.url)),'adlc','skills'), hashes={};
  mkdirSync(skills,{recursive:true,mode:0o700});
  for (const name of FACTORY_SKILLS) {
    if (!existsSync(join(skills,name))) cpSync(join(packaged,name),join(skills,name),{recursive:true,errorOnExist:true,force:false});
    hashes[name]=sha(readFileSync(join(skills,name,'SKILL.md')));
    if (hashes[name]!==sha(readFileSync(join(packaged,name,'SKILL.md'))))
      throw new Error(`Selected Claude profile has a different ${name} skill; refuse to adopt it.`);
  }
  if (readdirSync(skills).sort().join(',')!==[...FACTORY_SKILLS].sort().join(','))
    throw new Error('Selected Claude profile has unreviewed skills; refuse to adopt it.');
  return hashes;
}
function privateDirectory(path, label) {
  const info=lstatSync(path);
  if (!info.isDirectory() || (info.mode & 0o077) || info.uid!==userInfo().uid || realpathSync(path)!==path) throw new Error(`${label} must be an owned private (0700) real directory.`);
}
export function setupClaude({ repo, state, claude: selected, model, effort, profile }) {
  if (typeof model!=='string' || !/^[a-z0-9][a-z0-9.-]{2,80}$/.test(model)) throw new Error('Claude setup needs --model with an exact native model ID.');
  if (!EFFORTS.includes(effort)) throw new Error(`Claude setup needs --effort ${EFFORTS.join('|')}.`);
  const home=accountHome(), claude=findNativeClaude(repo, selected), target=realpathSync(claude);
  const node=realpathSync(process.execPath), nodeRoot=dirname(dirname(node));
  let configDir=join(state,'home','.claude');
  if (profile) {
    if (!isAbsolute(profile)) throw new Error('--claude-config needs an absolute path.');
    configDir=realpathSync(profile);
    if (configDir===join(home,'.claude') || within(configDir,home) || within(repo,configDir) || within(configDir,repo)
      || within(configDir,state) || within(state,configDir) || within(configDir,writerRoot()))
      throw new Error('--claude-config must be a dedicated Factory profile, never the personal Claude profile, repository or state.');
    privateDirectory(configDir,'--claude-config');
  }
  const reads=[...new Set([nodeRoot])];
  if (relative('/',nodeRoot).split(sep).filter(Boolean).length<2 || within(nodeRoot,home) || reads.some(path=>within(path,repo)||within(repo,path)))
    throw new Error('Pinned Node installation must be a narrow directory outside the repository and never the personal home.');
  const config={ version:1, harness:'claude', repo, claude, claude_target:target, node, profile:'factory', model, effort,
    config_dir:configDir, account_home:home, runtime_reads:reads, writer_root:writerRoot(),tmp_dir:claudeTempPath(state),
    instructions: existsSync(join(repo,'AGENTS.md')) ? 'AGENTS.md' : null };
  mkdirSync(state,{mode:0o700});
  for (const dir of ['home','tmp','receipts','issue-submissions']) mkdirSync(join(state,dir),{mode:0o700});
  prepareClaudeTemp(state);
  if (!profile) mkdirSync(configDir,{mode:0o700});
  config.skills=stageSkills(join(configDir,'skills'));
  config.claude_sha256=sha(readFileSync(target));
  config.claude_version=claudeVersion(config,claudeEnvironment(config,state));
  const settings=`${JSON.stringify(claudeSettings(config,state),null,2)}\n`;
  config.settings_sha256=sha(settings);
  writeFileSync(claudeSettingsPath(state),settings,{mode:0o600,flag:'wx'});
  writeFileSync(join(state,'native.json'),`${JSON.stringify(config,null,2)}\n`,{mode:0o600,flag:'wx'});
  return { state, repo, harness:'claude', claude, version:config.claude_version, model, effort, profile:configDir,
    skills:'staged for native discovery; unqualified', login:'not checked; run factory doctor', qualification:'unverified' };
}
export function verifyClaudeConfig(state, config,{reuseExecutable=false}={}) {
  const path=claudeSettingsPath(state);
  if (!existsSync(path) || (lstatSync(path).mode & 0o077) || sha(readFileSync(path))!==config.settings_sha256)
    throw new Error('Native permissions configuration changed; refuse admission.');
  const stat=lstatSync(config.claude_target,{bigint:true}),stamp=[stat.dev,stat.ino,stat.size,stat.mtimeNs,stat.ctimeNs].join(':');
  if (realpathSync(config.claude)!==config.claude_target || typeof config.claude_sha256!=='string'
    || (!(reuseExecutable && executableChecks.get(config)===stamp) && sha(readFileSync(config.claude_target))!==config.claude_sha256))
    throw new Error('Pinned Claude executable changed; refuse admission.');
  executableChecks.set(config,stamp);
  const skills=join(config.config_dir,'skills');
  if (readdirSync(skills).sort().join(',')!==[...FACTORY_SKILLS].sort().join(',')
    || FACTORY_SKILLS.some(name=>sha(readFileSync(join(skills,name,'SKILL.md')))!==config.skills?.[name]))
    throw new Error('Native skill catalog changed; refuse to start.');
}
export function readClaude(state, config) {
  privateDirectory(state,'Native state');
  if (config.version!==1 || config.harness!=='claude' || config.profile!=='factory' || !isAbsolute(config.repo)
    || !isAbsolute(config.claude) || !isAbsolute(config.config_dir) || realpathSync(config.repo)!==config.repo
    || realpathSync(process.execPath)!==config.node || config.writer_root!==writerRoot() || config.account_home!==accountHome()
    || !EFFORTS.includes(config.effort) || typeof config.model!=='string' || config.tmp_dir!==claudeTempPath(state))
    throw new Error('Native state or selected Node toolchain changed; refuse to start.');
  privateDirectory(config.config_dir,'Claude profile');
  prepareClaudeTemp(state);
  verifyClaudeConfig(state,config);
  return { state, config, env:claudeEnvironment(config,state) };
}
