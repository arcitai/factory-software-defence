# Delivery record — one task

Use the relevant fields for a PR or private review. Sensitive artifacts stay private and are linked only from an authorized destination.

- User need, issue and accepted scope:
- Relevant design/contracts for a substantial change:
- Base commit, delivered commit and actually tested revision:
- Harness/model/environment versions and job/log reference:

| Slice and observable behavior | Before/after check, artifact and revision | Status and next step |
| --- | --- | --- |
| Complete relevant rows | Label mocks, missing baselines and live integrations | Passed / failed / blocked |

- Required checks, command/check ID, exit/result and evidence:
- Separate reviewer, revision and disposition:
- Change risk, security checks, findings and fix verification, or justified not applicable:
- Remaining uncertainties, recovery and next action:
- Delivery state: local / PR / accepted / merged / deployed / observed. Report only completed actions.

| Measurement | Value and coverage |
| --- | --- |
| Quality | Accepted / changes / failed / blocked / open; who assessed what? |
| Total direct cost | Inference, review, compute and every attempt; measured / estimated / unknown |
| All human time | Scoping/design, assistance, review and operations; identify missing coverage |
| Elapsed time | Start/end and active time; unfinished work has no final time-to-acceptance |
| Defects after acceptance | Regression, revision and observation window; not yet observed is valid |

Green checks on another revision or a model score cannot replace review of the delivered change. Merge and deployment follow the separate installation authority.
