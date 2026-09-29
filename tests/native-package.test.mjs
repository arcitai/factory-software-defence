import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

test('0.18 candidate is opt-in and ships only the native entrypoint with bundled yaml',()=>{
  const pkg=JSON.parse(readFileSync(new URL('../package.json',import.meta.url),'utf8'));
  const lock=JSON.parse(readFileSync(new URL('../package-lock.json',import.meta.url),'utf8'));
  assert.match(pkg.version,/^0\.18\.\d+$/);assert.equal(lock.version,pkg.version);
  assert.equal(lock.packages[''].version,pkg.version);
  assert.equal(pkg.publishConfig.tag,'next');
  assert.deepEqual(pkg.bundleDependencies,['yaml']);
  assert.equal(pkg.dependencies.yaml,'2.9.1');
  assert.equal(pkg.bin.factory,'bin/software-defence-factory.mjs');
  assert.equal(pkg.files.includes('config/'),false);
  assert.equal(existsSync(new URL('../bin/legacy.mjs',import.meta.url)),false);
  assert.equal(existsSync(new URL('../factory/ui/index.html',import.meta.url)),true);
});
