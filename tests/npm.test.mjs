import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { spawn, spawnSync } from 'node:child_process';
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
  for (const required of ['bin/software-defence-factory.mjs', 'factory/updates.mjs', 'factory/issue-templates.mjs', 'factory/intake.mjs', 'factory/definition.mjs', 'factory/terminology.json', '.agents/skills/factory-foundation/SKILL.md', 'docs/concepts.md', 'factory/paths.mjs', 'factory/image/Dockerfile', 'kit/policy.md', 'docs/setup.md', 'docs/services.md', 'kit/skills/factory-implement/SKILL.md', 'scripts/export-kit.mjs', 'scripts/retained-source-fixture.mjs', 'LICENSE']) assert.ok(names.includes(required), required);
  assert.ok(names.every(path => !/^(?:\.factory|\.git\/|tests\/|experiments\/|evals\/|node_modules\/)|(?:^|\/)\.env(?:\.|$)/.test(path)));
  const runtimeIDs = ['factory-evaluate', 'factory-implement', 'factory-review', 'factory-security', 'factory-spec', 'factory-triage'];
  assert.deepEqual(names.filter(path => path.endsWith('/SKILL.md')).sort(),
    ['.agents/skills/factory-foundation/SKILL.md', ...runtimeIDs.map(id => `kit/skills/${id}/SKILL.md`)].sort());
  assert(!names.some(path => path.startsWith('operator-skills/')));
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
  const definition = JSON.parse(originalDefinition);
  assert.deepEqual(JSON.parse(run(['skills'])), { agents: definition.skills, operators: definition.operator_skills });
  assert.deepEqual(definition.skills.map(skill => skill.id).sort(), runtimeIDs);
  assert.equal(definition.operator_skills.length, 1);
  for (const skill of [...definition.skills, ...definition.operator_skills]) {
    assert.equal(skill.path, `${skill.id === 'factory-foundation' ? '.agents' : 'kit'}/skills/${skill.id}/SKILL.md`);
    const content = readFileSync(join(packageRoot, skill.path), 'utf8');
    assert.equal(skill.content, content);
    assert.equal(skill.sha256, createHash('sha256').update(content).digest('hex'));
    assert.equal(content, readFileSync(join(root, skill.path), 'utf8'));
    for (const [, target] of content.matchAll(/\]\(([^\s)]+)\)/g)) {
      if (/^[a-z]+:|^#/i.test(target)) continue;
      assert(existsSync(resolve(dirname(join(packageRoot, skill.path)), target.split('#')[0])), `${skill.path}: ${target}`);
    }
  }
  assert.equal(run(['foundation']).trim(), definition.operator_skills[0].content.trim());
  assert.equal(legacy(['definition']), originalDefinition);
  // Serve the installed bundle through the real controller without running jobs.
  const { createController } = await import(pathToFileURL(join(packageRoot, 'factory/server.mjs')).href);
  const controller = createController(state);
  try {
    await new Promise(resolve => controller.server.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${controller.server.address().port}`;
    // Installed CLI/API use the packaged reader, with finite synthetic retained
    // observations only. This does not qualify Docker or an inference provider.
    const originalConfigBytes = readFileSync(join(state, 'factory.json'));
    writeFileSync(join(state, 'factory.json'), JSON.stringify({ ...configured, port: controller.server.address().port }));
    const { ActivityWriter } = await import(pathToFileURL(join(packageRoot, 'factory/activity.mjs')).href);
    const attempt = { id: 'run_ab', command: 'build', state: 'cancelled', started_at: '2026-09-28T00:00:00.000Z' };
    const activityJob = { id: 'job_ab', state: 'cancelled', created_at: attempt.started_at,
      workflow: { name: 'software', steps: ['build'], current_step: 0 }, runs: [attempt] };
    controller.queue.save(activityJob);
    const activityFolder = join(state, 'jobs', activityJob.id, attempt.id);
    mkdirSync(activityFolder, { recursive: true, mode: 0o700 });
    const writer = new ActivityWriter(activityFolder, { job: activityJob.id, attempt: attempt.id, phase: 'build', harness: 'pi' });
    writer.parser.write(Buffer.from(JSON.stringify({type:'tool_execution_end',toolName:'read',result:'PRIVATE_PACKAGE_SENTINEL'})+'\n'));
    await writer.finish(false);
    const activityPage = await (await fetch(origin + '/api/v1/jobs/job_ab/runs/run_ab/activity?after=1', {
      headers: { Authorization: `Bearer ${readFileSync(join(state, 'worker.token'), 'utf8').trim()}` },
    })).json();
    const activityCLI = await new Promise((resolve, reject) => {
      const child = spawn(bins[0], ['activity', 'job_ab', 'run_ab', '--state', state, '--after', '1', '--follow'], { cwd: dir, env: environment });
      let out = '', err = '';
      child.stdout.on('data', bytes => out += bytes); child.stderr.on('data', bytes => err += bytes);
      child.on('error', reject); child.on('close', code => code === 0 ? resolve(JSON.parse(out)) : reject(new Error(err)));
    });
    assert.deepEqual(activityCLI.events, activityPage.events);
    assert.deepEqual(activityCLI.events.map(event => event.kind), ['tool_completed', 'phase_error']);
    assert.equal(activityCLI.next_cursor, 3); assert.equal(activityCLI.terminal, true);
    assert(!JSON.stringify(activityCLI).includes('PRIVATE_PACKAGE_SENTINEL'));
    writeFileSync(join(state, 'factory.json'), originalConfigBytes);

    assert.deepEqual(await (await fetch(origin + '/api/v1/definitions')).json(), definition);
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
  const piConfig = JSON.parse(readFileSync(join(secondState,'factory.json')));
  assert.equal(piConfig.harness,'pi');
  assert.deepEqual(piConfig.command, ['pi','--mode','json','--print','--no-session','--no-extensions','--skill','/factory-skills']);
  assert.equal(spawnSync(process.execPath,[cli,'init','--repo',repo,'--state',join(dir,'conflict'),'--harness','pi','--agent','codex'],{env:environment}).status,1);
  assert.equal(command('git', ['-C', repo, 'status', '--porcelain']), '');
  assert.equal(existsSync(join(packageRoot, '.factory')), false);
  assert.equal(spawnSync(process.execPath, [cli, 'init', '--repo', repo], { env: environment }).status, 1);
  run(['kit', '--output', join(dir, 'method')]);
  assert.equal(readdirSync(join(dir, 'method/.agents/skills')).length, 6);
  const manifest = JSON.parse(readFileSync(join(dir, 'method/.factory-kit/manifest.json')));
  for (const skill of definition.skills) {
    const path = `.agents/skills/${skill.id}/SKILL.md`;
    assert.equal(readFileSync(join(dir, 'method', path), 'utf8'), skill.content);
    assert.equal(manifest.files.find(file => file.path === path).sha256, skill.sha256);
  }
  assert(!existsSync(join(dir, 'method/.agents/skills/factory-foundation')));
  const beforeExport = readFileSync(join(dir, 'method/.factory-kit/manifest.json'));
  assert.equal(spawnSync(bins[0], ['kit', '--output', join(dir, 'method')], { env: environment }).status, 1);
  assert.deepEqual(readFileSync(join(dir, 'method/.factory-kit/manifest.json')), beforeExport);
  writeFileSync(join(repo, 'AGENTS.md'), 'Application instructions stay intact\n');
  assert.equal(spawnSync(bins[0], ['kit', '--output', repo], { env: environment }).status, 1);
  assert.equal(readFileSync(join(repo, 'AGENTS.md'), 'utf8'), 'Application instructions stay intact\n');
  assert(!existsSync(join(repo, '.agents')));
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

function downloadFixture(t) {
  const home = temporary(t), data = join(home, 'data');
  const packageAt = (prefix, version = '0.15.1', name = 'software-defence-factory') => {
    const pkg = join(prefix, 'node_modules/software-defence-factory');
    mkdirSync(join(pkg, 'bin'), { recursive: true });
    writeFileSync(join(pkg, 'package.json'), JSON.stringify({ name, version }));
    writeFileSync(join(pkg, 'bin/software-defence-factory.mjs'), '// controlled package fixture\n');
  };
  packageAt(join(data, 'releases/0.15.0'), '0.15.0');
  mkdirSync(join(data, 'releases/.download-unrelated'));
  const retained = ['updates.json', 'service-release.json', 'factory.json', 'jobs.json'].map(name => join(home, name));
  for (const path of retained) writeFileSync(path, '{"version":"0.15.0","fixture":"retained"}\n');
  let elapsed = 0;
  const waits = [], timeouts = [];
  const timing = { now: () => elapsed, sleep: ms => { waits.push(ms); elapsed += ms; } };
  const runner = outcome => (name, args, options) => {
    assert.equal(name, 'npm');
    assert.equal(args.at(-1), 'software-defence-factory@0.15.1');
    assert.equal(args[args.indexOf('--registry') + 1], 'https://registry.npmjs.org');
    assert(args.includes('--ignore-scripts'));
    assert.equal(options.killSignal, 'SIGKILL');
    assert(options.timeout > 0 && elapsed + options.timeout <= 120000);
    timeouts.push(options.timeout);
    const prefix = args[args.indexOf('--prefix') + 1];
    assert(prefix.startsWith(join(data, 'releases/.download-')));
    return outcome({ args, options, prefix, attempt: timeouts.length });
  };
  const preserved = (success = false) => {
    assert.deepEqual(readdirSync(join(data, 'releases')).sort(),
      ['.download-unrelated', '0.15.0', ...(success ? ['0.15.1'] : [])]);
    assert.equal(JSON.parse(readFileSync(join(data, 'releases/0.15.0/node_modules/software-defence-factory/package.json'))).version, '0.15.0');
    for (const path of retained) assert.equal(readFileSync(path, 'utf8'), '{"version":"0.15.0","fixture":"retained"}\n');
  };
  return { data, packageAt, timing, waits, timeouts, runner, preserved, advance: ms => { elapsed += ms; } };
}
const invisibleRelease = { status: 1, stderr: 'npm error code ETARGET\nnpm error notarget No matching version found for software-defence-factory@0.15.1.' };

test('exact release download forces metadata freshness without changing process settings', t => {
  const f = downloadFixture(t), environment = { ...process.env };
  const entry = installRelease('0.15.1', f.data, f.runner(({ args, prefix }) => {
    // Controlled stale-cache behavior: the release exists only after revalidation.
    if (!args.includes('--prefer-online') || !args.includes('--prefer-offline=false')) return invisibleRelease;
    f.packageAt(prefix); return { status: 0 };
  }), f.timing);
  assert(existsSync(entry)); assert.equal(f.timeouts.length, 1);
  assert.deepEqual({ ...process.env }, environment); f.preserved(true);
});

test('delayed exact release visibility retries the same version and eventually adopts it', t => {
  const f = downloadFixture(t);
  const entry = installRelease('0.15.1', f.data, f.runner(({ prefix, attempt }) => {
    f.advance(200);
    if (attempt < 3) return invisibleRelease;
    f.packageAt(prefix); return { status: 0 };
  }), f.timing);
  assert(existsSync(entry)); assert.deepEqual(f.waits, [1000, 1000]);
  assert.deepEqual(f.timeouts, [120000, 118800, 117600]); f.preserved(true);
});

test('unavailable exact release exhausts three attempts and cleans only its own staging', t => {
  const f = downloadFixture(t);
  assert.throws(() => installRelease('0.15.1', f.data, f.runner(({ prefix }) => {
    writeFileSync(join(prefix, 'partial'), 'partial download'); return invisibleRelease;
  }), f.timing), /0\.15\.1.*not yet downloadable.*publication.*processing.*ETARGET/s);
  assert.equal(f.timeouts.length, 3); assert.deepEqual(f.waits, [1000, 1000]); f.preserved();
});

test('visibility retries share the original 120-second budget including waits', t => {
  for (const duration of [119500, 118500]) {
    const f = downloadFixture(t);
    assert.throws(() => installRelease('0.15.1', f.data, f.runner(({ options, attempt }) => {
      f.advance(attempt === 1 ? duration : options.timeout); return invisibleRelease;
    }), f.timing), /not yet downloadable/);
    assert.deepEqual(f.timeouts, duration === 119500 ? [120000] : [120000, 500]);
    assert.deepEqual(f.waits, duration === 119500 ? [] : [1000]); f.preserved();
  }
});

test('offline, authentication, spawn and identity errors do not get visibility retries', t => {
  for (const failure of [
    { result: { status: 1, stderr: 'npm error code ENOTFOUND registry offline' }, message: /ENOTFOUND/ },
    { result: { status: 1, stderr: 'npm error code E401 authentication required' }, message: /E401/ },
    { result: { status: 1, stderr: 'npm error code E404 not found' }, message: /E404/ },
    { result: { error: new Error('spawn npm ENOENT'), status: null }, message: /ENOENT/ },
    { result: { error: new Error('ETIMEDOUT'), status: null, stderr: invisibleRelease.stderr }, message: /ETIMEDOUT/ },
    { result: { status: 0 }, identity: ['0.15.0'], message: /identity/ },
    { result: { status: 0 }, identity: ['0.15.1', 'other-package'], message: /identity/ },
  ]) {
    const f = downloadFixture(t);
    assert.throws(() => installRelease('0.15.1', f.data, f.runner(({ prefix }) => {
      if (failure.identity) f.packageAt(prefix, ...failure.identity);
      else writeFileSync(join(prefix, 'partial'), 'partial download');
      return failure.result;
    }), f.timing), failure.message);
    assert.equal(f.timeouts.length, 1); assert.deepEqual(f.waits, []); f.preserved();
  }
});
