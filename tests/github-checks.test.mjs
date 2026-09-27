import test from 'node:test';
import assert from 'node:assert/strict';
import { githubDeliveryProvider } from '../factory/providers/github-delivery.mjs';

const repository = 'https://github.com/arcitai/software-and-defence-factory';
const sha = '74d5c2d5563e44a89ab84434173a8014b4d4fe62';
const number = 96;
const repositoryAPI = `https://api.github.com/repos/${repository.slice(19)}`;
const repositoryIdentity = { full_name: repository.slice(19), url: repositoryAPI,
  html_url: repository, name: 'software-and-defence-factory', owner: { login: 'arcitai' } };
const run = (changes = {}) => ({ id: 1, name: 'check (22)', head_sha: sha,
  status: 'completed', conclusion: 'success', pull_requests: [], ...changes });
const combined = (changes = {}) => ({ sha, repository: { full_name: repository.slice(19) },
  state: 'pending', total_count: 0, statuses: [], ...changes });
async function read(runs = [run()], status = combined(), count = runs.length) {
  return githubDeliveryProvider({ request: async (method, path) => {
    assert.equal(method, 'GET');
    assert(path.includes(`/commits/${sha}/`));
    return path.includes('/check-runs?') ? { total_count: count, check_runs: runs } : status;
  } }).readChecks(repository, sha, number);
}

test('PR96-shaped exact delivered-commit checks survive an empty optional PR association', async () => {
  const checks = await read([run(), run({ id: 2, name: 'check (24)' }), run({ id: 3, name: 'publish', conclusion: 'skipped' })]
    .map(row => ({ ...row, url: `${repositoryAPI}/check-runs/${row.id}` })));
  assert.equal(checks.state, 'success');
  assert.deepEqual(checks.check_runs.map(row => row.status), ['completed', 'completed', 'completed']);
  assert.deepEqual(checks.check_runs.map(row => row.passed), [true, true, false]);
});

test('normalized provenance distinguishes commit scope from an explicit matching PR association', async () => {
  const checks = await read([run(), run({ id: 2, pull_requests: [{ number, head: { sha } }] })]);
  assert.deepEqual(checks.target, { repository, sha, pull_request_number: number });
  assert.deepEqual(checks.check_runs.map(row => row.scope), ['commit', 'pull_request']);
  assert(checks.check_runs.every(row => row.head_sha === sha));
  assert.equal(checks.pagination_complete, true);
});

test('check-run API self URLs allow matching or absent identity and preserve external CI links', async () => {
  const details = 'https://ci.example.net/another/project/build/17?view=details';
  for (const change of [{}, { url: `${repositoryAPI}/check-runs/1` },
    { url: `${repositoryAPI}/check-runs/1`, id: undefined },
    { url: `${repositoryAPI.replace('/arcitai/', '/Arcitai/')}/check-runs/1` }]) {
    for (const pull_requests of [[], [{ number, head: { sha } }]]) {
      const checks = await read([run({ ...change, pull_requests, html_url: details, details_url: details })]);
      assert.equal(checks.state, 'success');
      assert.equal(checks.check_runs[0].passed, true);
      assert.equal(checks.check_runs[0].non_blocking, true);
      assert.equal(checks.check_runs[0].url, details);
    }
  }
});

test('contradictory or malformed check-run API self URLs invalidate the row and aggregate', async () => {
  for (const change of [
    { url: 'https://api.github.com/repos/other/repo/check-runs/1' },
    { url: `${repositoryAPI}/check-runs/2` },
    { url: `${repositoryAPI}/statuses/1` }, { url: `${repositoryAPI}/check-runs/1/annotations` },
    { url: `${repositoryAPI}/check-runs/not-an-id` }, { url: `${repositoryAPI}/check-runs/0` },
    { url: `${repositoryAPI}/check-runs/1?other=repo` }, { url: `${repositoryAPI}/check-runs/1#fragment` },
    { url: `${repositoryAPI}/check-runs/1\n` }, { url: `${repositoryAPI}/check-runs/1/` },
    { url: `${repositoryAPI.replace('https:', 'http:')}/check-runs/1` },
    { url: `${repositoryAPI.replace('api.github.com', 'api.github.com.example.net')}/check-runs/1` },
    { url: null }, { url: [] }, { url: 1 }, { url: 'malformed' },
    ...[null, '1', 2, -1, 1.5].map(id => ({ url: `${repositoryAPI}/check-runs/1`, id })),
  ]) {
    for (const conclusion of ['success', 'skipped', 'neutral']) {
      const checks = await read([run({ id: 2 }), run({ ...change, conclusion })]);
      assert.equal(checks.state, 'unknown', JSON.stringify(change));
      const row = checks.check_runs[1];
      assert.equal(row.status, 'unknown');
      assert.equal(row.scope, 'unknown');
      assert.equal(row.passed, false);
      assert.equal(row.non_blocking, false);
    }
  }
});

