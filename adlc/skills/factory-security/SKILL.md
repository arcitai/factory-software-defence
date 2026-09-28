---
name: factory-security
description: Perform the bounded security review requested by a factory task and separate candidate findings, validation and verified remediation.
---

# factory-security

Confirm the authorized repository, revision and attack surface. Identify trust boundaries and sensitive data relevant to the change. Review source-to-sink paths, make safe local reproductions, and separate credible findings from uncertain hypotheses and generic hardening suggestions.

For each finding preserve location, attacker-controlled input, prerequisites, impact, evidence, remediation and a check that distinguishes vulnerable from fixed behavior. A scan completing is not proof of no vulnerabilities. A patch compiling is not proof of remediation. Report inconclusive when evidence cannot be obtained.

If Codex Security is installed and available, use its applicable scan, diff review, validation or fix-verification workflow within the task's authorized scope. This repository does not bundle that plugin or promise Daybreak API access. Another model can be used only with the selected profile's tools and the same evidence standard.

Use private artifacts for sensitive findings; publication and network testing are not implied by this skill. A specialist result is input to the owner's final acceptance, not automatic merge authority.
