#!/usr/bin/env node

// Native commands do not load the legacy controller, updater or executor graph.
if (process.argv[2] === 'native') {
  try { await (await import('../factory/native/cli.mjs')).runNative(process.argv.slice(3)); }
  catch (error) { console.error(`Factory native: ${error.message}`); process.exitCode=1; }
} else await import('./legacy.mjs');
