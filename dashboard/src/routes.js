const pages = new Set(["runs", "analytics", "infrastructure", "automations", "agents", "skills", "definition"]);
const aliases = { inbox: "runs", workers: "infrastructure", triggers: "automations", commands: "agents", workflows: "agents" };
export function routeFromHash(hash) {
  const value = hash.replace(/^#\//, "");
  if (value.startsWith("issues/")) {
    try { return { view: "issue", issueKey: decodeURIComponent(value.slice(7)), jobID: "" }; }
    catch { return { view: "runs", jobID: "" }; }
  }
  const detail = value.match(/^(?:runs|inbox)\/(.+)$/);
  if (detail) {
    try { return { view: "task", jobID: decodeURIComponent(detail[1]) }; }
    catch { return { view: "runs", jobID: "" }; }
  }
  return { view: aliases[value] || (pages.has(value) ? value : "runs"), jobID: "" };
}
