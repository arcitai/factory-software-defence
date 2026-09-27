# Roles, skills and work

Read [Factory concepts](concepts.md) for the shared vocabulary. Inspect the actual
installation with `factory definition --state PATH`, or its
Agents, Skills and Definition pages. Both read the same effective catalog.

Software follows **Implement → Check → Review → Accept & hand off**. Implement
and Review are separate agent invocations using their resolved role profiles.
Check runs the project's command. Accept requires operator approval and confirms
that the candidate and policy still match their evidence. It does not push,
merge, deploy or publish. Revisions start a new build/check/review and preserve
the failed attempt.

Defence currently runs **Investigate** against supplied scoped evidence and
produces a private draft. It is not production monitoring, exploitation or
verified recovery. See [Defence integration](defence-integration.md).

The six bundled job skills in `kit/skills/` cover triage, specification, implementation, review,
security and evaluation. They are instructions, not six running processes.
All are mounted read-only for agent steps; the role prompt supplies the work
boundary. Triage/specification prepare scope before admission; evaluation is a
separately scoped comparison. Factory Foundation is an operator setup skill,
at `.agents/skills/factory-foundation/SKILL.md`, used explicitly for adoption
and kept outside those execution mounts. CLI/API/Skills show actual installed
paths, content and SHA-256. Codex additionally mounts the same runtime catalog at
`/etc/codex/skills`; Pi uses `--skill /factory-skills`. Discovery on a particular
image needs native qualification, and skills provide neither tools nor access.

## Start work

Inbox opens on the shared list/Board of repository issues and local work, with
status rail and workflow/model/status/label multiselects. Never-started issues
have unknown workflow/model and a distinct Not started state. Choose Open, Closed or All states and use
Previous/Next page or Refresh issues. Search covers the loaded page and visible
history, not the whole repository. GitHub returns up to 50 records per page;
pull requests are excluded, so even a page with zero issues can have a next page.
Counts name the loaded page and total remains unknown. Authentication/provider
failures are visible, with any retained page explicitly stale.

Open an issue for its context, readiness, and linked execution attempts. Start
work is deliberate; browsing never starts an agent. Active or unresolved work
blocks another admission for the same canonical identity, including concurrent
requests and retries. Completion/cancellation permits a subsequent explicit
attempt. Failed work stays in history; blocked/interrupted work must first be
reconciled or cancelled, and unresolved provider delivery continues to block.
Closed issues and blocked/conflicting readiness labels cannot start new work.
No readiness labels means unknown, not ready or running. Readiness is planning
metadata; Needs triage never means an agent is Triaging.

**New issue** only composes/publishes: choose a repository template (or **Blank
issue**), complete the title and fields, then Continue and Create issue. Done
returns to Inbox, where the new issue appears without a job. Refresh also finds
issues created directly on the forge. Existing issue selection is in Inbox.

Review the instructions and suggested work type before explicitly starting work. The shared,
deterministic suggestion prioritizes `track:software` and `track:security` (also
`track:defence`/`track:defense`) labels. Without a track label, explicit incident
investigation wording suggests Defence; otherwise Software is the default.
Conflicting labels request a choice. This is a simple editable suggestion, not a
model assessment or permission to act. A security code fix can remain Software.
Both sources support either type; Defence still produces a private draft.

The **Source ref** option applies to the configured local Git repository. Leave
it blank to use the configured default ref, or enter a branch, tag, `HEAD` or
full commit SHA. The controller resolves it and retains the commit before
admitting the job; the task and any linked issue cannot select another
repository. Status and task details show the requested ref and resolved SHA.

Repository templates are read from `.github/ISSUE_TEMPLATE` on the default
branch through GitHub's API. Markdown templates and YAML markdown, input,
textarea, dropdown (including multiple choices) and checkboxes are supported.
Required fields/defaults are preserved; compilation checks the template SHA
again and refuses a changed form. Unsupported forms (including uploads) stay
visible with a GitHub link instead of silently dropping fields. Contact links
preserve the project's private security reporting route. Template Markdown is
shown as literal text, never executed or rendered as raw HTML.

