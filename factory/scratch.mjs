import { chmodSync, lstatSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

// Remove only after the container writer is confirmed stopped. lstat keeps
// symlinks as leaf entries; read-only owned directories are made traversable.
export function removeScratch(path) {
  let stat;
  try { stat = lstatSync(path); }
  catch (error) { if (error.code === 'ENOENT') return; throw error; }
  if (stat.isDirectory()) {
    chmodSync(path, 0o700);
    for (const name of readdirSync(path)) removeScratch(join(path, name));
  }
  rmSync(path, { recursive: true, force: true });
}
