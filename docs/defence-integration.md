# Defence integration

The optional defence workflow receives a bounded incident record through:

```sh
factory incident --file /private/path/incident.json --state /private/state/my-app
```

Use factory/examples/incident.json as the input schema example. Intake validates scope and evidence, records a digest and deduplicates the event identity. Evidence and reports remain in the private installation. Do not place customer findings in public issues or source control.

The agent gets supplied evidence and read-only code. Its report distinguishes observations, hypotheses, recommended actions and unknowns. Production action is false; verification remains not_performed and the case remains open. A successful draft is not a resolved incident or proven root cause.

A validated finding can become a separately scoped software repair with its affected revision, impact, reproduction and acceptance check. Software review verifies the fix; deployment and post-release recovery verification remain governed by the target system's authority. Shared UI does not grant shared production access.

There are no automatic log subscriptions, live production connectors or scheduled incident polling in this release. The Automations page therefore explains that work starts manually. Configure and qualify those capabilities independently before making operational claims.
