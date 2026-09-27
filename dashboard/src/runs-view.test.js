import assert from "node:assert/strict";
import test from "node:test";
import { act } from "react";
import { JSDOM } from "jsdom";
import { createServer } from "vite";

const jobs = [
  { id: "job_failed", state: "failed", task: { title: "Failed fixture", spec: "This task requests a compact review row." }, repository: "example/repo", command: "codex", created_at: "2026-01-01T00:00:00Z", updated_at: "2026-09-25T10:00:00Z", runs: [{ id: "run_failed", state: "failed", command: "codex" }] },
  { id: "job_succeeded", state: "succeeded", prompt: "Succeeded fixture", repository: "example/repo", command: "codex", created_at: "2026-01-01T00:00:00Z", updated_at: "2026-09-25T10:01:00Z", runs: [{ id: "run_succeeded", state: "succeeded", command: "codex" }] },
];

test("runs default to the searchable list and share state filters across board and list", async (context) => {
  const dom = new JSDOM('<div id="root"></div>', { url: "http://localhost/#/runs" });
  dom.window.scrollTo = () => {};
  dom.window.confirm = message => { assert.match(message,/Remove local execution/);assert.match(message,/repository issue is unchanged/);return true; };
  const priorGlobals = new Map();
  for (const name of ["window", "document", "navigator", "localStorage", "Event", "MouseEvent"]) {
    priorGlobals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value: dom.window[name] });
  }
  priorGlobals.set("fetch", Object.getOwnPropertyDescriptor(globalThis, "fetch"));
  let artifactRequests = 0;
  const detailJob = {
    id: "job_detail", state: "succeeded", repository: "example/repo", command: "build",
    task: { title: "Task with files", spec: "Build the feature" },
    created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:01:00Z",
    runs: [
      { id: "plan", command: "plan", state: "succeeded", outcome: "complete", summary: "Planned" },
      { id: "build", command: "build", state: "succeeded", outcome: "complete", summary: "Built", execution: {executor: "codex", requestedModel: "test-model", runtimeVersion: "test-runtime", image: "sha256:fixture", policyHash: "fixture"}, executor: "codex", model: "test-model", worker_name: "test-worker", duration_millis: 1000, exit_code: 0 },
    ],
  };
  const interruptedJob = { ...detailJob, id: "job_interrupted", state: "interrupted", workflow: { name: "build", steps: ["build"], current_step: 0 }, runs: [{ id: "interrupted", command: "build", state: "interrupted" }] };
  let cancelled = false;
  globalThis.fetch = async (url, options) => {
    if(options?.method === "DELETE")return {ok:false,json:async()=>({error:"Removal denied: delivery needs reconciliation"})};
    if (url.endsWith("/cancel") && options?.method === "POST") {
      cancelled = true;
      interruptedJob.state = "cancelled";
      return { ok: true, json: async () => ({}) };
    }
    if (url.endsWith("/artifacts")) {
      artifactRequests += 1;
      return { ok: true, json: async () => [
        { id: "file_plan", run_id: "plan", path: "plan.md", size: 10, content_type: "text/plain" },
        { id: "file_build", run_id: "build", path: "result.md", size: 10, content_type: "text/plain" },
      ] };
    }
    if (url.endsWith("/content")) return { ok: true, text: async () => "<script>literal file text</script>" };
    return { ok: true, json: async () => ({ jobs: [...jobs, detailJob, interruptedJob], workers: [], commands: [], repositories: [], triggers: [], csrf_token: "test" }) };
  };

  const server = await createServer({ server: { middlewareMode: true }, appType: "custom" });
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
  await eventually(() => assert.match(document.body.textContent, /Failed fixture/));

  assert.equal(button("List").getAttribute("aria-pressed"), "true");
  assert.ok(document.querySelector('a[href="#/runs/job_failed"]'), "list links to task");
  assert.equal(button("Board").getAttribute("aria-pressed"), "false");
  assert.ok(document.querySelector('time[title^="Last activity"]'));

  const search = document.querySelector('input[aria-label="Search loaded work"]');
  const setInputValue = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value").set;
  setInputValue.call(search, "compact");
  search.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  await eventually(() => assert.match(document.body.textContent, /Failed fixture/));
  assert.doesNotMatch(document.body.textContent, /Succeeded fixture/);
  button("Failed").click();
  await eventually(() => assert.equal(button("Failed").getAttribute("aria-pressed"), "true"));
  assert.ok(document.querySelector('a[href="#/runs/job_failed"]'), "search and failed-state filters intersect");

  setInputValue.call(document.querySelector('input[aria-label="Search loaded work"]'), "Succeeded fixture");
  document.querySelector('input[aria-label="Search loaded work"]').dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  await eventually(() => assert.match(document.body.textContent, /No matching work/));
  button("Clear filters").click();
  await eventually(() => assert.match(document.body.textContent, /Failed fixture/));
  assert.match(document.body.textContent, /Succeeded fixture/);

  button("Board").click();
  await eventually(() => assert.equal(button("Board").getAttribute("aria-pressed"), "true"));
  assert.equal(document.querySelector("#board-in_progress").textContent, "In progress");
  assert.equal(document.querySelectorAll(".run-column").length, 5, "ordinary board has no empty Other state lane");
  assert.equal(document.querySelector("#board-other"), null);

  button("Failed").click();
  await eventually(() => assert.doesNotMatch(document.body.textContent, /Succeeded fixture/));
  assert.match(document.body.textContent, /Failed fixture/);

  button("List").click();
  await eventually(() => assert.equal(button("List").getAttribute("aria-pressed"), "true"));
  assert.equal(button("Failed").getAttribute("aria-pressed"), "true");
  assert.ok(document.querySelector('a[href="#/runs/job_failed"]'), "list links to task");
  assert.match(document.body.textContent, /Failed fixture/);
  assert.doesNotMatch(document.body.textContent, /Succeeded fixture/);

  window.location.hash = "#/runs/job_detail";
  await eventually(() => assert.match(document.body.textContent, /Task with files/));
  await eventually(() => assert.ok(document.querySelector('[aria-label="View result.md"]')));
  assert.equal(artifactRequests, 1, "metadata fetched once across all panels and attempts");
  const tab = name => [...document.querySelectorAll('[role="tab"]')].find(el => el.textContent === name);
  tab("Details").click();
  await eventually(() => assert.equal(tab("Details").getAttribute("aria-selected"), "true"));
  const details = document.querySelector('[role="tabpanel"]:not([hidden])');
  for (const text of ["codex", "test-model", "test-worker", "Not reported", "Remove local execution history", "Exit code"]) {
    assert.ok(details.textContent.includes(text), `details include ${text}`);
  }
  button("Remove local execution history").click();
  await eventually(()=>assert.match(document.querySelector('[role="tabpanel"]:not([hidden])').textContent,/Removal denied: delivery needs reconciliation/));
  tab("History").click();
  await eventually(() => assert.equal(tab("History").getAttribute("aria-selected"), "true"));
  assert.match(document.querySelector('[role="tabpanel"]:not([hidden])').textContent, /plan.md/);
  tab("Files").click();
  await eventually(() => assert.equal(tab("Files").getAttribute("aria-selected"), "true"));
  document.querySelector('[role="tabpanel"]:not([hidden]) [aria-label="View result.md"]').click();
  await eventually(() => assert.match(document.querySelector('[role="tabpanel"]:not([hidden])').textContent, /<script>literal file text<\/script>/));
  assert.equal(document.querySelectorAll("script").length, 0, "preview renders text, not markup");
  assert.equal(artifactRequests, 1, "changing tabs does not refetch metadata");
  window.location.hash = "#/runs/job_interrupted";
  await eventually(() => assert.ok([...document.querySelectorAll("button")].find(el => el.textContent === "Cancel work")));
  button("Cancel work").click();
  await eventually(() => assert.equal(cancelled, true));
  await eventually(() => assert.equal(button("Remove local execution history").disabled, false));
  await eventually(() => assert.equal([...document.querySelectorAll("button")].find(el => el.textContent === "Cancel work"), undefined));

});

function button(label) {
  const match = [...document.querySelectorAll("button")].find((element) => element.textContent.includes(label));
  assert.ok(match, `button ${label} should exist`);
  return match;
}

async function eventually(assertion) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try { assertion(); return; } catch (error) {
      if (attempt === 49) throw error;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
}
