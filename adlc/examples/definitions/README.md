# Small desired definitions

These software/content/design names are ordinary project names, not runtime
kinds or qualification claims. Each references repository-owned Markdown and
three existing portable skills. From this repository/package root:

```sh
factory definition validate --file adlc/examples/definitions/software/factory.yaml --repo .
factory definition validate --file adlc/examples/definitions/content/factory.yaml --repo .
factory definition validate --file adlc/examples/definitions/design/factory.yaml --repo .
factory kit --definition adlc/examples/definitions/software/factory.yaml --repo . --output ./new-definition-kit
```

The same CLI works offline without login; validation does not inspect accounts,
native models, permissions, tools or readiness. Review the resulting kit, then
deliberately adopt selected files under your approved project brief. Keep native
setup separate. See [the contract and adoption guide](../../../docs/definition.md).