test('commit-status API self URLs support row IDs and documented exact-SHA URLs with external targets', async () => {
  const target_url = 'https://ci.example.net/another/project/build/17?view=details';
  for (const change of [{}, { url: `${repositoryAPI}/statuses/4` },
    { url: `${repositoryAPI}/statuses/4`, id: undefined },
    { url: `${repositoryAPI}/statuses/${sha}` },
    { url: `${repositoryAPI.replace('/arcitai/', '/Arcitai/')}/statuses/4` }]) {
    const checks = await read([], combined({ total_count: 1,
      statuses: [{ id: 4, context: 'external/CI', state: 'success', target_url, ...change }] }));
    assert.equal(checks.state, 'success');
    assert.equal(checks.commit_statuses[0].passed, true);
    assert.equal(checks.commit_statuses[0].non_blocking, true);
    assert.equal(checks.commit_statuses[0].scope, 'commit');
    assert.equal(checks.commit_statuses[0].url, target_url);
  }
});

test('contradictory or malformed commit-status API self URLs invalidate only their row and block success', async () => {
  for (const change of [
    { url: 'https://api.github.com/repos/other/repo/statuses/4' },
    { url: `https://api.github.com/repos/other/repo/statuses/${sha}` },
    { url: `${repositoryAPI}/statuses/5` }, { url: `${repositoryAPI}/check-runs/4` },
    { url: `${repositoryAPI}/statuses/${'a'.repeat(40)}` },
    { url: `${repositoryAPI}/statuses/${'1'.repeat(40)}`, id: undefined },
    { url: `${repositoryAPI}/statuses/main` }, { url: `${repositoryAPI}/statuses/0` },
    { url: `${repositoryAPI}/statuses/4/extra` }, { url: `${repositoryAPI}/statuses/4?other=repo` },
    { url: `${repositoryAPI}/statuses/4#fragment` }, { url: `${repositoryAPI}/statuses/4\n` },
    { url: `${repositoryAPI}/statuses/4/` },
    { url: `${repositoryAPI.replace('https:', 'http:')}/statuses/4` },
    { url: `${repositoryAPI.replace('api.github.com', 'api.github.com.example.net')}/statuses/4` },
    { url: null }, { url: [] }, { url: 4 }, { url: 'malformed' },
    ...[null, '4', 5, -1, 4.5].map(id => ({ url: `${repositoryAPI}/statuses/4`, id })),
  ]) {
    const checks = await read([run()], combined({ total_count: 2, statuses: [
      { id: 3, state: 'success', url: `${repositoryAPI}/statuses/3` },
      { id: 4, state: 'success', ...change },
    ] }));
    assert.equal(checks.state, 'unknown', JSON.stringify(change));
    assert.equal(checks.commit_statuses[0].passed, true);
    const row = checks.commit_statuses[1];
    assert.equal(row.status, 'unknown');
    assert.equal(row.scope, 'unknown');
    assert.equal(row.passed, false);
    assert.equal(row.non_blocking, false);
  }
});

test('missing, malformed and conflicting run identities never become successful evidence', async () => {
  for (const change of [
    { head_sha: undefined }, { head_sha: 'a'.repeat(40) },
    { pull_requests: undefined }, { pull_requests: null }, { pull_requests: {} },
    { pull_requests: [null] }, { pull_requests: [{}] }, { pull_requests: [{ number: 95 }] },
    { pull_requests: [{ number }, { number: 95 }] },
    { pull_requests: [{ number, head: { sha: 'a'.repeat(40) } }] },
    { pull_requests: [{ number, url: 'https://api.github.com/repos/other/repo/pulls/96' }] },
    { pull_requests: [{ number, head: { repo: { full_name: 'other/repo' } } }] },
    { pull_requests: [{ number, base: { repo: { url: 'https://api.github.com/repos/other/repo' } } }] },
  ]) {
    const checks = await read([run(change)]);
    assert.equal(checks.state, 'unknown', JSON.stringify(change));
    assert.equal(checks.check_runs[0].scope, 'unknown');
    assert.equal(checks.check_runs[0].passed, false);
    assert.equal(checks.check_runs[0].non_blocking, false);
  }
  for (const row of [null, 123, 'success']) assert.equal((await read([row])).state, 'unknown');
});

