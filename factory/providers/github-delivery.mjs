import { execFile } from 'node:child_process';

const apiRoot = 'repos';

function requestGitHub(method, path, payload) {
  return new Promise((resolve, reject) => {
    const args = ['api', '--hostname', 'github.com', path];
    if (method !== 'GET') args.push('--method', method, '--input', '-');
    const child = execFile('gh', args, {
      timeout: 20000, maxBuffer: 32 * 1024 * 1024, encoding: 'utf8',
      env: { ...process.env, GH_PROMPT_DISABLED: '1', GH_PAGER: 'cat' },
    }, (cause, stdout, stderr) => {
      if (cause) {
        const error = new Error('GitHub delivery request was not confirmed.');
        error.httpStatus = Number(stderr?.match(/\(HTTP (\d+)\)/)?.[1]) || undefined;
        reject(error);
      } else {
        try { resolve(JSON.parse(stdout)); }
        catch { reject(new Error('GitHub returned an unreadable delivery result.')); }
      }
    });
    child.stdin.on('error', () => {});
    if (method === 'GET') child.stdin.end();
    else child.stdin.end(JSON.stringify(payload));
  });
}

function slug(repository) {
  const match = typeof repository === 'string'
    && repository.match(/^https:\/\/github\.com\/([A-Za-z0-9-]+)\/([A-Za-z0-9_.-]+)$/);
  if (!match || match[2].endsWith('.git')) throw new Error('Configured GitHub destination is invalid.');
  return `${match[1]}/${match[2]}`;
}

function checkSummary(runs, status, pullRequestNumber) {
  const checkRuns = Array.isArray(runs?.check_runs) ? runs.check_runs.slice(0, 100).map(run => ({
    kind: 'check_run',
    name: String(run.name || 'Unnamed check').slice(0, 200),
    status: pullRequestNumber && Array.isArray(run.pull_requests)
      && run.pull_requests.some(pull => pull.number === pullRequestNumber)
      ? ['queued', 'in_progress', 'completed'].includes(run.status) ? run.status : 'unknown'
      : 'unknown',
    conclusion: typeof run.conclusion === 'string' ? run.conclusion : null,
    url: typeof run.html_url === 'string' ? run.html_url : null,
    passed: run.status === 'completed' && run.conclusion === 'success'
      && pullRequestNumber && Array.isArray(run.pull_requests) && run.pull_requests.some(pull => pull.number === pullRequestNumber),
    non_blocking: run.status === 'completed' && ['success', 'skipped', 'neutral'].includes(run.conclusion)
      && pullRequestNumber && Array.isArray(run.pull_requests) && run.pull_requests.some(pull => pull.number === pullRequestNumber),
  })) : [];
  const contexts = Array.isArray(status?.statuses) ? status.statuses.slice(0, 100).map(item => ({
    name: String(item.context || 'Unnamed status').slice(0, 200),
    status: ['pending', 'success', 'failure', 'error'].includes(item.state) ? item.state : 'unknown',
    url: typeof item.target_url === 'string' ? item.target_url : null,
  })) : [];
  const rows = [
    ...checkRuns.map(item => ({ ...item, kind: 'check_run',
      passed: item.status === 'completed' && item.conclusion === 'success',
      non_blocking: item.status === 'completed' && ['success', 'skipped', 'neutral'].includes(item.conclusion) })),
    ...contexts.map(item => ({ ...item, kind: 'commit_status', passed: item.status === 'success', non_blocking: item.status === 'success' })),
  ];
  const failed = rows.some(item => item.kind === 'check_run'
    ? item.status === 'completed' && ['failure', 'action_required', 'timed_out', 'cancelled'].includes(item.conclusion)
    : item.status === 'failure' || item.status === 'error');
  const pending = rows.some(item => item.status === 'pending' || item.status === 'queued' || item.status === 'in_progress');
  const unknown = rows.some(item => item.status === 'unknown'
    || (item.kind === 'check_run' && item.status === 'completed'
      && !['success', 'skipped', 'neutral', 'failure', 'action_required', 'timed_out', 'cancelled'].includes(item.conclusion)));
  const complete = Number.isSafeInteger(runs?.total_count) && runs.total_count === checkRuns.length
    && Number.isSafeInteger(status?.total_count) && status.total_count === contexts.length;
  const state = failed ? 'failure' : !complete || unknown ? 'unknown' : pending ? 'pending'
    : rows.length && rows.every(item => item.non_blocking) ? 'success' : 'unknown';
  return { state, pagination_complete: complete, check_runs: checkRuns, commit_statuses: contexts };
}

