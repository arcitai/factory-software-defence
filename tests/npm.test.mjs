import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,readFileSync,readdirSync,rmSync,existsSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';
const root=fileURLToPath(new URL('../',import.meta.url));
test('real tarball installs offline, includes native history utilities, and exports the portable method',async t=>{
 const scratch=mkdtempSync(join(tmpdir(),'factory-pack-'));
 t.after(()=>rmSync(scratch,{recursive:true,force:true}));
 const npm=(args,cwd=root)=>execFileSync('npm',args,{cwd,encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:60000});
 const [packed]=JSON.parse(npm(['pack','--json','--ignore-scripts','--pack-destination',scratch]));
 assert.equal(packed.name,'factory-software-defence');
 const paths=packed.files.map(file=>file.path);
 assert.ok(paths.includes('node_modules/@anthropic-ai/claude-agent-sdk/sdk.mjs'));
 assert.ok(paths.includes('node_modules/@anthropic-ai/claude-agent-sdk/README.md'));
 assert.ok(!paths.some(path=>/node_modules\/@anthropic-ai\/claude-agent-sdk-(linux|darwin|win32)/.test(path)),'Factory does not distribute another Claude executable');
 for(const retired of ['factory/queue.mjs','factory/executor.mjs','factory/pins.json','bin/legacy.mjs','factory/updates.mjs','factory/image/Dockerfile'])assert.ok(!paths.includes(retired),retired);
 const prefix=join(scratch,'install');mkdirSync(prefix);
 npm(['install','--prefix',prefix,'--offline','--ignore-scripts','--no-audit','--no-fund',join(scratch,packed.filename)],scratch);
 const installed=join(prefix,'node_modules','factory-software-defence');
 assert.ok(existsSync(join(installed,'node_modules','yaml','package.json')));
 const profile=join(scratch,'claude-profile');mkdirSync(profile,{mode:0o700});
 const history=JSON.parse(execFileSync(process.execPath,[join(installed,'factory/native/claude-history.mjs'),JSON.stringify({session:'00000000-0000-4000-8000-000000000000',dir:root,input:'input'})],
  {encoding:'utf8',env:{PATH:process.env.PATH,HOME:scratch,CLAUDE_CONFIG_DIR:profile}}));
 assert.equal(history.session,null);assert.equal(history.input,null);
 assert.deepEqual(readdirSync(profile),[],'reading missing history does not create a conversation');
 execFileSync(process.execPath,['--input-type=module','-e',`await import(${JSON.stringify(pathToFileURL(join(installed,'factory/native/server.mjs')).href)})`],{encoding:'utf8'});
 const {serviceManifest,pinInstalledRuntime}=await import(pathToFileURL(join(installed,'factory/native/service.mjs')));
 const state=join(scratch,'service-state');mkdirSync(state);
 const runtime=pinInstalledRuntime(state,{root:installed,version:packed.version});
 const manifest=serviceManifest({state,config:{repo:root,node:process.execPath},root:installed,runtime});
 const unit=join(scratch,manifest.unit);writeFileSync(unit,manifest.definition);
 execFileSync('systemd-analyze',['--user','verify',unit],{encoding:'utf8'});
 assert.equal(existsSync(join(runtime,'node_modules','.bin')),false);
 execFileSync(manifest.verification[0],manifest.verification.slice(1),{encoding:'utf8'});
 const cli=join(installed,'bin/software-defence-factory.mjs');
 const installedPackage=JSON.parse(readFileSync(join(installed,'package.json'),'utf8'));
 assert.equal(installedPackage.bin['factory-software-defence'],installedPackage.bin.factory);
 assert.equal(installedPackage.bin['software-defence-factory'],installedPackage.bin.factory);
 assert.equal(JSON.parse(execFileSync(process.execPath,[cli,'runtime','--state',join(scratch,'unused-state')],{encoding:'utf8'})).package,packed.name);
 assert.equal(execFileSync(process.execPath,[cli,'--version'],{encoding:'utf8'}).trim(),packed.version);
 assert.match(execFileSync(process.execPath,[cli,'foundation'],{encoding:'utf8'}),/Factory Foundation/);
 assert.match(execFileSync(process.execPath,[cli,'help'],{encoding:'utf8'}),/updates check --channel latest\|next/);
 assert.throws(()=>execFileSync(process.execPath,[cli,'updates','check','--channel','unknown'],{encoding:'utf8',stdio:['ignore','pipe','pipe']}),error=>error.status===1&&/Choose the release channel explicitly/.test(error.stderr));
 const staged=join(scratch,'kit');execFileSync(process.execPath,[cli,'kit','--output',staged]);
 assert.equal(readdirSync(join(staged,'.agents','skills')).length,6);
 const walk=dir=>readdirSync(dir,{withFileTypes:true}).flatMap(entry=>entry.name==='node_modules'?[]:entry.isDirectory()?walk(join(dir,entry.name)):[join(dir,entry.name)]);
 for(const file of walk(installed).filter(file=>file.endsWith('.md'))) {
  for(const [,raw] of readFileSync(file,'utf8').matchAll(/\]\(([^)]+)\)/g)) {
   const link=raw.split('#')[0].split(' "')[0];
   if(!link||link.includes(':')||link.startsWith('/'))continue;
   const target=fileURLToPath(new URL(link,pathToFileURL(file)));
   assert.ok(existsSync(target),`${file.slice(installed.length+1)} -> ${link}`);
  }
 }
});
