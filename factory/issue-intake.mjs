import { canonicalIssue, LIFECYCLE_CATALOG } from './issue-lifecycle.mjs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readProjectLinks } from './project-links.mjs';
import { recommendWork } from './intake.mjs';
const exec = promisify(execFile);

export async function githubRead(args) {
  try {
    const { stdout } = await exec('gh', args, {
      encoding: 'utf8', timeout: 10000, maxBuffer: 8 * 1024 * 1024,
      env: { ...process.env, GH_PROMPT_DISABLED: '1', GH_PAGER: 'cat' },
    });
    return JSON.parse(stdout);
  } catch (cause) {
    const error = new Error('Could not read GitHub repository data. Check the selected project identity and GitHub CLI access.');
    if (/\(HTTP 404\)/.test(cause.stderr || '')) error.status=404;
    throw error;
  }
}

function issueLabels(labels = []) {
  if (!Array.isArray(labels) || labels.some(label => typeof label?.name !== 'string')) throw new Error('GitHub returned unexpected labels.');
  return labels.map(label => ({name:label.name, color:/^[a-f0-9]{6}$/i.test(label.color || '') ? label.color.toLowerCase() : null}));
}

function contributor(value) {
  const login = typeof value === 'string' ? value : value?.login;
  if (typeof login !== 'string' || !/^[A-Za-z0-9-]{1,39}$/.test(login)) return null;
  const suppliedProfile = value && typeof value === 'object' ? value.html_url || value.profile_url || value.url : null;
  let profile_url = `https://github.com/${login}`;
  if (suppliedProfile !== undefined && suppliedProfile !== null) {
    try {
      const url = new URL(suppliedProfile);
      if (url.protocol !== 'https:' || url.hostname !== 'github.com' || url.username || url.password || url.port
        || url.search || url.hash || url.pathname.replace(/\/$/, '').toLowerCase() !== `/${login}`.toLowerCase()) profile_url = null;
      else profile_url = `https://github.com/${login}`;
    } catch { profile_url = null; }
  }
  const rawAvatar = value && typeof value === 'object' ? value.avatar_url || value.avatarUrl : null;
  let avatar_url = null;
  if (typeof rawAvatar === 'string' && rawAvatar.length <= 2048) {
    try {
      const url = new URL(rawAvatar);
      if (url.protocol === 'https:' && url.hostname === 'avatars.githubusercontent.com' && !url.username && !url.password && !url.port
        && /^\/u\/[1-9][0-9]*$/.test(url.pathname) && [...url.searchParams.keys()].every(key => key === 'v')
        && [...url.searchParams.getAll('v')].every(version => /^[0-9]{1,3}$/.test(version))) {
        url.hash = '';
        avatar_url = url.toString();
      }
    } catch { /* Unavailable avatar metadata is omitted. */ }
  }
  return { login, profile_url, avatar_url };
}

function stateReason(value) {
  const reason = typeof value === 'string' ? value.toLowerCase() : null;
  return reason ? LIFECYCLE_CATALOG.closure_reasons.some(item => item.id === reason) ? reason : 'unrecognized' : null;
}

function issueMetadata(issue) {
  const date = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : null;
  const author = contributor(issue.user || issue.author);
  const assignees = Array.isArray(issue.assignees) ? issue.assignees.map(contributor).filter(Boolean)
    .filter((person, index, people) => people.findIndex(candidate => candidate.login.toLowerCase() === person.login.toLowerCase()) === index) : [];
  return { author: author?.login || null, author_profile_url: author?.profile_url || null, author_avatar_url: author?.avatar_url || null, assignees,
    created_at: date(issue.created_at || issue.createdAt), updated_at: date(issue.updated_at || issue.updatedAt) };
}

function issueState(issue) {
  const value = typeof issue.state === 'string' ? issue.state.toLowerCase() : 'unknown';
  return ['open', 'closed'].includes(value) ? value : 'unknown';
}

export async function listIssues(repo, page = 1, read = githubRead, state = 'open') {
  if (!Number.isSafeInteger(page) || page < 1 || page > 10000) throw new Error('Issue page must be an integer between 1 and 10000.');
  if (!['open', 'closed', 'all'].includes(state)) throw new Error('Issue state must be open, closed or all.');
  const repository = readProjectLinks(repo)?.repository;
  if (!repository) throw new Error('This project has no configured GitHub origin.');
  const slug = repository.slice('https://github.com/'.length);
  const result = await read(['api', '--hostname', 'github.com', `repos/${slug}/issues?state=${state}&sort=created&direction=desc&per_page=50&page=${page}`, '-H', 'Accept: application/vnd.github+json']);
  if (!Array.isArray(result) || result.length > 50) throw new Error('GitHub returned an unexpected issue list.');
  const issues = result.filter(issue => !issue.pull_request).map(issue => {
    validateIssueURL(repository, issue.html_url);
    if (!Number.isSafeInteger(issue.number) || !issue.html_url.endsWith(`/issues/${issue.number}`) || typeof issue.title !== 'string' || !issue.title.trim()) throw new Error('GitHub returned an unexpected issue.');
    return { ...issueMetadata(issue), number: issue.number, title: issue.title, url: issue.html_url, state: issueState(issue),
      state_reason: stateReason(issue.state_reason ?? issue.stateReason), labels: issueLabels(issue.labels) };
  });
  return { repository, issues, next_page: result.length === 50 && page < 10000 ? page + 1 : null };
}

export function validateIssueURL(repoURL, value) {
  const identity = canonicalIssue(value);
  if (!identity || new URL(value).search) throw new Error('Enter a GitHub issue URL without query parameters.');
  if (!repoURL || identity.repository !== repoURL.toLowerCase()) throw new Error('Issue does not belong to this project’s configured GitHub origin.');
  return identity.url;
}
export async function readIssue(repo, url, read = url => githubRead(['issue', 'view', url, '--json', 'title,body,url,labels,state,stateReason,author,assignees,createdAt,updatedAt'])) {
  const repoURL = readProjectLinks(repo)?.repository;
  url = validateIssueURL(repoURL, url);
  const issue = await read(url);
  validateIssueURL(repoURL, issue?.url);
  if (validateIssueURL(repoURL, issue.url) !== url || typeof issue.title !== 'string' || !issue.title.trim() || typeof issue.body !== 'string') throw new Error('GitHub returned an unexpected issue.');
  const spec = `Issue: ${issue.url}\n${issue.title}\n\n${issue.body}`;
  if (Buffer.byteLength(spec) > 240000) throw new Error('Issue exceeds the 240 KB task limit. Use a bounded task file instead.');
  const labels = issueLabels(issue.labels);
  return { ...issueMetadata(issue), title: issue.title, url, number: canonicalIssue(url).number, state: issueState(issue),
    state_reason: stateReason(issue.state_reason ?? issue.stateReason), body: issue.body, spec, labels, recommendation: recommendWork({ spec, labels: labels.map(label => label.name) }) };
}
