# Offline desired definition and staged adoption

Issue [#134](https://github.com/arcitai/factory-software-defence/issues/134), slice 1,
adds reviewable desired inputs. It does not configure or qualify a native worker.
Our `factory/v1alpha1` format is independent of Warp's format. Warp's inspected
validator submits a tree to a server; this implementation must work offline.

## Caller and ownership sketch

The selected caller contract is:

```sh
factory definition validate --file ./factory.yaml --repo /absolute/project
factory kit --definition ./factory.yaml --repo /absolute/project --output ./new-kit
```

`--file`/`--definition` is explicit, resolved from the caller's working directory,
and may be in a separate configuration directory. `--repo` is an explicit existing
project directory; every reference is relative to its real root, never the YAML
directory. No Git remote or provider is selected or discovered here. References
use portable slash-separated local paths without `.`/`..` components, absolute
paths, backslashes or symlinks. Vision/instructions are nonempty UTF-8 `.md` files;
each selected skill is a directory with a nonempty UTF-8 `SKILL.md`. Supporting
files under that directory are copied as bytes. Select only public material;
private installation directories and Factory's source contributor contract are
excluded. Overlapping skills are refused.

| Owner/data | Responsibility |
| --- | --- |
| Project definition | `schemaVersion`, `name`, `project.vision`, `project.instructions`, `harness: codex`, `method.skills`; desired local Markdown/skill selection |
| Plain `factory/definition.mjs` functions | Parser limits, schema checks, local reference resolution, immutable byte snapshots, normalized JSON projection and digest |
| CLI and kit exporter | Read/validate explicitly; stage a snapshot into a fresh directory; no adoption/apply |
| Private installation | Resolved host paths, `native.json`, writer, receipts and service pins; unchanged |
| Native Codex | Model, login, permissions, connections, execution and history; unchanged |
| Repository provider | Source phases, templates/labels and repository identity; unchanged |
| Project checks and independent reviewer | Accepted delivery; never inferred from valid YAML or a completed native turn |

Validation emits JSON with `valid`, schema version, raw definition SHA-256,
combined snapshot SHA-256, normalized desired definition, public relative file
references with SHA-256/byte count, and explicit unqualified execution status.
Errors carry stable codes, file, line and column. No host paths or reference
contents appear in the successful public projection. Custom skill selections can
be valid desired inputs; none is mapped to the active six-skill native profile.

The definition kit contains `project/factory.yaml` (the original bytes) and
selected references under `project/` at the same relative paths. Its definition
can be revalidated with `--repo NEW_KIT/project`. Reserved `factory.yaml` cannot
also be a selected reference. `.factory-kit/` holds the adoption guide, schema,
license and digest receipt; `START-HERE.md` explains review. No default skills,
issue forms, phases, templates or other project files are added. The ordinary
kit without `--definition` retains its existing layout and behavior.

## Failure behavior and first runnable slice

Validate all selected inputs before destination creation. Reject parser errors
before `toJS`: unknown/duplicate fields or versions, tags, aliases, multiple
documents, excessive nesting/bytes/files, malformed UTF-8 and invalid/missing
references produce no output directory. Re-read and compare definition and
reference snapshots immediately before staging; changes, additions or deletions
fail. Write the already checked snapshot bytes, so a later source change cannot
produce mixed output. Existing destinations are refused unchanged. Clean up only
the new destination on a write failure. No environment interpolation, remote
include, shell evaluation or setup command is supported.

The first vertical slice is shared offline validation through the CLI, then
snapshot staging through the existing exporter. Behavioral regressions cover
parser/path/resource failures, adversarial mutation before staging, coherent
copied references, unchanged default kit and packaged schema/examples. No schema
engine or additional dependency is needed; YAML 2.9.1 is already bundled.

Local trial on the delivered #128 base, Node 26.7.0/YAML 2.9.1: `parseDocument`
reported `DUPLICATE_KEY` for repeated `name` yet `toJS()` returned the replacement;
an unclosed flow sequence reported `BAD_INDENT` yet returned a sequence. The
selected rule is to reject **all parser errors before conversion**. This trial
settles recovery handling, not execution qualification.

## Adopt deliberately

Start with the packaged examples in `adlc/examples/definitions/` or write a
definition for your own approved brief and instructions. Use the explicit
project root for every validation. Markdown links and skill supporting resources
are the project's review responsibility; only explicitly selected references and
skill subtrees are copied, never transitively linked files. Hidden supporting
entries, private `.git`/`.codex`/`.factory`/`.factory-kit` paths and `native.json`/
`auth.json` references are refused. This is an allowlisted selection, not a secret
scanner: review all selected bytes before sharing or adoption.
All selected Markdown must be nonempty valid UTF-8; other supporting files may
contain binary assets and retain their exact bytes.

Limits are 64 KiB YAML, depth 16, 16 distinct skills, 1 MiB per selected file,
8 MiB aggregate including YAML, 256 selected files and 512 directory entries.
Supporting directories have maximum depth 16. The packaged
`factory/definition.schema.json` describes the shape and limits; JSON Schema
alone cannot validate YAML syntax or local filesystem references.

On success, compare `definitionDigest` (exact YAML bytes) and `snapshotDigest`
(YAML plus sorted path/byte/hash references) with the kit receipt. A changed file
requires validation and a fresh kit; it never updates an installation. Retain the
reviewed receipt outside active native state. The receipt's `sourceRevision` and
`sourceDirty` describe the exporting Factory source when available, not the
adopting repository. Selected bytes are identified by the definition/snapshot
digests. Adopt only chosen material on a
project branch, preserving existing instructions/brief/standards/checks. The kit
does not install the selection into Codex. Existing `factory setup` still uses its
qualified six-skill catalog and does not accept a definition option.

## Deferred qualification

Slice 2's setup mapping, discovery/hash validation of custom catalogs and actual
native isolation proof remain owned by #134. Existing no-manifest setup, service,
permissions and recovery keep their current qualified ownership. A changed
definition never restarts or changes a worker. Content/design names are examples,
not a kind registry or output qualification. Real content requires source/factual
checks; real design requires approved briefs and rendered artifact review.
Publishing, account/tool/network access, other harnesses and scheduling stay
separate. Full-access delivery runs repository checks and installed CLI/package
qualification and obtains independent review of the actual candidate.
