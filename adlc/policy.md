# Factory policy

The project instructions and the user's existing authority govern the work. This method does not grant credentials or publication rights. A concrete installation must enforce access, concurrency, resource limits, checks and release rules.

## Delivery

1. Scope the user need, observable outcome, allowed changes and verification. For substantial work, capture the relevant architecture/contracts and first runnable slice. Reuse already accepted decisions.
2. Implement one observable vertical slice through the necessary layers, then exercise its behavior and meaningful failure cases before extending it. Preserve revision, evidence and next steps. Continue through the accepted scope without a new approval per slice; one completed slice is not acceptance of the entire job.
3. Obtain a separate review of the exact delivered revision and required checks. Use the [delivery record](delivery.md). Local completion, PR, merge, deployment and post-release observation are separate statuses and authorities.

One writer owns each workspace. Worktrees alone do not isolate accounts, ports or databases. Reconcile unknown workers before replacements, retain evidence before cleanup, and keep acceptance criteria and evaluator resources outside the implementer's control. An agent report is not independent verification.

## CI and CD

Use the application's existing reproducible checks, language versions and release pipeline. Relevant test-first work is useful when it captures a real behavioral regression; tests alone do not replace exercising the integrated path.

CI validates a known revision. Agent dispatch requires an authorized actor, accepted scope and capacity. Deployment follows explicit environment/release rules with separate credentials and recovery. Post-release verification measures actual delivery effects; ongoing incidents belong to the selected operational owner.

With GitHub Actions, use minimal permissions, reviewed commit-pinned actions, timeouts and concurrency. Untrusted PR code receives no deploy/model credentials and runs in an appropriate isolated environment. Do not run it through privileged pull_request_target or assume a persistent self-hosted runner is safe. Service-side branch and environment protections must actually be configured; documentation does not activate them. Avoid spending hosted minutes solely waiting for a long agent run.

## Security and relative risk

Assess consequences, exposure, affected data/users, detectability, recovery and uncertainty. A small diff or solo project does not imply low risk. Assess at intake and again against the delivered change. Unknown risk stays unknown and newer revisions require relevant refreshed checks.

- At adoption, identify sensitive data, access, dependencies, trust boundaries and a private finding channel.
- For every change, run the agreed relevant checks. Tool failure or skipped checks do not constitute a clean scan.
- Changes to authorization, payment, sensitive data, network input, CI/agent policy or trust boundaries need appropriate scoped security review and reproduction where a credible finding exists.
- Validate concrete findings or relevant advisories, fix within authority and demonstrate vulnerable-before/fixed-after behavior. Keep raw findings private.
- Select broader release/periodic scans according to exposure, change and budget. Active external or production testing needs explicit bounded authority.

Available security specialists may help, but no plugin or model access is bundled by a skill. A model name, numeric judge score or successful scan cannot prove security.

## Defence and operations

The optional defence workflow may share the installation/dashboard while retaining separate scope and authority. Incident investigation can cover software developed elsewhere. Convert a validated finding into a bounded software task with system/revision, impact, evidence and acceptance criteria. Software checks the repair; deployment and recovery verification follow their own policy. Shared UI grants no new production access.

## Measurements

Record acceptance/quality, total direct cost, all human time, elapsed time and observed defects after acceptance. Retain failed attempts and repair/review/selection cost. Unknown is null, not zero; distinguish estimates from measurements. Model/skill comparisons require matched tasks, frozen versions, retained input digests and independent evidence. A synthetic fixture or token-throughput result is not business ROI.

Format/service references: [Agent Skills](https://agentskills.io/specification), [GitHub Actions security](https://docs.github.com/en/actions/reference/security/secure-use), [deployment environments](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments). These document formats and service behavior, not this installation's configuration.
