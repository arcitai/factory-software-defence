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

// This is observed commit evidence, never branch-protection or acceptance policy.
function checkSummary(runs, status, target) {
  const repositoryName = slug(target.repository).toLowerCase();
  const repositoryAPI = `https://api.github.com/repos/${repositoryName}`;
  const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  const optionalIdentity = (value, expected) => value === undefined
    || (typeof value === 'string' && value.toLowerCase() === expected);
  // API self URLs identify a repository resource; CI details/target links do
  // not. Status examples also use the legacy statuses/{sha} endpoint, whose
  // suffix identifies the commit rather than the individual status ID.
  const matchesSelfURL = (row, endpoint) => {
    if (row.url === undefined) return true;
    if (typeof row.url !== 'string') return false;
    if (endpoint === 'statuses' && optionalIdentity(row.url, `${repositoryAPI}/statuses/${target.sha}`)) return true;
    const match = row.url.match(/\/([1-9][0-9]*)$/);
    return !!match && Number.isSafeInteger(Number(match[1]))
      && optionalIdentity(row.url, `${repositoryAPI}/${endpoint}/${match[1]}`)
      && (row.id === undefined || (Number.isSafeInteger(row.id) && String(row.id) === match[1]));
  };
  // Optional details may be absent, but supplied containers and identities must
  // all agree. Optional chaining alone would erase malformed head/base values.
  const matchesRepository = repo => repo === undefined || (object(repo)
    && optionalIdentity(repo.full_name, repositoryName)
    && optionalIdentity(repo.url, repositoryAPI)
    && optionalIdentity(repo.html_url, target.repository.toLowerCase())
    && optionalIdentity(repo.name, repositoryName.split('/')[1])
    && (repo.owner === undefined || (object(repo.owner)
      && optionalIdentity(repo.owner.login, repositoryName.split('/')[0]))));
  const matchesPullSide = (side, head) => side === undefined || (object(side)
    && (side.sha === undefined || (typeof side.sha === 'string' && /^[a-f0-9]{40}$/.test(side.sha)
      && (!head || side.sha === target.sha)))
    && matchesRepository(side.repo));
  const checkRuns = Array.isArray(runs?.check_runs) ? runs.check_runs.slice(0, 100).map(run => {
    const associations = run?.pull_requests;
    const identity = object(run) && run.head_sha === target.sha && matchesSelfURL(run, 'check-runs') && Array.isArray(associations)
      && associations.every(pull => object(pull) && pull.number === target.pull_request_number
        && optionalIdentity(pull.url, `${repositoryAPI}/pulls/${target.pull_request_number}`)
        && matchesPullSide(pull.head, true) && matchesPullSide(pull.base, false));
    const runStatus = identity && ['queued', 'in_progress', 'completed'].includes(run?.status) ? run.status : 'unknown';
    return {
      kind: 'check_run',
      name: String(run?.name || 'Unnamed check').slice(0, 200),
      head_sha: typeof run?.head_sha === 'string' ? run.head_sha : null,
      scope: identity ? (associations.length ? 'pull_request' : 'commit') : 'unknown',
      status: runStatus,
      conclusion: typeof run?.conclusion === 'string' ? run.conclusion : null,
      url: typeof run?.html_url === 'string' ? run.html_url : null,
      passed: runStatus === 'completed' && run.conclusion === 'success',
      non_blocking: runStatus === 'completed' && ['success', 'skipped', 'neutral'].includes(run.conclusion),
    };
  }) : [];
  const statusIdentity = object(status) && status.sha === target.sha
    && object(status.repository) && typeof status.repository.full_name === 'string'
    && matchesRepository(status.repository)
    && optionalIdentity(status.commit_url, `${repositoryAPI}/commits/${target.sha}`)
    && optionalIdentity(status.url, `${repositoryAPI}/commits/${target.sha}/status`);
  const contexts = Array.isArray(status?.statuses) ? status.statuses.slice(0, 100).map(item => {
    const identity = statusIdentity && object(item) && matchesSelfURL(item, 'statuses');
    const itemStatus = identity && ['pending', 'success', 'failure', 'error'].includes(item?.state) ? item.state : 'unknown';
    return {
      kind: 'commit_status',
      name: String(item?.context || 'Unnamed status').slice(0, 200),
      head_sha: typeof status?.sha === 'string' ? status.sha : null,
      scope: identity ? 'commit' : 'unknown',
      status: itemStatus,
      url: typeof item?.target_url === 'string' ? item.target_url : null,
      passed: itemStatus === 'success', non_blocking: itemStatus === 'success',
    };
  }) : [];
  const rows = [...checkRuns, ...contexts];
  const failed = rows.some(item => item.kind === 'check_run'
    ? item.status === 'completed' && ['failure', 'action_required', 'timed_out'].includes(item.conclusion)
    : item.status === 'failure' || item.status === 'error');
  const cancelled = rows.some(item => item.status === 'completed' && item.conclusion === 'cancelled');
  const pending = rows.some(item => item.status === 'pending' || item.status === 'queued' || item.status === 'in_progress');
  const unknown = !statusIdentity || rows.some(item => item.status === 'unknown'
    || (item.kind === 'check_run' && item.status === 'completed'
      && !['success', 'skipped', 'neutral', 'failure', 'action_required', 'timed_out', 'cancelled'].includes(item.conclusion)));
  const completePage = (payload, key) => Array.isArray(payload?.[key]) && payload[key].length <= 100
    && Number.isSafeInteger(payload.total_count) && payload.total_count === payload[key].length;
  const complete = completePage(runs, 'check_runs') && completePage(status, 'statuses');
  const onlyNonBlocking = rows.length > 0 && rows.every(item => item.non_blocking);
  const state = failed ? 'failure' : !complete || unknown ? 'unknown' : cancelled ? 'cancelled' : pending ? 'pending'
    : onlyNonBlocking ? (rows.some(item => item.passed) ? 'success' : 'non_blocking') : 'unknown';
  return { state, target, pagination_complete: complete, check_runs: checkRuns, commit_statuses: contexts,
    ...(state === 'unknown' ? { reason: 'Check readback is empty, incomplete or contains unverified identity or status.' } : {}) };
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
      const head = encodeURIComponent(`${owner}:${branch}`), base = typeof target === 'string' ? `&base=${encodeURIComponent(target)}` : '';
      const matches = [];
      for (let page = 1; page <= 10; page++) {
        const value = await get(`${apiRoot}/${slug(repository)}/pulls?state=all&head=${head}${base}&per_page=100&page=${page}`);
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
      if (!Number.isSafeInteger(pullRequestNumber) || pullRequestNumber < 1 || !/^[a-f0-9]{40}$/.test(sha || ''))
        return { state: 'unknown', target: null, pagination_complete: false, check_runs: [], commit_statuses: [], reason: 'A valid pull request number and immutable delivered commit are required.' };
      const target = { repository, sha, pull_request_number: pullRequestNumber };
      try {
        const [runs, status] = await Promise.all([
          get(`${apiRoot}/${slug(repository)}/commits/${sha}/check-runs?per_page=100`),
          get(`${apiRoot}/${slug(repository)}/commits/${sha}/status?per_page=100`),
        ]);
        return checkSummary(runs, status, target);
      } catch {
        return { state: 'unknown', target, pagination_complete: false, check_runs: [], commit_statuses: [], reason: 'GitHub checks could not be read with the configured identity.' };
      }
    },
  };
}