test('combined statuses require the exact commit and repository even for an empty status list', async () => {
  const statuses = [{ id: 4, context: 'legacy CI', state: 'success' }];
  const checks = await read([], combined({ total_count: 1, statuses }));
  assert.equal(checks.state, 'success');
  assert.equal(checks.commit_statuses[0].passed, true);
  assert.equal(checks.commit_statuses[0].scope, 'commit');
  assert.equal(checks.commit_statuses[0].head_sha, sha);
  for (const change of [{ sha: undefined }, { sha: 'a'.repeat(40) }, { repository: undefined },
    { repository: null }, { repository: [] }, { repository: 'arcitai/software-and-defence-factory' }, { repository: 96 },
    { repository: {} }, { repository: { full_name: 'other/repository' } }]) {
    const bad = await read([run()], combined({ total_count: 1, statuses, ...change }));
    assert.equal(bad.state, 'unknown');
    assert.equal(bad.commit_statuses[0].passed, false);
    assert.equal((await read([run()], combined(change))).state, 'unknown');
  }
  assert.equal((await read([run()], combined({ state: 'failure' }))).state, 'success', 'top-level state never substitutes for actual rows');
  assert.equal((await read([], combined({ state: 'success' }))).state, 'unknown', 'an empty successful envelope proves no execution');
});

test('supplied PR identity containers must be objects, including optional head/base repositories', async () => {
  for (const field of ['head', 'base']) {
    for (const value of [null, false, 96, 'malformed', [], [{}]]) {
      for (const detail of [value, { repo: value }]) {
        const checks = await read([run({ pull_requests: [{ number, [field]: detail }] })]);
        assert.equal(checks.state, 'unknown', `${field}: ${JSON.stringify(detail)}`);
        assert.equal(checks.check_runs[0].status, 'unknown');
        assert.equal(checks.check_runs[0].scope, 'unknown');
        assert.equal(checks.check_runs[0].passed, false);
        assert.equal(checks.check_runs[0].non_blocking, false);
      }
    }
  }
});

test('every supplied repository identity agrees in PR associations and combined status', async () => {
  for (const change of [
    { full_name: null }, { full_name: 'other/repository' },
    { url: null }, { url: [] }, { url: 'https://api.github.com/repos/other/repository' },
    { html_url: 'https://github.com/other/repository' }, { name: 'other' },
    { owner: null }, { owner: [] }, { owner: 'arcitai' }, { owner: { login: 'other' } },
  ]) {
    const repo = { ...repositoryIdentity, ...change };
    for (const field of ['head', 'base']) {
      const checks = await read([run({ pull_requests: [{ number, [field]: { repo } }] })]);
      assert.equal(checks.state, 'unknown', `${field}: ${JSON.stringify(change)}`);
      assert.equal(checks.check_runs[0].passed, false);
    }
    for (const statuses of [[], [{ context: 'legacy CI', state: 'success' }]]) {
      const checks = await read([run()], combined({ repository: repo, total_count: statuses.length, statuses }));
      assert.equal(checks.state, 'unknown', JSON.stringify(change));
      assert(checks.commit_statuses.every(row => row.scope === 'unknown' && !row.passed && !row.non_blocking));
    }
  }
});

test('supplied commit URLs and association SHAs cannot contradict the read target', async () => {
  const otherSha = 'a'.repeat(40);
  for (const change of [
    { commit_url: `${repositoryAPI}/commits/${otherSha}` },
    { url: `${repositoryAPI}/commits/${otherSha}/status` },
    { commit_url: `https://api.github.com/repos/other/repo/commits/${sha}` },
    { url: null }, { commit_url: [] },
  ]) assert.equal((await read([run()], combined(change))).state, 'unknown', JSON.stringify(change));
  for (const field of ['head', 'base']) {
    for (const value of [null, 123, [], 'main']) {
      const checks = await read([run({ pull_requests: [{ number, [field]: { sha: value } }] })]);
      assert.equal(checks.state, 'unknown', `${field}.sha: ${JSON.stringify(value)}`);
    }
  }
});

