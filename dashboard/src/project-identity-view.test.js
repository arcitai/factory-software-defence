import assert from "node:assert/strict";
import test from "node:test";
import { act } from "react";
import { JSDOM } from "jsdom";
import { createServer } from "vite";

test("project identity stays visible, app keeps its submission key, and stale or missing status is labeled", async (context) => {
  const dom = new JSDOM('<div id="root"></div>', { url: "http://localhost/#/runs" });
  dom.window.scrollTo = () => {};
  dom.window.HTMLDialogElement.prototype.showModal = function() { this.open = true; };
  const priorGlobals = new Map();
  for (const name of ["window", "document", "navigator", "localStorage", "Event", "MouseEvent"]) {
    priorGlobals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value: dom.window[name] });
  }

  const pendingPolls = new Map();
  const nativeSetTimeout = dom.window.setTimeout.bind(dom.window);
  const nativeClearTimeout = dom.window.clearTimeout.bind(dom.window);
  let nextTimerId = 1;
  dom.window.setTimeout = (callback, delay, ...args) => {
    if (delay === 2000) {
      const id = nextTimerId++;
      pendingPolls.set(id, () => callback(...args));
      return id;
    }
    return nativeSetTimeout(callback, delay, ...args);
  };
  dom.window.clearTimeout = (id) => {
    pendingPolls.delete(id);
    return nativeClearTimeout(id);
  };

  const firstStatus = deferred();
  const repo = "/srv/operators/workspaces/customer-portal-with-a-long-parent-directory-name/customer-portal/";
  const createdJob = {
    id: "job_created", state: "queued", repository: "app", command: "build",
    workflow: { name: "software", steps: ["build"], current_step: 0 },
    task: { title: "Project identity task", spec: "Add the project label." },
    created_at: "2026-09-25T10:00:00.000Z", updated_at: "2026-09-25T10:00:00.000Z",
    runs: [{ id: "run_created", command: "build", state: "queued" }],
  };
  const baseStatus = {
    jobs: [], workers: [{ name: "fixture-worker", instance_id: "fixture", repositories: ["app"], connected: true }],
    commands: [], workflows: ["software", "defence"], repositories: ["app"], triggers: [],
    csrf_token: "test-session", agent: "mock", repo,
  };
  let statusCalls = 0;
  let submitted;
  priorGlobals.set("fetch", Object.getOwnPropertyDescriptor(globalThis, "fetch"));
  globalThis.fetch = async (url, options) => {
    if (url === "/api/v1/status") {
      statusCalls += 1;
      if (statusCalls === 1) return firstStatus.promise;
      if (statusCalls === 2) return jsonResponse(baseStatus);
      if (statusCalls === 3) return jsonResponse({ ...baseStatus, jobs: [createdJob] });
      if (statusCalls === 4) {
        const { repo: _repo, ...missingIdentity } = baseStatus;
        return jsonResponse(missingIdentity);
      }
      if (statusCalls === 5) return jsonResponse({ ...baseStatus, jobs: [createdJob] });
      throw new Error("status connection lost");
    }
    if (url === "/api/v1/intake/recommend") return jsonResponse({workflow:"software",reason:"Project change",basis:"default"});
    if (url === "/api/v1/jobs" && options?.method === "POST") {
      submitted = JSON.parse(options.body);
      return jsonResponse({ id: createdJob.id });
    }
    if (url === "/api/v1/definitions") {
      return jsonResponse({ workflows: { software: [{ name: "build" }] }, commands: [] });
    }
    if (url.endsWith("/artifacts")) return jsonResponse([]);
    if (url.endsWith("/content")) return { ok: true, text: async () => "" };
    throw new Error(`Unexpected request: ${url}`);
  };

  const server = await createServer({ server: { middlewareMode: true, ws: false }, appType: "custom" });
  let mountedRoot;
  context.after(async () => {
    const previousActEnvironment = globalThis.IS_REACT_ACT_ENVIRONMENT;
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    await act(async () => mountedRoot?.unmount());
    globalThis.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
    await server.close();
    dom.window.close();
    for (const [name, descriptor] of priorGlobals) {
      if (descriptor === undefined) delete globalThis[name];
      else Object.defineProperty(globalThis, name, descriptor);
    }
  });

  mountedRoot = (await server.ssrLoadModule("/src/main.jsx")).appRoot;
  await eventually(() => assert.match(projectContext().textContent, /Loading configured project/));
  assert.match(projectContext().textContent, /Loading status/);
  await eventually(() => assert.ok(document.querySelector('button[aria-label="Filter by statuses"]')));

  await eventually(() => assert.equal(statusCalls, 1));
  firstStatus.reject(new Error("initial status connection lost"));
  await eventually(() => assert.match(projectName().textContent, /Project identity unavailable/));
  assert.match(projectContext().textContent, /Status unavailable/);
  assert.equal(document.querySelector('button[aria-label="Filter by statuses"]').disabled, true);

  await eventually(() => assert.match(document.body.textContent, /initial status connection lost/));
  await runNextPoll();
  await eventually(() => assert.equal(projectName().textContent, "customer-portal"));
  assert.equal(projectContext().querySelector('[role="tooltip"]').textContent.includes(repo), true, "full configured path remains available as detail");
  assert.match(document.body.textContent, /Synthetic installation demo — no model calls\./);

  button("New issue").click();
  await eventually(() => assert.ok(document.querySelector("form")));
  const repositoryOption = document.querySelector('#start-work-description');
  assert.ok(repositoryOption, "the configured repository option is present");
  assert.match(repositoryOption.textContent, /customer-portal/);

  document.querySelector('[data-blank-issue]').click();
  await eventually(() => assert.ok(document.querySelector('input[name="issue-title"]')));
  const titleInput=document.querySelector('input[name="issue-title"]');
  Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype,'value').set.call(titleInput,'Project identity task');
  titleInput.dispatchEvent(new dom.window.Event('input',{bubbles:true}));
  const prompt = document.querySelector("textarea");
  const setTextareaValue = Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype, "value").set;
  setTextareaValue.call(prompt, "Add the project label.");
  prompt.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  button("Continue").click();
  await eventually(() => assert.ok(button("Start local execution")));
  button("Start local execution").click();
  await eventually(() => assert.ok(submitted));
  assert.equal(submitted.repository, "app", "the readable label does not replace the controller key");
  assert.equal(submitted.workflow, "software");
  assert.equal(submitted.spec, "Add the project label.");
  await eventually(() => assert.match(document.body.textContent, /Project identity task/));
  assert.equal(projectName().textContent, "customer-portal");

  window.location.hash = "#/workers";
  await eventually(() => assert.match(document.body.textContent, /Infrastructure/));
  assert.equal(projectName().textContent, "customer-portal");

  window.location.hash = "#/workflows";
  await eventually(() => assert.match(document.body.textContent, /Agents/));
  assert.equal(projectName().textContent, "customer-portal");

  await runNextPoll();
  await eventually(() => assert.match(projectName().textContent, /Project identity unavailable/));
  assert.match(projectContext().textContent, /Status current/);
  window.location.hash = "#/runs";
  await eventually(() => assert.ok(projectContext().querySelector(".new-issue-action"), "return completes before using the project action"));
  button("New issue").click();
  await eventually(() => assert.match(document.querySelector('#start-work-description').textContent, /Project identity unavailable/));
  document.querySelector('button[aria-label="Close start work form"]').click();

  await runNextPoll();
  await eventually(() => assert.equal(projectName().textContent, "customer-portal"));

  await runNextPoll();
  await eventually(() => assert.match(projectContext().textContent, /Status stale/));
  assert.equal(projectName().textContent, "customer-portal", "last known identity remains visible but is marked stale");
  window.location.hash = "#/runs/job_created";
  await eventually(() => assert.ok(document.querySelector('[aria-label="Issue details"]')));
  assert.match(projectContext().textContent,/Status stale/);
  assert(projectContext().querySelector('[role="tooltip"]').textContent.includes(repo));
  await eventually(() => assert.match(document.body.textContent, /status connection lost/));

  async function runNextPoll() {
    const next = pendingPolls.entries().next();
    assert.equal(next.done, false, "a status refresh is scheduled");
    const [id, callback] = next.value;
    pendingPolls.delete(id);
    await callback();
  }

  function projectContext() {
    const element = document.querySelector('[aria-label="Configured project"]');
    assert.ok(element, "the project context is always present");
    return element;
  }

  function projectName() { return projectContext().querySelector("h1"); }

  function button(label) {
    const match = [...document.querySelectorAll("button")].find((element) => element.textContent.includes(label));
    assert.ok(match, `button ${label} should exist`);
    return match;
  }
});

function jsonResponse(value) { return { ok: true, json: async () => value }; }

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => { resolve = resolvePromise; reject = rejectPromise; });
  return { promise, resolve, reject };
}

async function eventually(assertion) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try { assertion(); return; } catch (error) {
      if (attempt === 99) throw error;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
}
