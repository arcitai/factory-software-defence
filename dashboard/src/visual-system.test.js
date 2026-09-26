import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("project view leads with identity and each control plane view keeps its page heading", async () => {
  const [main, analytics, catalog] = await Promise.all([
    readFile(new URL("./main.jsx", import.meta.url), "utf8"),
    readFile(new URL("./analytics.jsx", import.meta.url), "utf8"),
    readFile(new URL("./catalog.jsx", import.meta.url), "utf8"),
  ]);

  assert.match(main, /<ProjectContext identity=\{identity\}/);
  assert.match(main, /<h2[^>]*>Issues<\/h2>/);
  assert.match(main, /aria-label="Search issues"/);
  assert.match(analytics, /<PageHeading title="Issue analytics"/);
  assert.match(catalog, /<Page title="Infrastructure"/);
  assert.match(catalog, /<Page title=\{displayName\(section\)\}/);
  assert.match(catalog, /<Page title="Automations"/);
  assert.doesNotMatch([main, analytics, catalog].join("\n"), /Control plane \/|index="0[1-5]"/);
});

test("narrow navigation and status filters collapse into labelled controls", async () => {
  const main = await readFile(new URL("./main.jsx", import.meta.url), "utf8");
  const styles = await readFile(new URL("./styles.css", import.meta.url), "utf8");

  assert.match(main, /className="mobile-nav"/);
  assert.match(main, /aria-label="Open navigation"/);
  assert.match(main, /aria-label="Filter issues by status"/);
  assert.match(styles, /\.mobile-nav \{ position: relative; display: block;/);
  assert.match(styles, /\.project-header h1 \{[^}]*font-size: 36px/);
  assert.match(styles, /grid-template-columns: 212px minmax\(0, 1fr\)/);
});

test("trusted delivery feedback stays with its action and the narrow action can wrap", async () => {
  const [detail, styles] = await Promise.all([
    readFile(new URL("./task-detail.jsx", import.meta.url), "utf8"),
    readFile(new URL("./styles.css", import.meta.url), "utf8"),
  ]);

  assert.match(detail, /aria-label="Trusted PR delivery action"/);
  assert.match(detail, /role="alert" aria-live="assertive"/);
  assert.match(detail, /aria-describedby=\{\(deliveryActionError \|\| delivery\.error\)/);
  assert.match(detail, /job\.can_remove === false/);
  assert.match(detail, /Delivery branch/);
  assert.match(detail, /Source ref at admission/);
  assert.match(styles, /\.delivery-action-button \{[^}]*white-space: normal/);
  assert.match(styles, /\.delivery-action-button \{[^}]*height: auto/);
  assert.match(styles, /\.delivery-action-button \{[^}]*overflow-wrap: anywhere/);
});