test('valid matching identities and genuinely absent optional association details remain supported', async () => {
  const status = combined({ repository: repositoryIdentity,
    commit_url: `${repositoryAPI}/commits/${sha}`, url: `${repositoryAPI}/commits/${sha}/status` });
  for (const association of [[], [{ number }], [{ number, head: {}, base: {} }], [{ number,
    url: `${repositoryAPI}/pulls/${number}`, head: { sha, repo: repositoryIdentity },
    base: { sha: 'b'.repeat(40), repo: repositoryIdentity } }]]) {
    const checks = await read([run({ pull_requests: association })], status);
    assert.equal(checks.state, 'success');
    assert.equal(checks.check_runs[0].passed, true);
    assert.equal(checks.check_runs[0].scope, association.length ? 'pull_request' : 'commit');
  }
});

test('partial and malformed payloads cannot imply complete passing checks', async () => {
  for (const count of [undefined, null, -1, 1.5, '1', 0, 101]) {
    // Explicit undefined bypasses the helper's default parameter.
    const checks = await githubDeliveryProvider({ request: async (_method, path) => path.includes('/check-runs?')
      ? { total_count: count, check_runs: [run()] } : combined() }).readChecks(repository, sha, number);
    assert.equal(checks.state, 'unknown');
    assert.equal(checks.pagination_complete, false);
  }
  for (const key of ['check_runs', 'statuses']) {
    for (const value of [undefined, null, {}, 'success']) {
      const checks = await githubDeliveryProvider({ request: async (_method, path) => path.includes('/check-runs?')
        ? { total_count: 0, check_runs: [], ...(key === 'check_runs' ? { [key]: value } : {}) }
        : combined(key === 'statuses' ? { [key]: value } : {}) }).readChecks(repository, sha, number);
      assert.equal(checks.state, 'unknown');
      assert.equal(checks.pagination_complete, false);
    }
  }
  assert.equal((await read([run()], combined({ total_count: 101, statuses: [{ state: 'success' }] }))).state, 'unknown');
  assert.equal((await read(Array.from({ length: 101 }, (_, id) => run({ id })))).state, 'unknown');
  assert.equal((await read([run({ status: 'queued', conclusion: null })], combined(), 101)).state, 'unknown');
  assert.equal((await read([run({ conclusion: 'failure' })], combined(), 101)).state, 'failure', 'a verified failure remains visible in partial data');
});

test('execution success, non-blocking, pending, failure, cancellation and unknown remain distinct', async () => {
  for (const [change, expected] of [
    [{}, 'success'], [{ conclusion: 'skipped' }, 'non_blocking'], [{ conclusion: 'neutral' }, 'non_blocking'],
    [{ status: 'queued', conclusion: null }, 'pending'], [{ status: 'in_progress', conclusion: null }, 'pending'],
    [{ conclusion: 'failure' }, 'failure'], [{ conclusion: 'timed_out' }, 'failure'],
    [{ conclusion: 'action_required' }, 'failure'], [{ conclusion: 'cancelled' }, 'cancelled'],
    [{ conclusion: 'future_conclusion' }, 'unknown'], [{ conclusion: null }, 'unknown'], [{ status: 'future_status' }, 'unknown'],
  ]) {
    const checks = await read([run(change)]);
    assert.equal(checks.state, expected);
    assert.equal(checks.check_runs[0].passed, expected === 'success');
  }
  assert.equal((await read([run(), run({ id: 2, conclusion: 'future_conclusion' })])).state, 'unknown');
  assert.equal((await read([run(), run({ id: 2, conclusion: 'cancelled' })])).state, 'cancelled');
  for (const state of ['failure', 'error', 'pending', 'future_state']) {
    const checks = await read([run()], combined({ total_count: 1, statuses: [{ context: 'CI', state }] }));
    assert.equal(checks.state, { failure: 'failure', error: 'failure', pending: 'pending' }[state] || 'unknown');
  }
});

test('invalid targets and unreadable provider responses return explicit unknown without writes or polling', async () => {
  let calls = 0;
  const provider = githubDeliveryProvider({ request: async method => { assert.equal(method, 'GET'); calls++; throw new Error('unreadable'); } });
  for (const [targetSha, pr] of [[undefined, number], ['main', number], [sha, null], [sha, 0]]) {
    const checks = await provider.readChecks(repository, targetSha, pr);
    assert.equal(checks.state, 'unknown');
    assert.equal(checks.pagination_complete, false);
  }
  assert.equal(calls, 0);
  const checks = await provider.readChecks(repository, sha, number);
  assert.equal(calls, 2);
  assert.equal(checks.state, 'unknown');
  assert.equal(checks.pagination_complete, false);
  assert.match(checks.reason, /could not be read/);
});
