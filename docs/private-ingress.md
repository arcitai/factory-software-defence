# Private operator access

Foundation first records the execution host/workload, intended operator route
and approved identities/devices. Loopback plus authenticated SSH forwarding is
the default for every project. Remote HTTPS is an explicit private installation
choice; setup never publishes the Inbox. Keep a working SSH route until the
replacement passes the checks below. Operator ingress does not change worker
egress, native tools, credentials, permission hashes or the adopted method.

The optional ingress uses an existing OS/native authenticated HTTPS proxy. The
proxy owns TLS, requester authentication, authorization, startup and reconnection.
Factory adds a Unix socket to the same handler, native engine, session and
maintenance gate. TCP remains bound to `127.0.0.1`, accepting only exact
`localhost:PORT`/`127.0.0.1:PORT` Host values and their HTTP origins. Neither
proxy identity nor forwarded headers broaden that TCP rule.

## Stage the installation choice

Select a reviewed installed package supporting `factory ingress` first. Existing
user services must adopt that compatible package while idle **before** opting in.
Older loopback-only state remains supported without a sidecar. No dashboard source,
method YAML or portable ADLC file carries private origin or identity details.

Stage these three items together in the private installation record:

1. Native proxy/tunnel configuration targeting `/absolute/private/factory-state/inbox.sock`.
2. The exact HTTPS origin and the proxy-supplied authenticated identity header.
3. Actual access policy restricting approved identities **and devices**, including
   any node sharing. An authenticated VPN or same-tailnet membership alone is
   insufficient. Stage a narrow policy diff for owner review if a change is needed;
   preserve unrelated service access and do not enable a public listener/Funnel.

The state is owned by the Factory OS user with mode `0700`; its socket is `0600`.
The proxy must run as that same user or an already authorized root/native service.
Do not grant a group access to the state or relax its permissions to make a proxy
connect. The full socket pathname must fit Linux's 107-byte limit. A separate
configuration under a shared user is not OS isolation: that user and root can
impersonate the proxy. Qualify the host boundary separately.

The proxy must preserve the browser Host/Origin, strip all client-supplied copies
of the chosen identity header and set **one** authenticated value. It must never
substitute localhost Origin or use unvalidated forwarded headers for identity.
Factory ignores `Forwarded`/`X-Forwarded-*` for authorization. Use the exact Host
authority and Origin below; no wildcard, suffix, path, credential or alias matches.

Create an owner-private staged JSON file outside source (substitute your values):

```json
{
  "version": 1,
  "origin": "https://inbox.example.net",
  "identity_header": "x-operator-identity",
  "identities": ["approved-login@example.net"]
}
```

The four keys are the complete version-1 shape. Use a lowercase canonical HTTPS
origin with no trailing slash; omit default port `443`, or include an exact
nondefault port such as `:8443`. The custom identity header is lowercase and may
not be a standard HTTP/security/forwarded header. Identities are distinct literal,
case-sensitive printable ASCII values without whitespace or commas (1–32 values).
Wildcards are refused; there is no identity pattern or role expansion. Keep this file, `ingress.json`,
prior configurations and policy evidence private; no credentials belong in it.

Inspect work through the owning bridge and wait for idle/reconciled ownership.
If the bridge or a writer is unknown, follow [recovery](recovery.md) first. Stop
through the supported service operation; do not kill an active job for setup:

```sh
factory status --state /absolute/private/factory-state
factory service status --state /absolute/private/factory-state
factory service stop --state /absolute/private/factory-state
chmod 600 /absolute/private/staged-ingress.json
factory ingress setup --file /absolute/private/staged-ingress.json --state /absolute/private/factory-state
factory service start --state /absolute/private/factory-state
factory ingress status --state /absolute/private/factory-state
factory service status --state /absolute/private/factory-state
```

For manual operation, stop only a reconciled idle `factory serve`, run ingress
setup, then restart it with the same state/port. Configuration is read once at
startup, never hot-reloaded. Setup/removal refuse active/unknown process ownership,
an unresolved startup gate, pending maintenance/adoption or an incompatible
pinned service. Replacement/removal retains the previous valid config privately
as `ingress.previous-UUID.json`. Status shows configured vs owning live listener
and their configuration digests, without origin/identity values. A listener or
matching digest does not qualify the proxy, TLS or access policy.
An opted-in bridge with either listener still starting or already closed refuses
HTTP access; partial startup cannot bootstrap a session or admit native work.

## Optional Tailscale Serve recipe

