import { execFile } from 'node:child_process';
import { githubRead, listIssues, readIssue } from '../issue-intake.mjs';
import { readTemplates, draftFromTemplate } from '../issue-templates.mjs';
import { readProjectLinks } from '../project-links.mjs';
import { QueueError } from '../queue.mjs';
const marker = record => `<!-- factory-issue:${record.correlation_id} -->`;
const apiArgs = path => ['api', '--hostname', 'github.com', path];
export function githubWrite(path, payload) {
  return new Promise((resolve, reject) => {
    const child = execFile('gh', [...apiArgs(path), '--method', 'POST', '--input', '-'], {
      timeout: 15000, maxBuffer: 1024 * 1024, encoding: 'utf8',
      env: { ...process.env, GH_PROMPT_DISABLED: '1', GH_PAGER: 'cat' },
    }, (cause, stdout, stderr) => {
      if (cause) {
        const error = new Error('GitHub did not confirm issue creation.');
        error.httpStatus = Number(stderr?.match(/\(HTTP (\d+)\)/)?.[1]) || undefined;
        reject(error);
      } else {
        try { resolve(JSON.parse(stdout)); } catch { reject(new Error('GitHub returned an unreadable creation result.')); }
      }
    });
    child.stdin.on('error', () => {}); // Process completion reports a broken pipe without exposing request content.
    child.stdin.end(JSON.stringify(payload));
  });
}

function confirm(record, issue) {
    if (issue?.pull_request || !Number.isSafeInteger(issue?.number) || issue.number < 1 || issue.html_url !== `${record.repository}/issues/${issue.number}` || issue.user?.id !== record.actor_id || !issue.body?.includes(marker(record))) throw new Error('Unexpected GitHub creation result.');
    const actualLabels = (issue.labels || []).map(label => label.name);
    const result = { number: issue.number, url: issue.html_url, title: issue.title, labels: actualLabels,
      missing_labels: record.payload.labels.filter(label => !actualLabels.includes(label)) };
    return result;
  }

export function githubIssueProvider(repo, { read = githubRead, write = githubWrite } = {}) {
  const repository = readProjectLinks(repo)?.repository;
  return {
    id: 'github', label: 'GitHub', repository, supported: true,
    capabilities: { issues: true, templates: true, create: true },
    list: (page, state) => listIssues(repo, page, read, state),
    preview: url => readIssue(repo, url, value => read(['issue', 'view', value, '--json', 'title,body,url,labels,state,author,createdAt,updatedAt'])),
    templates: () => readTemplates(repo, read),
    draft: input => draftFromTemplate(repo, input, read),
    async context() {
    const repository = readProjectLinks(repo)?.repository;
    if (!repository) throw new QueueError('Configure a GitHub origin for this project.', 400);
    const slug = repository.slice('https://github.com/'.length);
    let user, project;
    try { [user, project] = await Promise.all([read(apiArgs('user')), read(apiArgs(`repos/${slug}`))]); }
    catch { throw new QueueError('GitHub access unavailable. Check gh authentication on the controller host.', 400); }
    if (!Number.isSafeInteger(user?.id) || !/^[A-Za-z0-9-]+$/.test(user?.login || '') || project?.full_name?.toLowerCase() !== slug.toLowerCase()) throw new QueueError('GitHub returned an unexpected identity or repository.', 400);
    return { repository, actor: user.login, actor_id: user.id, available: !project.archived && project.has_issues === true,
      labels_supported: Boolean(project.permissions?.push || project.permissions?.triage || project.permissions?.maintain || project.permissions?.admin),
      permission: 'GitHub checks Issues write permission when creating. No credentials are sent to the browser or jobs.' };
  },
    async publish(record) {
      const slug = record.repository.slice('https://github.com/'.length);
      const issue = await write(`repos/${slug}/issues`, { ...record.payload, body: `${record.payload.body}\n\n${marker(record)}` });
      return confirm(record, issue);
    },
    async recover(record) {
    const slug = record.repository.slice('https://github.com/'.length);
    const since = new Date(Date.parse(record.created_at) - 60000).toISOString();
    try {
      for (let page = 1; page <= 5; page++) {
        const result = await read(apiArgs(`repos/${slug}/issues?state=all&creator=${encodeURIComponent(record.actor)}&since=${encodeURIComponent(since)}&sort=created&direction=desc&per_page=100&page=${page}`));
        if (!Array.isArray(result)) throw new Error('Unexpected issue listing');
        const matches = result.filter(issue => !issue.pull_request && issue.user?.id === record.actor_id && issue.body?.includes(marker(record)));
        if (matches.length > 1) throw new Error('Multiple matching issues');
        if (matches.length === 1) return confirm(record, matches[0]);
        if (result.length < 100) break;
      }
    } catch { throw new QueueError(`Could not reconcile submission ${record.request_id}. No write was retried. Check GitHub access and retry recovery.`, 409); }
    throw new QueueError(`Submission ${record.request_id} is still unconfirmed. No write was retried. Inspect GitHub before creating another issue.`, 409);
  }
  };
}
