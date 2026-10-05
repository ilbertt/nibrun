# Hrana v2 wire schemas

[`src/hrana-v2.ts`](../../src/hrana-v2.ts) is a manually maintained
copy of the HTTP wire shapes from the MIT-licensed libSQL specifications at commit
`d6c75af6353bb1c34985399608e37cd272a35aa1`:

- [HRANA_1_SPEC.md](https://github.com/tursodatabase/libsql/blob/d6c75af6353bb1c34985399608e37cd272a35aa1/docs/HRANA_1_SPEC.md)
- [HRANA_2_SPEC.md](https://github.com/tursodatabase/libsql/blob/d6c75af6353bb1c34985399608e37cd272a35aa1/docs/HRANA_2_SPEC.md)
- [HTTP_V2_SPEC.md](https://github.com/tursodatabase/libsql/blob/d6c75af6353bb1c34985399608e37cd272a35aa1/docs/HTTP_V2_SPEC.md)

The declarations are represented as TypeBox schemas so TypeScript types and runtime
validation share one definition. They preserve upstream field names and tags.
Explicit `undefined` in nullable wire fields is represented as JSON `null`, while
optional fields remain optional. The numeric `int32` alias is bounded separately
by [`src/hrana.ts`](../../src/hrana.ts), along with resource limits
and support for an omitted initial baton.

Update this copy manually against the upstream files, recording the new commit
and retaining the [MIT license](LICENSE). The package tests and the API's official
libSQL client compatibility tests cover the copied wire shapes.
