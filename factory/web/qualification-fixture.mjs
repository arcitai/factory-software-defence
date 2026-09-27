import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { runCandidateGit } from '../git-environment.mjs';

const STORIES = [
  { id: 'desktop-light', viewport: 'desktop', theme: 'light', path: '/', steps: [
    { op: 'click', role: 'button', name: 'Save' },
    { op: 'expect-text', role: 'status', name: 'Save status', text: 'Saved' },
    { op: 'expect-text', role: 'status', name: 'Theme status', text: 'Light' },
  ] },
  { id: 'narrow-light', viewport: 'narrow', theme: 'light', path: '/', steps: [
    { op: 'click', role: 'button', name: 'Save' },
    { op: 'expect-text', role: 'status', name: 'Save status', text: 'Saved' },
    { op: 'expect-text', role: 'status', name: 'Theme status', text: 'Light' },
  ] },
  { id: 'desktop-dark', viewport: 'desktop', theme: 'dark', path: '/', steps: [
    { op: 'click', role: 'button', name: 'Save' },
    { op: 'expect-text', role: 'status', name: 'Save status', text: 'Saved' },
    { op: 'expect-text', role: 'status', name: 'Theme status', text: 'Dark' },
  ] },
  { id: 'narrow-dark', viewport: 'narrow', theme: 'dark', path: '/', steps: [
    { op: 'click', role: 'button', name: 'Save' },
    { op: 'expect-text', role: 'status', name: 'Save status', text: 'Saved' },
    { op: 'expect-text', role: 'status', name: 'Theme status', text: 'Dark' },
  ] },
  { id: 'busy-disabled', viewport: 'desktop', theme: 'light', path: '/', steps: [
    { op: 'click', role: 'button', name: 'Save' },
    { op: 'expect-disabled', role: 'button', name: 'Save' },
    { op: 'expect-enabled', role: 'button', name: 'Save' },
    { op: 'expect-text', role: 'status', name: 'Save status', text: 'Saved' },
  ] },
  { id: 'result', viewport: 'desktop', theme: 'light', path: '/', steps: [
    { op: 'click', role: 'button', name: 'Save' },
    { op: 'expect-text', role: 'status', name: 'Save status', text: 'Saved' },
  ] },
  { id: 'failure-retry', viewport: 'desktop', theme: 'light', path: '/', steps: [
    { op: 'click', role: 'button', name: 'Load records' },
    { op: 'expect-text', role: 'alert', name: 'Load error', text: 'Temporary failure' },
    { op: 'click', role: 'button', name: 'Retry' },
    { op: 'expect-text', role: 'status', name: 'Load status', text: 'Loaded' },
  ] },
  { id: 'keyboard-focus', viewport: 'desktop', theme: 'light', path: '/', steps: [
    { op: 'press', key: 'Tab' },
    { op: 'expect-focused', role: 'button', name: 'Save' },
  ] },
];

const HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Factory browser qualification fixture</title>
<style>body{font:16px system-ui;margin:2rem;background:#fff;color:#111}button{padding:.7rem 1rem;margin:.4rem}@media(prefers-color-scheme:dark){body{background:#161616;color:#fff}}</style></head>
<body><main><h1>Browser fixture</h1>
<button id="save" type="button">Save</button><p id="save-status" role="status" aria-label="Save status"></p>
<p id="theme-status" role="status" aria-label="Theme status"></p>
<button id="load" type="button">Load records</button><p id="load-error" role="alert" aria-label="Load error"></p>
<button id="retry" type="button" hidden>Retry</button><p id="load-status" role="status" aria-label="Load status"></p>
<script>
const save=document.querySelector('#save'),saveStatus=document.querySelector('#save-status');
save.addEventListener('click',async()=>{save.disabled=true;saveStatus.textContent='Saving…';await new Promise(resolve=>setTimeout(resolve,250));save.disabled=false;saveStatus.textContent='Saved';});
document.querySelector('#theme-status').textContent=matchMedia('(prefers-color-scheme: dark)').matches?'Dark':'Light';
const error=document.querySelector('#load-error'),retry=document.querySelector('#retry');
document.querySelector('#load').addEventListener('click',()=>{error.textContent='Temporary failure';retry.hidden=false;});
retry.addEventListener('click',()=>{error.textContent='';retry.hidden=true;document.querySelector('#load-status').textContent='Loaded';});
</script></main></body></html>`;

const SERVER = `import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
const broken = false;
let page = readFileSync(new URL('./index.html', import.meta.url), 'utf8');
if (broken) page = page.replace('save.disabled=true;', 'save.disabled=false;').replace("saveStatus.textContent='Saved';", "saveStatus.textContent='Not saved';");
createServer((request, response) => { response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); response.end(page); })
  .listen(Number(process.env.PORT || 4173), '127.0.0.1');
`;

export function qualificationWebConfig(image) {
  return {
    enabled: true, adapter: 'playwright', version: '1.63.0', image,
    previewCommand: ['node', 'server.mjs'], port: 4173, timeoutSeconds: 90,
    themes: ['light', 'dark'], stories: structuredClone(STORIES),
  };
}

export function initializeWebQualificationRepository(repo) {
  mkdirSync(repo, { recursive: true, mode: 0o700 });
  writeFileSync(join(repo, 'value.txt'), 'broken\n');
  writeFileSync(join(repo, 'index.html'), HTML);
  writeFileSync(join(repo, 'server.mjs'), SERVER);
  runCandidateGit(repo, 'init', '-b', 'main');
  runCandidateGit(repo, 'add', 'value.txt', 'index.html', 'server.mjs');
  runCandidateGit(repo, '-c', 'user.name=Factory web fixture', '-c', 'user.email=factory-web@localhost', 'commit', '-m', 'Passing delayed-action web fixture');
  runCandidateGit(repo, 'checkout', '-b', 'broken');
  const broken = SERVER.replace('const broken = false;', 'const broken = true;');
  writeFileSync(join(repo, 'server.mjs'), broken);
  runCandidateGit(repo, 'add', 'server.mjs');
  runCandidateGit(repo, '-c', 'user.name=Factory web fixture', '-c', 'user.email=factory-web@localhost', 'commit', '-m', 'Deliberately broken busy state and result');
  runCandidateGit(repo, 'checkout', 'main');
}
