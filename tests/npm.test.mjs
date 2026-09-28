import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,readFileSync,readdirSync,rmSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';
const root=fileURLToPath(new URL('../',import.meta.url));
test('real tarball installs offline, carries yaml and documentation, and exports the portable method',t=>{
 const scratch=mkdtempSync(join(tmpdir(),'factory-pack-'));
 t.after(()=>rmSync(scratch,{recursive:true,force:true}));
 const npm=(args,cwd=root)=>execFileSync('npm',args,{cwd,encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:60000});
 const [packed]=JSON.parse(npm(['pack','--json','--ignore-scripts','--pack-destination',scratch]));
 assert.equal(packed.name,'software-defence-factory');
 const paths=packed.files.map(file=>file.path);
 for(const retired of ['factory/queue.mjs','factory/executor.mjs','factory/pins.json','bin/legacy.mjs','factory/updates.mjs','factory/image/Dockerfile'])assert.ok(!paths.includes(retired),retired);
 const prefix=join(scratch,'install');mkdirSync(prefix);
 npm(['install','--prefix',prefix,'--offline','--ignore-scripts','--no-audit','--no-fund',join(scratch,packed.filename)],scratch);
 const installed=join(prefix,'node_modules','software-defence-factory');
 assert.ok(existsSync(join(installed,'node_modules','yaml','package.json')));
 execFileSync(process.execPath,['--input-type=module','-e',`await import(${JSON.stringify(pathToFileURL(join(installed,'factory/native/server.mjs')).href)})`],{encoding:'utf8'});
 const cli=join(installed,'bin/software-defence-factory.mjs');
 assert.equal(execFileSync(process.execPath,[cli,'--version'],{encoding:'utf8'}).trim(),packed.version);
 assert.match(execFileSync(process.execPath,[cli,'foundation'],{encoding:'utf8'}),/Factory Foundation/);
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