Tailscale is one native transport choice, not a Factory dependency. This recipe
uses the existing authenticated tailnet and Serve, never Funnel. Consult the
[Serve documentation](https://tailscale.com/docs/features/tailscale-serve) and the
installed binary's help. Tailscale 1.102.3 supports `unix:/path`; Unix targets
require root. Preserve any existing Serve configuration and do not replace
unrelated routes. The following assumes the selected HTTPS listener is unused.

Owner prerequisites, before enabling the endpoint:

- Confirm the intended node name and exact tailnet HTTPS origin, private HTTPS
  readiness (MagicDNS/HTTPS prerequisites) and certificate consent. Follow native
  owner steps if they are needed; binary discovery does not establish a certificate.
- Inspect effective tailnet grants/ACLs and node sharing for this node/port.
  Restrict approved operator identities/devices deliberately; test that restriction.
  An allowlisted login prevents a future different identity from using Factory,
  but devices using that same login still need native access-policy restrictions.
- Confirm incoming identity headers are stripped and Serve supplies requester
  identity. Use `tailscale-user-login` with the exact allowed login(s) in the JSON.
  Tagged clients do not receive these identity headers and are refused by this
  contract. Do not replace missing identity with a static owner value.
- Keep Funnel disabled and record that no public listener/firewall exposure was
  enabled. One owner's node status is not evidence of policy or denied access.

Read-only inspection and, only after the selected prerequisites and owner
authorization, the native endpoint command:

```sh
tailscale version
tailscale serve --help
tailscale serve status --json
tailscale funnel status --json
sudo tailscale serve --bg --https=443 unix:/absolute/private/factory-state/inbox.sock
tailscale serve status --json
tailscale funnel status --json
```

The proxy must present the selected HTTPS Host unchanged. If the native route
does not satisfy that contract, keep SSH and record the gap; do not weaken the
handler or introduce an Origin-rewriting helper. Record native boot/network and
certificate prerequisites. `--bg` delegates persistence to the native service;
test reconnection and an idle restart rather than claiming an untested reboot.

## Qualify the actual route

Do this through the approved remote device's HTTPS URL using the exact reviewed
installed bytes. Save evidence privately, redacting the nonce and identities in
public reports. A direct local Unix request is a useful synthetic boundary probe,
but it cannot prove proxy authentication, header stripping, TLS or device policy.

- Load `/` and its JS/CSS/fonts; use the unchanged Inbox at desktop and narrow
  widths. Exercise project/status/filter rail, list, Kanban and detail, keeping
  native completion separate from accepted delivery.
- Read `/api/v1/bridge/status` to bootstrap its session; use `x-factory-session`
  for `/api/v1/issues` and other protected reads. Bootstrap/status remain reachable
  without a Factory nonce only after the route's Host/Origin/site/identity checks.
- POST a harmless template draft to `/api/v1/issue-templates/draft` using existing
  template/sha/title/answers fields, or preview an existing issue. Never create a
  real issue or admit native work to test ingress.
- Protected reads and draft requests with missing/invalid/duplicate session must
  fail. Malicious/unconfigured Host and Origin, `Origin: null`, cross-site requests
  and duplicate security headers must fail. Forwarded Host/Origin or an injected
  owner identity must not convert a refused request into an authorized one.
- Through the real proxy, inject fake identity headers from an unauthorized
  client: prove stripping/authentication, not just an HTTP rejection at the socket.
  Absent, duplicate, malformed or unallowlisted identity at Unix ingress must fail.
- Repeat forged external Host/HTTPS Origin with forwarded/identity headers on the
  TCP loopback/SSH route; it must remain refused. Ordinary localhost/SSH still works.
- Test an approved device, a denied tailnet identity/device where possible, and
  an off-tailnet client. Distinguish HTTP identity refusal, native device denial
  and off-tailnet inaccessibility. Record unavailable denied-device proof as a
  concrete readiness gap. Inspect Funnel/public exposure independently.

For reproducible HTTP probes, use the approved remote device with `curl` and a
private header file to keep the bootstrap session out of command arguments:

```sh
curl --fail --silent --show-error https://inbox.example.net/api/v1/bridge/status
curl --fail --silent --show-error --header @/absolute/private/session.headers https://inbox.example.net/api/v1/issues
curl --fail --silent --show-error --header @/absolute/private/session.headers --header 'Origin: https://inbox.example.net' --header 'Content-Type: application/json' --data-binary @/absolute/private/draft.json https://inbox.example.net/api/v1/issue-templates/draft
curl --silent --show-error --output /dev/null --write-out '%{http_code}\n' https://inbox.example.net/api/v1/issues
curl --silent --show-error --output /dev/null --write-out '%{http_code}\n' --header 'x-factory-session: invalid' https://inbox.example.net/api/v1/issues
curl --silent --show-error --output /dev/null --write-out '%{http_code}\n' --header 'Origin: https://evil.example.net' https://inbox.example.net/api/v1/bridge/status
curl --silent --show-error --output /dev/null --write-out '%{http_code}\n' --header 'Host: evil.example.net' --header 'X-Forwarded-Host: inbox.example.net' https://inbox.example.net/api/v1/bridge/status
curl --silent --show-error --output /dev/null --write-out '%{http_code}\n' --header 'Sec-Fetch-Site: cross-site' https://inbox.example.net/api/v1/bridge/status
```

The private header file contains `x-factory-session: TOKEN` from that same
instance; restrict it to `0600` and remove it after the probes. Proxy errors are
not automatically evidence of Factory's rejection; identify which layer denied
the request. Collect actual negative-identity/header-spoofing evidence separately.

## Reconnect, retain or remove deliberately

Reopen the native connection/Inbox and bootstrap the current session after a
restart; never replay a native write. Release adoption retains the selected
sidecar and requires matching live ingress from compatible prior/target releases.
It does not reconfigure or certify the external proxy/access policy. Repeat the
approved/denied route checks after adoption or policy/certificate changes.

To roll back an unqualified replacement, keep or reopen SSH first. Inspect work,
stop the idle reconciled Factory service, then disable **only** the endpoint you
created, preserving other proxy configuration. For the isolated Serve listener
above, the narrow removal is:

```sh
sudo tailscale serve --https=443 off
tailscale serve status --json
tailscale funnel status --json
factory ingress remove --state /absolute/private/factory-state
factory service start --state /absolute/private/factory-state
factory ingress status --state /absolute/private/factory-state
```

Removal leaves native config, credentials, jobs/history and saved ingress configs
intact. To restore a prior ingress, use `ingress setup --file` with its retained
private JSON at a stopped, reconciled installation, restore only its approved
native proxy/policy configuration and requalify. Never silently expand identities,
enable Funnel, relax state permissions or change worker egress to fix operator access.
