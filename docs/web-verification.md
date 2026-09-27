# Optional trusted web verification

Browser verification is an operator-controlled extension of the existing
Verify phase. It is disabled when `webVerification` is absent. Issue text,
candidate files and generated tests cannot enable it or change its required
stories. The selected harness and model remain independent of this capability.

## Prepare and qualify Playwright/Chromium

The first adapter uses the Playwright 1.63.0 package and Chromium version from
the matching Microsoft Playwright image. Build it explicitly on the execution
host from the installed Factory package (or a trusted Factory source checkout):

```sh
docker build --pull -f factory/web/Dockerfile \
  -t software-defence-factory-playwright:1.63.0 factory/web
docker image inspect --format '{{.Id}}' software-defence-factory-playwright:1.63.0
```

Copy the resulting `sha256:…` image ID into private `factory.json`. The
Dockerfile uses the versioned `mcr.microsoft.com/playwright:v1.63.0-noble`
base and `npm ci` with the committed lockfile. Factory resolves no tag, pulls
no image, installs no package and falls back to no other browser during a job.
Rebuild and deliberately select a new image ID when upgrading the base or
Playwright version.

For a global npm installation, resolve the packaged recipe directory first:

```sh
factory_package="$(npm root -g)/software-defence-factory"
docker build --pull -f "$factory_package/factory/web/Dockerfile" \
  -t software-defence-factory-playwright:1.63.0 "$factory_package/factory/web"
browser_image="$(docker image inspect --format '{{.Id}}' software-defence-factory-playwright:1.63.0)"
```

Run the readiness check from the selected installation:

```sh
factory web probe --state /private/state/project
factory doctor --state /private/state/project
```

The probe runs a real headless Chromium click and result assertion in a bounded,
read-only, `network none` Docker container as the controller UID. Its real
wall-clock deadline stops the exact labelled probe, and readiness is reported
only after that container is confirmed removed. A missing image, unsupported
adapter/version or browser launch failure reports unavailable. The probe never
downloads or builds an image.

## Configure trusted stories

Stop the installation before editing its private `factory.json`. Add an
operator-authored value like this and adapt names, routes, actions and result
text to the application:

```json
{
  "webVerification": {
    "enabled": true,
    "adapter": "playwright",
    "version": "1.63.0",
    "image": "sha256:REPLACE_WITH_LOCAL_IMAGE_ID",
    "previewCommand": ["npm", "run", "preview", "--", "--host", "127.0.0.1", "--port", "4173"],
    "port": 4173,
    "timeoutSeconds": 90,
    "themes": ["light", "dark"],
    "stories": []
  }
}
```

`stories` is a small declarative contract; the empty array in this sketch is a
placeholder and is rejected until the complete trusted story set is supplied.
Every selected theme requires an interactive `desktop-<theme>` and
`narrow-<theme>` story. All installations
also require these named stories, using the first configured theme at desktop
size:

- `busy-disabled`: click an action, observe its disabled state, wait for it to
  become enabled, and check the result text.
- `result`: exercise an action and assert its result text.
- `failure-retry`: assert a `role: "alert"` failure, click Retry, then assert a
  `role: "status"` result.
- `keyboard-focus`: press a supported key and assert the expected control has
  focus.

Each story names `viewport` (`desktop` or `narrow`), `theme` (`light` or
`dark`), a local `path` beginning with `/`, and ordered `steps`. Supported
steps are `click`, `expect-visible`, `expect-enabled`, `expect-disabled`,
`expect-text`, `press` and `expect-focused`. Actions and assertions use exact
accessible roles and names. Arbitrary selectors, JavaScript, source tests and
candidate-supplied story files are not accepted. `factory/web/qualification-fixture.mjs`
shows the complete eight-story contract used by the disposable installed
qualification.

`execution.json` freezes and hashes this complete operator configuration with
the attempt policy. The check evidence records the candidate head/tree, Verify
attempt, policy hash, immutable browser image ID, adapter/tool/browser versions,
story-set hash and each story's content hash. Any changed tree, tool, story or
policy makes prior evidence stale. Missing, failed, unavailable, inconclusive
or malformed required evidence blocks Review, handoff and trusted PR delivery.
The run summary and `web-verification.json` artifact are shared through CLI,
API and dashboard; the dashboard renders traces as text and retained PNGs as
images. It does not execute candidate HTML in the controller origin.

## Package and preview guidance

Use the configured project check for dependency preparation and build output.
For Node projects, install from the committed lockfile with the project's
frozen install command (for example `npm ci --ignore-scripts`), run the build,
then configure `previewCommand` to start the already-prepared local preview
from the project root in the disposable check copy.
The preview phase reuses that check's disposable scratch copy. It does not run
another install or contact a package registry. The qualified project job image
provides the preview runtime. Do not add secrets to the preview environment or
image.

Verify starts two containers with separate mount and PID namespaces. The
preview uses the configured project job image, the candidate at `/workspace`
read-only, and the writable `/scratch` copy. It runs as the controller UID with
`network none`, dropped capabilities, a read-only root and bounded resources.
The browser uses the pinned Playwright image as the same UID, with its own
read-only root, writable temporary profile and a separate private output mount.
It receives the frozen trusted stories on stdin and does not mount the
candidate, project scratch or controller results. The browser shares only the
exact preview container's `network none` namespace to reach its loopback port;
each container retains its own PID namespace. Neither container gets host
networking, published ports, extra capabilities, a Docker socket, controller,
forge or inference credentials, or a user profile.

The controller enforces a real wall-clock deadline, stops and reconciles both
exact labelled containers, then reads the bounded result and PNG screenshots
from the browser-only mount. The private result contains candidate/tree,
attempt, policy, pinned tool/image and story hashes, bounded action traces and
screenshot hashes. CLI, API and dashboard expose the same evidence; screenshots
can be viewed as images, and no candidate HTML is served on the controller
origin. Chromium is headless and uses the outer Docker boundary; this is not a
hosted browser service.

This adapter proves only Linux Chromium interaction with a local web preview.
It does not qualify Android/iOS, desktop-native applications, Safari, Firefox,
mobile operating systems, production access or an application's overall
correctness. Deterministic checks and independent Review remain separate.

## Installed synthetic fixture qualification

The release lead owns this Docker/browser qualification on the installed
execution host. Use a separate demo state, complete and inspect the demo's
normal sample handoff, stop that controller, then run the exact qualification
command with the already-built browser image ID:

```sh
factory demo --state /private/state/sdf-web-proof --port 7348
# Review and approve the synthetic demo task in its dashboard.
factory stop --state /private/state/sdf-web-proof
browser_image="$(docker image inspect --format '{{.Id}}' software-defence-factory-playwright:1.63.0)"
factory qualify-web --state /private/state/sdf-web-proof --image "$browser_image"
```

The installed command probes actual Chromium interaction, then runs a
disposable delayed-save/failure-retry fixture through mock Build/Review and
real Docker Verify. Its deliberate variant removes the busy disabled state and
changes the result text; Verify must fail and no acceptance record may appear.
The command records a private `qualification.json` under the demo state's
private qualification directory. It never targets an application or calls a
model/provider. Do not report this as passed until the lead observes the
installed invocation and its result.
