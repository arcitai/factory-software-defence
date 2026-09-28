import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,rmSync,readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { parseTemplate,compileTemplate,readTemplates,draftFromTemplate } from '../factory/issue-templates.mjs';
const sha='a'.repeat(40);
const form=`name: Example
labels: [track:security]
body:
  - type: markdown
    attributes:
      value: '<script>untrusted guidance</script>'
  - type: input
    id: summary
    attributes:
      label: Summary
    validations:
      required: true
  - type: textarea
    id: evidence
    attributes:
      label: Evidence
      value: Supplied logs only
  - type: dropdown
    id: scope
    attributes:
      label: Scope
      options: [Sandbox, Production]
      default: 0
  - type: dropdown
    id: hosts
    attributes:
      label: Hosts
      options: [One, Two]
      multiple: true
    validations:
      required: true
  - type: checkboxes
    id: boundary
    attributes:
      label: Boundary
      options:
        - label: Supplied evidence only
          required: true
        - label: No production changes
`;
const valid={title:'Inspect supplied evidence',answers:{summary:'Investigate suspicious access',hosts:['One'],boundary:['Supplied evidence only']}};

test('repository form defaults and required input, dropdown and checkbox semantics compile into a bounded draft',()=>{
  const template=parseTemplate('incident.yml',form,sha);
  assert.equal(template.fields[0].value,'<script>untrusted guidance</script>');
  const draft=compileTemplate(template,valid);
  assert.match(draft.spec,/### Scope\n\nSandbox/);assert.match(draft.spec,/\[x\] Supplied evidence only/);assert.match(draft.spec,/\[ \] No production changes/);
  assert.equal(draft.recommendation.workflow,'defensive');assert.deepEqual(draft.template,{id:'incident.yml',sha});
  for(const answers of [{...valid.answers,summary:''},{...valid.answers,hosts:[]},{...valid.answers,hosts:['Outside']},{...valid.answers,boundary:[]},{...valid.answers,scope:'Outside'}])assert.throws(()=>compileTemplate(template,{...valid,answers}));
  assert.throws(()=>compileTemplate(template,{...valid,title:''}),/title/);
  assert.throws(()=>compileTemplate(template,{...valid,answers:{...valid.answers,summary:'x'.repeat(240001)}}),/Invalid/);
});

test('Markdown templates retain headings and literal body; malformed and unsupported forms are not silently weakened',()=>{
  const template=parseTemplate('bug.md','---\nname: Bug\nabout: Describe a bug\nlabels: bug, track:software\n---\n### Expected\n\nFill this in',sha);
  assert.equal(template.description,'Describe a bug');assert.deepEqual(template.labels,['bug','track:software']);
  assert.match(compileTemplate(template,{title:'Fix bug',answers:{body:'Literal <img src=x> instructions'}}).spec,/<img src=x>/);
  for(const source of [form.replace('type: input','type: upload'),form.replace('id: summary','id: __proto__'),form.replace('id: evidence','id: summary'),'name: a\nname: b\nbody: []'])assert.throws(()=>parseTemplate('bug.yml',source,sha));
  for(const file of ['bug-report.yml','feature-request.yml','factory-task.yml'])assert.ok(parseTemplate(file,readFileSync(`.github/ISSUE_TEMPLATE/${file}`,'utf8'),sha).fields.length);
});

test('template reads are repository scoped, preserve contact links and refuse changed source before compiling',async t=>{
  const repo=mkdtempSync(join(tmpdir(),'sdf-templates-'));t.after(()=>rmSync(repo,{recursive:true,force:true}));
  execFileSync('git',['init',repo],{stdio:'ignore'});execFileSync('git',['-C',repo,'remote','add','origin','https://github.com/example/project.git']);
  const file=(source)=>({type:'file',encoding:'base64',size:Buffer.byteLength(source),content:Buffer.from(source).toString('base64'),sha});
  const read=async args=>{
    const path=args[3];assert.ok(path.startsWith('repos/example/project/contents/.github/ISSUE_TEMPLATE'));
    if(path.endsWith('/ISSUE_TEMPLATE'))return [{type:'file',name:'incident.yml'},{type:'file',name:'config.yml'},{type:'symlink',name:'ignored.yml'}];
    if(path.endsWith('/config.yml'))return file('contact_links:\n  - name: Private security\n    url: https://github.com/example/project/security/policy\n    about: Keep findings private');
    return file(form);
  };
  const result=await readTemplates(repo,read);assert.equal(result.templates.length,1);assert.equal(result.contacts.length,1);assert.deepEqual(result.warnings,[]);
  assert.equal((await draftFromTemplate(repo,{...valid,template:'incident.yml',sha},read)).recommendation.workflow,'defensive');
  await assert.rejects(draftFromTemplate(repo,{...valid,template:'incident.yml',sha:'b'.repeat(40)},read),/changed/);
  await assert.rejects(draftFromTemplate(repo,{...valid,template:'../secret.yml',sha},read),/Choose/);
  let reads=0;
  const missing=await readTemplates(repo,async()=>{if(++reads===1)throw Object.assign(new Error('Not found'),{status:404});return {name:'project'};});
  assert.equal(reads,2);assert.deepEqual(missing.templates,[]);
  await assert.rejects(readTemplates(repo,async()=>{throw Object.assign(new Error('No access'),{status:404});}),/No access/);
});

test('render textareas use safe code fences so embedded Markdown retains literal formatting',()=>{
  const template=parseTemplate('logs.yml','name: Logs\nbody:\n  - type: textarea\n    id: logs\n    attributes:\n      label: Logs\n      render: shell\n',sha);
  const draft=compileTemplate(template,{title:'Inspect logs',answers:{logs:'```\n# not a heading\n```'}});
  assert.equal(draft.spec,'# Inspect logs\n\n### Logs\n\n````shell\n```\n# not a heading\n```\n````');
});
