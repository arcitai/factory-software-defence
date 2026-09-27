import { readinessMapping } from './issue-lifecycle.mjs';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, digest, harnessOf } from './lib.mjs';
import { expectedWebStories, webPolicyHash } from './web-verification.mjs';

// Execution order is shared with the queue; presentation cannot invent phases.
export const WORKFLOWS = Object.freeze({
  software: Object.freeze(['build', 'verify', 'review', 'handoff']),
  defence: Object.freeze(['defence']),
});
const phaseInfo = {
  build: { title: 'Implement', owner: 'agent', skills: ['factory-implement'], description: 'Implement the accepted scope in an isolated checkout. Produce a candidate and evidence.' },
  verify: { title: 'Check', owner: 'factory', skills: [], description: 'Run project checks and any optional trusted browser stories against the candidate. Missing or non-passing required proof stops delivery.' },
  review: { title: 'Review', owner: 'agent', skills: ['factory-review', 'factory-security'], description: 'Review the candidate and evidence in a separate agent invocation. Security review applies when required by the accepted scope.' },
  handoff: { title: 'Accept & hand off', owner: 'operator', skills: [], description: 'Wait for operator approval, then confirm the candidate and policy still match the checks and review. Record acceptance; do not push, merge or deploy.' },
  defence: { title: 'Investigate', owner: 'agent', skills: ['factory-security'], description: 'Investigate supplied incident evidence within the accepted scope. Produce a private draft with findings and unknowns. No production access or recovery action is granted.' },
};
const skillRoles = {
  triage: 'Prepare incoming work before admission', spec: 'Define scope and acceptance before admission',
  implement: 'Implement an accepted software task', review: 'Independently assess a candidate',
  security: 'Assess security within the authorized scope', evaluate: 'Compare configurations in a separately scoped evaluation',
};
export function factoryDefinition(config) {
  const harness = harnessOf(config);
  const skills = Object.entries(skillRoles).map(([role, purpose]) => {
    const id = `factory-${role}`, path = `kit/skills/${id}/SKILL.md`;
    const content = readFileSync(join(ROOT, path), 'utf8');
    return { id, purpose, path, content, sha256: digest(content) };
  });
  const workflows = Object.fromEntries(Object.entries(WORKFLOWS).map(([name, phases]) => [name, phases.map(name => ({ name, approval: name === 'handoff' }))]));
  return {
    version: 1, workflows, terminology: JSON.parse(readFileSync(join(ROOT, 'factory/terminology.json'), 'utf8')),
    agents: Object.entries(phaseInfo).filter(([, info]) => info.owner === 'agent').map(([phase, info]) => ({
      id: phase === 'build' ? 'implement' : phase === 'defence' ? 'investigate' : phase,
      phase, title: info.title, responsibility: info.description, harness, model: config.model || null, skills: info.skills,
    })),
    operator_skills: [foundationSkill()],
    automations: { owner: 'harness', harness, managed_by_factory: false, discovery: 'unavailable', items: null },
    commands: Object.entries(phaseInfo).map(([name, info]) => ({ name, ...info, prompt: info.description,
      executor: info.owner === 'agent' ? harnessOf(config) : 'factory', timeout: `${config.timeoutSeconds}s` })),
    skills,
    configuration: { issueReadinessLabels: readinessMapping(config.issueReadinessLabels), harness, agent: harness, // agent is a v1 compatibility alias
      model: config.model || null, check: config.check, timeoutSeconds: config.timeoutSeconds,
      memoryMiB: config.memoryMiB, cpus: config.cpus || 2,
      web_verification: config.webVerification?.enabled ? {
        enabled: true, adapter: config.webVerification.adapter, version: config.webVerification.version,
        browser: 'chromium', image: config.webVerification.image, policy_hash: webPolicyHash(config.webVerification),
        required_stories: expectedWebStories(config.webVerification), platform: 'linux-container', coverage: 'web',
      } : { enabled: false },
    },
    method: {
      preparation: ['factory-triage', 'factory-spec'], evaluation: ['factory-evaluate'],
      instructions: 'All six skills are available read-only to agent phases. A skill is an instruction set, not a separate agent or an automatic workflow step.',
      customization: 'Choose the harness, model, project check and resource limits in the installation’s private factory.json while stopped, then restart. Task scope belongs in the issue or work instructions. Phase order, gates and packaged skills change through a reviewed Factory release; they are not editable prompt templates.',
    },
  };
}

export function foundationSkill() {
  const path = '.agents/skills/factory-foundation/SKILL.md';
  const content = readFileSync(join(ROOT, path), 'utf8');
  return { id: 'factory-foundation', purpose: 'Prepare a repository and host for bounded Factory work', path, content, sha256: digest(content) };
}
