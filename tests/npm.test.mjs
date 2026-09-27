import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { busyInstallations, installRelease, latestVersion, newer, registerInstallation } from '../factory/updates.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
function temporary(t, executable = false) {
  // Native jobs mount /tmp noexec. Keep disposable npm bins/cache on the
  // checkout's executable, ignored scratch mount so the normal check works.
  const base = executable ? join(root, '.factory/package-tests') : tmpdir();
  mkdirSync(base, { recursive: true });
  const dir = mkdtempSync(join(base, 'factory-npm-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}
function command(name, args, options = {}) {
  const result = spawnSync(name, args, { cwd: root, encoding: 'utf8', ...options });
  assert.equal(result.status, 0, result.stderr || result.stdout || String(result.error)); return result.stdout;
}
test('npm artifact installs without a checkout, keeps state outside the package, and exports the complete method', async t => {
  const dir = temporary(t, true), prefix = join(dir, 'installation');
  const environment = { ...process.env, XDG_STATE_HOME: join(dir, 'state'), XDG_DATA_HOME: join(dir, 'data'), SDF_AUTO_UPDATE: '0', SDF_BOOTSTRAPPED: '0', npm_config_cache: join(dir, 'npm-cache') };
  const packed = JSON.parse(command('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', dir]))[0];
  const names = packed.files.map(file => file.path);
  for (const required of ['bin/software-defence-factory.mjs', 'factory/updates.mjs', 'factory/issue-templates.mjs', 'factory/intake.mjs', 'factory/definition.mjs', 'factory/terminology.json', 'operator-skills/factory-foundation/SKILL.md', 'docs/concepts.md', 'factory/paths.mjs', 'factory/image/Dockerfile', 'kit/policy.md', 'docs/setup.md', 'docs/services.md', '.agents/skills/factory-implement/SKILL.md', 'scripts/export-kit.mjs', 'scripts/retained-source-fixture.mjs', 'LICENSE']) assert.ok(names.includes(required), required);
  assert.ok(names.every(path => !/^(?:\.factory|\.git\/|tests\/|experiments\/|evals\/|node_modules\/)|(?:^|\/)\.env(?:\.|$)/.test(path)));
  const occupiedBin = join(prefix, 'bin/factory');
  mkdirSync(join(prefix, 'bin'), { recursive: true });
  writeFileSync(occupiedBin, '# unrelated Factory executable\n', { mode: 0o755 });
  const collision = spawnSync('npm', ['install', '--global', '--prefix', prefix, '--ignore-scripts', '--no-audit', '--no-fund', join(dir, packed.filename)], { encoding: 'utf8', env: environment });
  assert.notEqual(collision.status, 0); assert.match(collision.stderr, /EEXIST/);
  assert.equal(readFileSync(occupiedBin, 'utf8'), '# unrelated Factory executable\n');
  rmSync(occupiedBin);
  command('npm', ['install', '--global', '--prefix', prefix, '--ignore-scripts', '--no-audit', '--no-fund', join(dir, packed.filename)], { env: environment });
  const packageRoot = join(prefix, 'lib/node_modules/software-defence-factory');
  const cli = join(packageRoot, 'bin/software-defence-factory.mjs');
  const bins = ['factory', 'software-defence-factory'].map(name => join(prefix, 'bin', name));
  for (const bin of bins) assert.equal(realpathSync(bin), cli);
  const run = args => command(bins[0], args, { cwd: dir, env: environment });
  const legacy = args => command(bins[1], args, { cwd: dir, env: environment });
  assert.equal(legacy(['--version']), run(['--version']));
  assert.equal(legacy(['help']), run(['help']));
  assert.match(run(['help']), /^Factory \d+\.\d+\.\d+.*\n\nUsage: factory <command>/);
  for (const bin of bins) {
    const unsupported = spawnSync(bin, ['not-a-command'], { encoding: 'utf8', env: environment });
    assert.equal(unsupported.status, 1);
    assert.match(unsupported.stderr, /Factory: Unknown command: not-a-command/);
  }
  // Local tarball stands in for the not-yet-published registry version. npm is
  // offline here: exercise explicit executable selection through npm exec and npx.
  const tarball = join(dir, packed.filename);
  assert.equal(command('npm', ['exec', '--offline', '--yes', `--package=${tarball}`, '--', 'factory', 'help'],
    { cwd: dir, env: environment }).replaceAll(/Setup plan: .*\n/g, ''), run(['help']).replaceAll(/Setup plan: .*\n/g, ''));
  assert.equal(command('npx', ['--offline', '--yes', `--package=${tarball}`, 'factory', '--version'], { cwd: dir, env: environment }), run(['--version']));
  assert.equal(run(['--version']).trim(), JSON.parse(readFileSync(join(root, 'package.json'))).version);
  assert.ok(names.includes('factory/ui/index.html'));
  assert.ok(names.some(path => /^factory\/ui\/assets\/.+\.js$/.test(path)));
  assert.ok(names.includes('THIRD_PARTY_NOTICES.md'));
  assert.match(run(['help']), /state\/software-defence-factory\/platform/);
  assert.ok(run(['help']).includes(join(packageRoot, 'docs/setup.md')));
  assert.match(run(['foundation']), /# Factory Foundation/);
  assert.equal(run(['--help']), run(['help']));
  assert.equal(run(['-h']), run(['help']));
  const repo = join(dir, 'app'); mkdirSync(repo);
  command('git', ['init', '-q', repo]);
  command('git', ['-C', repo, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@localhost', 'commit', '--allow-empty', '-qm', 'fixture']);
  run(['init', '--repo', repo, '--agent', 'mock', '--check', 'true', '--source-ref', 'main']);
  const state = join(environment.XDG_STATE_HOME, 'software-defence-factory/platform');
  const configured=JSON.parse(readFileSync(join(state, 'factory.json')));
  assert.equal(configured.repo,realpathSync(repo));assert.equal(configured.harness,'mock');assert.equal(configured.sourceRef,'main');assert.equal(configured.agent,undefined);
  assert.equal(JSON.parse(run(['definition'])).configuration.harness,'mock');
  const originalDefinition = run(['definition']);
  assert.equal(legacy(['definition']), originalDefinition);
  // Serve the installed bundle through the real controller without running jobs.
  const { createController } = await import(pathToFileURL(join(packageRoot, 'factory/server.mjs')).href);
  const controller = createController(state);
  try {
    await new Promise(resolve => controller.server.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${controller.server.address().port}`;
    const response = await fetch(origin);
    assert.equal(response.status, 200);
    const html = await response.text();
    assert.match(html, /<title>Factory — Software &amp; Defence<\/title>/);
    assert.equal(html, readFileSync(join(packageRoot, 'factory/ui/index.html'), 'utf8'));
    const assets = [...html.matchAll(/(?:src|href)="(\/assets\/[^" ]+)"/g)].map(match => match[1]);
    assert.ok(assets.some(asset => asset.endsWith('.js')));
    assert.ok(assets.some(asset => asset.endsWith('.css')));
    for (const asset of assets) {
      const served = await fetch(origin + asset);
      assert.equal(served.status, 200);
      assert.deepEqual(Buffer.from(await served.arrayBuffer()), readFileSync(join(packageRoot, 'factory/ui', asset)));
    }
  } finally { await controller.close(); }
  const secondState=join(dir,'second-state');
  run(['init','--repo',repo,'--harness','pi','--state',secondState]);
  assert.equal(JSON.parse(readFileSync(join(secondState,'factory.json'))).harness,'pi');
  assert.equal(spawnSync(process.execPath,[cli,'init','--repo',repo,'--state',join(dir,'conflict'),'--harness','pi','--agent','codex'],{env:environment}).status,1);
  assert.equal(command('git', ['-C', repo, 'status', '--porcelain']), '');
  assert.equal(existsSync(join(packageRoot, '.factory')), false);
  assert.equal(spawnSync(process.execPath, [cli, 'init', '--repo', repo], { env: environment }).status, 1);
  run(['kit', '--output', join(dir, 'method')]);
  assert.equal(readdirSync(join(dir, 'method/.agents/skills')).length, 6);
  assert.ok(existsSync(join(dir, 'method/.factory-kit/manifest.json')));
  legacy(['update', '--auto', 'off']);
  assert.equal(JSON.parse(readFileSync(join(environment.XDG_STATE_HOME, 'software-defence-factory/updates.json'))).enabled, false);
  // Even an already stopped executor fence must block a manual upgrade.
  mkdirSync(join(state, 'jobs/job_fixture'), { recursive: true });
  writeFileSync(join(state, 'jobs/job_fixture/active.json'), JSON.stringify({ pid: 2147483647 }));
  const blocked = spawnSync(process.execPath, [cli, 'update'], { encoding: 'utf8', env: environment });
  assert.equal(blocked.status, 1); assert.match(blocked.stderr, /Stop\/reconcile/);

  // Controlled old-bootstrap fixture: unchanged installed entry/dispatcher,
  // lower manifest version, and a real candidate tarball in the private cache.
  // Exact installed old-release/host adoption remains separate qualification.
  const version = JSON.parse(readFileSync(join(root, 'package.json'))).version;
  const cachedRoot = join(environment.XDG_DATA_HOME, 'software-defence-factory/releases', version, 'node_modules/software-defence-factory');
  cpSync(packageRoot, cachedRoot, { recursive: true });
  const bootstrapManifest = JSON.parse(readFileSync(join(packageRoot, 'package.json')));
  bootstrapManifest.version = '0.11.0';
  writeFileSync(join(packageRoot, 'package.json'), JSON.stringify(bootstrapManifest));
  const preferences = join(environment.XDG_STATE_HOME, 'software-defence-factory/updates.json');
  writeFileSync(preferences, JSON.stringify({ enabled: false, version }));
  const savedState = readFileSync(join(state, 'factory.json'));
  for (const invoke of [run, legacy]) {
    assert.equal(invoke(['--version']).trim(), version);
    assert.ok(invoke(['help']).includes(join(cachedRoot, 'docs/setup.md')));
    assert.equal(invoke(['definition']), originalDefinition);
  }
  assert.deepEqual(readFileSync(join(state, 'factory.json')), savedState);
  const sourceHelp = command(process.execPath, [join(root, 'bin/software-defence-factory.mjs'), 'help'], { env: environment });
  assert.ok(sourceHelp.includes(join(root, '.factory/platform')));
  assert.ok(sourceHelp.includes(join(root, 'docs/setup.md')));
  const sourceUpdate = spawnSync(process.execPath, [join(root, 'bin/software-defence-factory.mjs'), 'update'], { env: environment, encoding: 'utf8' });
  assert.equal(sourceUpdate.status, 1); assert.match(sourceUpdate.stderr, /source checkout/);
});
test('only newer stable releases with the expected registry identity are accepted', async () => {
  assert.equal(newer('0.10.0', '0.2.9'), true);
  for (const version of ['0.3.0', '0.1.0', '0.3.0-beta.1', '../other', 'latest']) assert.equal(newer(version, '0.3.0'), false);
  assert.equal(await latestVersion(async () => ({ ok: true, json: async () => ({ name: 'software-defence-factory', version: '0.2.2' }) })), '0.2.2');
  await assert.rejects(latestVersion(async () => ({ ok: true, json: async () => ({ name: 'other', version: '0.2.2' }) })), /identity/);
  await assert.rejects(latestVersion(async () => ({ ok: false, status: 503 })), /503/);
});
test('updates retain the previous release and private state when installation fails', t => {
  const dir = temporary(t), data = join(dir, 'data'), state = join(dir, 'state'); mkdirSync(state);
  writeFileSync(join(state, 'model.env'), 'SYNTHETIC_TEST_VALUE=private\n');
  let calls = 0;
  const installer = (name, args) => {
    calls++; assert.equal(name, 'npm'); assert.ok(args.includes('--ignore-scripts'));
    assert.ok(args.includes('https://registry.npmjs.org'));
    const prefix = args[args.indexOf('--prefix') + 1], pkg = join(prefix, 'node_modules/software-defence-factory');
    mkdirSync(join(pkg, 'bin'), { recursive: true });
    writeFileSync(join(pkg, 'package.json'), JSON.stringify({ name: 'software-defence-factory', version: '0.2.2' }));
    writeFileSync(join(pkg, 'bin/software-defence-factory.mjs'), 'console.log("fixture");\n'); return { status: 0 };
  };
  const first = installRelease('0.2.2', data, installer);
  assert.equal(installRelease('0.2.2', data, installer), first); assert.equal(calls, 1);
  assert.throws(() => installRelease('0.2.3', data, () => ({ status: 1, stderr: 'offline' })), /offline/);
  assert.ok(existsSync(first));
  assert.deepEqual(readdirSync(join(data, 'releases')), ['0.2.2']);
  assert.equal(readFileSync(join(state, 'model.env'), 'utf8'), 'SYNTHETIC_TEST_VALUE=private\n');
});
test('registered live controllers and unresolved executor fences defer updates', t => {
  const home = temporary(t), state = join(home, 'runtime'); mkdirSync(state);
  registerInstallation(state, home); assert.deepEqual(busyInstallations(home), []);
  writeFileSync(join(state, 'supervisor.json'), JSON.stringify({ pid: process.pid }));
  assert.deepEqual(busyInstallations(home), [state]);
  rmSync(join(state, 'supervisor.json'));
  mkdirSync(join(state, 'jobs/job_one'), { recursive: true });
  writeFileSync(join(state, 'jobs/job_one/active.json'), '{}');
  assert.deepEqual(busyInstallations(home), [state]);
});
