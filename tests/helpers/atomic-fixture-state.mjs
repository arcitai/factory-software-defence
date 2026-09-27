import { writeFileSync, renameSync, rmSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

// Readers see a complete old or new document, including while a client publishes.
export function publishFixtureState(path, state, beforeRename = () => {}) {
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, JSON.stringify(state));
    beforeRename(temporary);
    renameSync(temporary, path);
  } finally {
    rmSync(temporary, { force: true });
  }
}
