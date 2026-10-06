import { accessSync, closeSync, constants, lstatSync, openSync, readSync, realpathSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';

export const within = (root, path) => { const r = relative(root, path); return r === '' || (r !== '..' && !r.startsWith(`..${sep}`) && !isAbsolute(r)); };

// A selected native executable must be an external native binary or an explicit
// script for the pinned Node runtime.
export function nativeExecutable(candidate, repo, label='Codex') {
  if (!isAbsolute(candidate)) throw new Error(`Select an absolute ${label} executable path.`);
  const path = resolve(candidate), target = realpathSync(path);
  if (within(repo, path) || within(repo, target) || !lstatSync(target).isFile())
    throw new Error(`${label} executable must be a file outside the repository.`);
  accessSync(path, constants.X_OK);
  const fd=openSync(target,'r'), header=Buffer.alloc(256);
  try {readSync(fd,header,0,header.length,0);} finally {closeSync(fd);}
  const elf=header.subarray(0,4).equals(Buffer.from([0x7f,0x45,0x4c,0x46]));
  const nodeScript=header.toString('utf8').startsWith(`#!${realpathSync(process.execPath)}\n`);
  if (!elf && !nodeScript) throw new Error(`Unsupported ${label} executable layout; select a native binary or explicit Node script.`);
  return path; // Preserve argv[0] for a selected symlink or shim.
}