export function githubDeliveryProvider({ request = requestGitHub } = {}) {
  async function get(path) { return request('GET', path); }
  async function write(method, path, payload) { return request(method, path, payload); }
  return {
    id: 'github', supported: true,
    async inspectRepository(repository) {
      const name = slug(repository), value = await get(`${apiRoot}/${name}`);
      if (value?.full_name?.toLowerCase() !== name.toLowerCase() || value.archived === true)
        throw new Error('GitHub destination identity changed or is archived.');
      return { full_name: value.full_name, archived: value.archived === true, push: value.permissions?.push === true };
    },
    async readTarget(repository, target) {
      const value = await get(`${apiRoot}/${slug(repository)}/git/ref/heads/${target}`);
      if (!/^[a-f0-9]{40}$/.test(value?.object?.sha || '')) throw new Error('GitHub returned an invalid target ref.');
      return { sha: value.object.sha, ref: value.ref };
    },
    async readCommit(repository, sha) {
      try {
        const value = await get(`${apiRoot}/${slug(repository)}/git/commits/${sha}`);
        return { sha: value?.sha, tree: value?.tree?.sha, parents: Array.isArray(value?.parents) ? value.parents.map(parent => parent.sha) : [] };
      } catch (error) {
        if (error.httpStatus === 404) return null;
        throw error;
      }
    },
    async createBlob(repository, content) {
      const value = await write('POST', `${apiRoot}/${slug(repository)}/git/blobs`, { content: content.toString('base64'), encoding: 'base64' });
      if (!/^[a-f0-9]{40}$/.test(value?.sha || '')) throw new Error('GitHub did not confirm the candidate blob.');
      return value.sha;
    },
    async createTree(repository, baseTree, entries) {
      const value = await write('POST', `${apiRoot}/${slug(repository)}/git/trees`, { base_tree: baseTree, tree: entries });
      if (!/^[a-f0-9]{40}$/.test(value?.sha || '')) throw new Error('GitHub did not confirm the candidate tree.');
      return value.sha;
    },
    async createCommit(repository, input) {
      const value = await write('POST', `${apiRoot}/${slug(repository)}/git/commits`, input);
      if (!/^[a-f0-9]{40}$/.test(value?.sha || '')) throw new Error('GitHub did not confirm the candidate commit.');
      return value.sha;
    },
    async readBranch(repository, branch) {
      try {
        const value = await get(`${apiRoot}/${slug(repository)}/git/ref/heads/${branch}`);
        return { sha: value?.object?.sha || null, node_id: value?.node_id || null };
      } catch (error) {
        if (error.httpStatus === 404) return null;
        throw error;
      }
    },
    async createBranch(repository, branch, sha) {
      const value = await write('POST', `${apiRoot}/${slug(repository)}/git/refs`, { ref: `refs/heads/${branch}`, sha });
      return { sha: value?.object?.sha || null, node_id: value?.node_id || null };
    },
    async findPulls(repository, branch, target) {
      const owner = slug(repository).split('/')[0];
      const head = encodeURIComponent(`${owner}:${branch}`), base = encodeURIComponent(target);
      const matches = [];
      for (let page = 1; page <= 10; page++) {
        const value = await get(`${apiRoot}/${slug(repository)}/pulls?state=all&head=${head}&base=${base}&per_page=100&page=${page}`);
        if (!Array.isArray(value)) throw new Error('GitHub returned an invalid pull request list.');
        matches.push(...value);
        if (value.length < 100) return matches;
      }
      throw new Error('GitHub pull request search exceeded its bounded recovery limit.');
    },
    async createPull(repository, input) {
      return write('POST', `${apiRoot}/${slug(repository)}/pulls`, input);
    },
    async readPull(repository, number) {
      return get(`${apiRoot}/${slug(repository)}/pulls/${number}`);
    },
    async readChecks(repository, sha, pullRequestNumber) {
      if (!Number.isSafeInteger(pullRequestNumber) || pullRequestNumber < 1)
        return { state: 'unknown', check_runs: [], commit_statuses: [], reason: 'A pull request identity is required to associate checks with delivery.' };
      try {
        const [runs, status] = await Promise.all([
          get(`${apiRoot}/${slug(repository)}/commits/${sha}/check-runs?per_page=100`),
          get(`${apiRoot}/${slug(repository)}/commits/${sha}/status?per_page=100`),
        ]);
        return checkSummary(runs, status, pullRequestNumber);
      } catch {
        return { state: 'unknown', check_runs: [], commit_statuses: [], reason: 'GitHub checks could not be read with the configured identity.' };
      }
    },
  };
}
