import { githubIssueProvider } from './providers/github.mjs';
import { readGitOrigin, readProjectLinks } from './project-links.mjs';
import { FactoryError } from './error.mjs';

// Selection is local and capability-based. Unknown hosts never receive a GitHub
// token or a guessed API request.
export function issueProvider(repo) {
  if (readProjectLinks(repo)) return githubIssueProvider(repo);
  let host = null;
  try {
    const remote=readGitOrigin(repo);
    if(!remote)throw new Error('No configured origin.');
    if (/^(https?|ssh):\/\//.test(remote)) host = new URL(remote).hostname;
    else host = remote.match(/^(?:[^@\s]+@)?([a-zA-Z0-9.-]+):[^/]/)?.[1] || null;
    if (!/^[a-zA-Z0-9.-]+$/.test(host || '')) host = null;
  } catch { /* No recognizable repository origin. */ }
  const unavailable = async () => { throw new FactoryError('This repository has no supported issue provider. Native issue start is unavailable.', 400); };
  return { id:'unsupported', label:'Repository host', repository:null, host, supported:false,
    capabilities:{issues:false,templates:false,create:false},
    context:unavailable, list:unavailable, preview:unavailable, templates:unavailable, draft:unavailable, publish:unavailable, recover:unavailable };
}
export function providerInfo(provider) {
  return {id:provider.id,label:provider.label,repository:provider.repository,host:provider.host || null,supported:provider.supported,capabilities:provider.capabilities};
}