On a supported repository, **Create issue on GitHub** writes the title, description
and template labels to that repository using the displayed host identity. It
returns the real issue number/link and **does not start execution**. Select
**Done**, then open the issue in Inbox and choose **Start work**.
Choose **Local execution request** in Inbox to submit a brief without publishing it. On unsupported hosts, New issue also offers this explicitly local route. A local
brief is an execution request; an unfinished form is not a persistent backlog.
Use the private security contact route for sensitive reports, never a public issue.

The controller records a durable creation receipt before calling the provider.
After a timeout, **Check submission** or `issue recover` looks for the original
result; it never blindly repeats a write. Reuse the same request key on CLI retries.
Changed content/identity with that key is rejected. An unresolved result stays
unconfirmed rather than risking a duplicate. Confirmed missing labels are shown;
GitHub projects, assignees and arbitrary issue form extensions are not applied.

CLI equivalents (the selected controller must be running):

```sh
factory issue connection --state PATH
factory inbox --state PATH --page 1 --issue-state open
# Explicit legacy execution-only JSON array:
factory inbox --state PATH --source factory
factory issue templates --state PATH
factory issue draft --state PATH --template bug-report.yml --sha TEMPLATE_SHA --file answers.json > draft.json
factory issue create --state PATH --draft draft.json --key release-board-fix-01
factory issue submissions --state PATH
factory issue recover --state PATH --key release-board-fix-01
# Explicit execution, independent of creation:
factory issue start --state PATH --url URL --workflow software --brief-file operator.md
factory issue start --state PATH --file brief.md --title "Investigate supplied evidence" --workflow defence --source-ref main
```

`--brief-file` is optional, UTF-8, at most 16000 characters and valid only with
a remote issue start. Use `--file` or `--draft` alone for local scope. Inbox
defaults to a repository page with linked history; `--issue-state closed` or
`all` and `--page` browse further without starting work.

`answers.json` contains `{"title":"Fix the board","answers":{"problem":"..."}}`;
keys match `fields[].id` in `issue templates`. Multi-select/checkbox answers are
arrays of exact option labels. `issue create` now publishes only; migrate 0.5.1
execution scripts to `issue start`. Legacy `run` remains compatible. Typed private
incident admission remains `incident --file`, distinct from a generic Defence brief.
`--source github` remains an alias for repository listing; `--github URL` remains a compatibility alias for `--url URL`.
`run` and `issue start` accept the same `--source-ref`; `init --source-ref` sets
the configured default. A revision keeps the admitted SHA unless an explicit
new ref is supplied. Every revision gets a fresh implementation, check and
review sequence while earlier source records and evidence remain available.

Provider selection and unknown-host behavior are documented in [integrations](integrations.md).
View repo uses the browser's own login. Factory's provider uses the controller
host identity; neither shares credentials with the browser or job containers.

## Scheduled work

Configure schedules in the selected harness, where supported (for example Codex
Automations). The scheduled agent calls Factory CLI/API with explicitly selected
scope. Factory owns execution, checks and acceptance, not the external schedule.
There is no Factory cron module, issue watcher or silently enabled automation.
The Automations view identifies this owner; it does not claim to discover external
schedules. Before enabling one, test its host availability, access, duplicate
handling, resource limits and stop behavior. No schedule is created by onboarding.

## Change the definition

Version 0.14.0 supports portable harness/model selections for Implement, Review
and Investigate. Use the shared [role definition workflow](definition.md) to
export, validate, preview, apply while idle and roll back. Missing overrides
inherit the exact private installation profile. Shared checks/resources remain
in private `factory.json`; workflow order and packaged skills follow reviewed
Factory releases. Broader definition editing stays under #53.


Inbox groups URL case, HTTP/HTTPS, trailing-slash, query and fragment aliases by GitHub
repository and issue number. Credential-bearing URLs, queries, foreign hosts and
non-issue paths are not admitted by the provider preview. Local-only records and
executions whose source is missing, closed or outside the loaded page remain in
Local and other execution history. Removing local execution history preserves
private evidence and never deletes a provider issue; unresolved delivery guards
still apply. The primary list/board includes all these records; no separate
Execution history tab is needed. Its count line distinguishes issue identities
and individual executions. Open a record for progressive context and every
linked attempt; close/Escape returns to the preserved filters, view and scroll.
