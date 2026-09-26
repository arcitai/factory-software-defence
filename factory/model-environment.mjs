import { lstatSync, readFileSync } from 'node:fs';

const variable = /^[A-Za-z_][A-Za-z0-9_]*$/;
const forgeCredential = /^(?:GH_|GITHUB_|GIT_|ACTIONS_|HOMEBREW_GITHUB|COPILOT_GITHUB)/i;

// model.env is mounted into agent containers. Its values may provide inference
// access only; host GitHub, Git and Actions credentials stay on the controller.
export function validateModelEnvironment(path) {
  let text;
  try {
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0) throw new Error();
    text = readFileSync(path, 'utf8');
  } catch { throw new Error('Private model.env is missing, unsafe or unreadable.'); }
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const match = /^([A-Za-z_][A-Za-z0-9_]*)=/.exec(trimmed);
    if (!match || !variable.test(match[1]) || forgeCredential.test(match[1]))
      throw new Error('model.env accepts inference settings only; remove host GitHub, Git or Actions credentials.');
  }
  return true;
}
