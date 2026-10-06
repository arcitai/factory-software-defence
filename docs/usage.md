# Harness usage

Open **Usage** in the dashboard sidebar to see the limits reported by connected
Factory profiles. `factory usage --state /absolute/private/factory-state` returns
the same projection as JSON. The read does not require a running dashboard.

Each window shows its percentage used, remaining percentage and reset time.
These are account limits, including work outside this project. Windows and
profiles are independent; their percentages must not be added together.
A session's tokens and API-equivalent cost are different measurements and are
not converted into subscription usage or charges.

The configured harness appears automatically. To include another existing Factory
profile, link its state explicitly:

```sh
factory usage link --state /absolute/private/factory-state \
  --from-state /absolute/private/other-factory-state
factory usage unlink --state /absolute/private/factory-state \
  --from-state /absolute/private/other-factory-state
```

Linking adds read-only usage visibility. Execution stays with the configured
harness. Credentials stay in their native profiles. Factory does not search for
personal profiles. Up to four additional profiles can be linked; repeated links
to the same profile are deduplicated. Different profiles may share an account.

Reads are coalesced and cached for two minutes in the serving process. Use
**Refresh** to read again; the cache also bounds repeated clicks. A failed read
retains a previous reading as **Last known**, with its original timestamp.
Without a reading, the panel shows **Unavailable**. Passing a reset time does
not prove that quota has reset or that execution is permitted.

Codex uses its native `account/rateLimits/read` contract, including named buckets
and their reported durations. Claude uses the pinned CLI's experimental
`get_usage` control request with `skip_behaviors: true`; no prompt is sent, no
session is saved and local transcripts are not scanned. This native endpoint can
return no quota data even for a signed-in subscriber. Factory preserves that
unknown. When native Claude work reports quota windows, Factory keeps one small
sanitized observation in that selected private profile. A direct read without
limits can show this observation for up to one hour as **Last known**, retaining
its original time. It contains only reported windows, not transcripts or tokens.
It survives a bridge restart, but expired or malformed observations are ignored.
CLI upgrades require requalification, including the experimental read.
The timestamp records when Factory received the native answer; the harness may
itself return cached data without a server timestamp.

The dashboard endpoint requires the existing same-origin session. Only normalized
limits reach the browser; native account IDs, credentials and profile paths do
not. Reading limits cannot start work, spend credits, change models or authorize
retrying a failed task.
