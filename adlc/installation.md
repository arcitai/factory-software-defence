# Application installation record

**Status: not configured.** Fill this from the repository and accepted owner choices. This document is not machine-enforced configuration. Store no secrets. Missing information blocks only the capability that needs it.

| Choice | Project answer and evidence |
| --- | --- |
| Repository, owner and main branch | Unselected |
| Existing instructions, product brief, architecture and non-goals | Reference existing sources |
| Observable user/API behavior and design source | Name representative checks and fixtures |
| Control surface | Existing issue/check/PR workflow unless otherwise selected |
| Harness, version, model/provider and billing | Unselected |
| Execution environment and necessary tools | Files, Git, shell and tests; browser for UI; other tools as needed |
| Worker boot and operator login | Disk unlock, SSH/network/Docker/model startup, selected services, timer and observed reboot evidence; not applicable for method-only use |
| Start, stop, routing owner and recovery | Manual until automation is qualified; one owner per job |
| Authority and allowed network/credential references | Identify permissions without key values |
| Time, concurrency, attempts and actual provider stop limits | Unknown until exercised |
| Setup, dependencies, toolchain and test data | Exact commands and versions |
| Required checks and tested revision | Real commands/check identifiers |
| CI runner, allowed code, caches and artifact retention | Unselected |
| Security, risk context and private finding channel | Data, exposure, critical paths, recovery and relevant controls |
| Branch/PR/review rules | One writer; established review and publication authority |
| Deployment, rollback and post-release verification | No deployment unless configured and authorized |
| Data destinations, regions, private logs and backups | Record allowed locations and retention |
| Cost, human time and quality measurements | Record source and unknown coverage |

## Qualify the selected combination

Record date, revision, result and artifact for each relevant check:

- The harness can discover the selected instructions and use the required tools.
- A real bounded app task and its meaningful regression checks work.
- Failed/missing checks and stale evidence cannot produce acceptance.
- A representative deliberate failure is detected while the baseline passes.
- The agent cannot read controller/admin credentials or private evaluator inputs.
- Separate review and any authorized PR workflow function.
- The chosen cloud job can be revisited after closing its client, if applicable.
- An automated trigger produces one job; duplicates, cancellation and restart are handled.
- Actual spend/resource stops work before unattended paid use.
- Release and rollback work in the selected test environment, if connected.

Distinguish synthetic fixtures, live integrations and actual model runs. Qualification covers the tested repository/harness/model/environment combination; material changes require relevant requalification. Do not claim unattended operation from configuration alone.
