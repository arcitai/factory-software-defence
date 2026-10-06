import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

test('0.18 candidate bundles its parsers and native history reader for installed use',()=>{
  const pkg=JSON.parse(readFileSync(new URL('../package.json',import.meta.url),'utf8'));
  const lock=JSON.parse(readFileSync(new URL('../package-lock.json',import.meta.url),'utf8'));
  assert.equal(pkg.name,'factory-software-defence');assert.equal(lock.name,pkg.name);
  assert.equal(lock.packages[''].name,pkg.name);
  assert.match(pkg.version,/^0\.18\.\d+$/);assert.equal(lock.version,pkg.version);
  assert.equal(lock.packages[''].version,pkg.version);
  assert.equal(pkg.publishConfig.tag,'next');
  assert.deepEqual(pkg.bundleDependencies,['yaml','@anthropic-ai/claude-agent-sdk']);
  assert.equal(pkg.dependencies.yaml,'2.9.1');
  assert.equal(pkg.dependencies['@anthropic-ai/claude-agent-sdk'],'0.3.289');
  assert.equal(pkg.bin.factory,'bin/software-defence-factory.mjs');
  assert.equal(pkg.bin['factory-software-defence'],pkg.bin.factory);
  assert.equal(pkg.bin['software-defence-factory'],pkg.bin.factory);
  assert.deepEqual(lock.packages[''].bin,pkg.bin);
  assert.equal(pkg.files.includes('config/'),false);
  assert.equal(existsSync(new URL('../bin/legacy.mjs',import.meta.url)),false);
  assert.equal(existsSync(new URL('../factory/ui/index.html',import.meta.url)),true);
});
