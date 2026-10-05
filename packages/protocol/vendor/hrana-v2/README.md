# Hrana v2 wire declarations

Declarations extracted from the MIT-licensed libSQL specifications at
[`d6c75af6353bb1c34985399608e37cd272a35aa1`](https://github.com/tursodatabase/libsql/tree/d6c75af6353bb1c34985399608e37cd272a35aa1/docs):
`HRANA_1_SPEC.md`, its overrides in `HRANA_2_SPEC.md`, and `HTTP_V2_SPEC.md`.
The declarations retain the upstream field names. The HTTP envelopes are named
`PipelineReqBody` and `PipelineRespBody`; the numeric `int32` alias becomes `number`.

Run `bun codegen:hrana` in `packages/protocol` to generate the TypeBox schemas.
`bun codegen:hrana:check` verifies the committed output offline. Generation maps
explicit `undefined` to JSON `null` while retaining optional properties, matching
the server's nullable SQL references. Runtime constraints are applied separately.

To refresh the source, run `bun codegen:hrana --refresh` after updating the pinned
revision in the generator. It extracts only the HTTP wire declarations and their
transitive dependencies. The upstream license is preserved in [LICENSE](LICENSE).
