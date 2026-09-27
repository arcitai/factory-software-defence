import { canonicalIssue } from './issue-lifecycle.mjs';
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
    const error = new Error('Could not read GitHub repository data. Check GitHub CLI access on the controller host and try again.');
    if (/\(HTTP 404\)/.test(cause.stderr || '')) error.status=404;
    throw error;
  }
}

function issueLabels(labels = []) {
  if (!Array.isArray(labels) || labels.some(label => typeof label?.name !== 'string')) throw new Error('GitHub returned unexpected labels.');
  return labels.map(label => ({name:label.name, color:/^[a-f0-9]{6}$/i.test(label.color || '') ? label.color.toLowerCase() : null}));
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
    return { number: issue.number, title: issue.title, url: issue.html_url, state: issue.state || 'unknown', labels: issueLabels(issue.labels) };
  });
  return { repository, issues, next_page: result.length === 50 && page < 10000 ? page + 1 : null };
}

export function validateIssueURL(repoURL, value) {
  const identity = canonicalIssue(value);
  if (!identity || new URL(value).search) throw new Error('Enter a GitHub issue URL without query parameters.');
  if (!repoURL || identity.repository !== repoURL.toLowerCase()) throw new Error('Issue does not belong to this project’s configured GitHub origin.');
  return identity.url;
}
export async function readIssue(repo, url, read = url => githubRead(['issue', 'view', url, '--json', 'title,body,url,labels,state'])) {
  const repoURL = readProjectLinks(repo)?.repository;
  url = validateIssueURL(repoURL, url);
  const issue = await read(url);
  validateIssueURL(repoURL, issue?.url);
  if (validateIssueURL(repoURL, issue.url) !== url || typeof issue.title !== 'string' || !issue.title.trim() || typeof issue.body !== 'string') throw new Error('GitHub returned an unexpected issue.');
  const spec = `Issue: ${issue.url}\n${issue.title}\n\n${issue.body}`;
  if (Buffer.byteLength(spec) > 240000) throw new Error('Issue exceeds the 240 KB task limit. Use a bounded task file instead.');
  const labels = issueLabels(issue.labels);
  return { title: issue.title, url, number: canonicalIssue(url).number, state: issue.state?.toLowerCase() || 'unknown', body: issue.body, spec, labels, recommendation: recommendWork({ spec, labels: labels.map(label => label.name) }) };
}
