---
"questpie": patch
---

A field now publishes the same validation on a global as it does on a
collection.

`createCollectionValidationSchemas` overlays each field's own `toZodSchema()`
on top of the column-derived base — that is where email format, select enums
and `.zod()` refinements come from. `createGlobalValidationSchema` had no
`fieldDefinitions` parameter at all, so a global's schema was column-derived
only. The same `f.email()` published as:

```jsonc
// on a collection
{ "type": "string", "maxLength": 255, "format": "email", "pattern": "…" }
// on a global
{ "type": "string", "maxLength": 255 }
```

The overlay is now shared, with the same carve-outs collections use: fields
with no column, `input: false` system fields, and relation/upload foreign keys
(whose ids are app-defined, so the field schema's uuid check would wrongly
reject them).

**This tightens two published contracts.** `@questpie/openapi` uses this schema
as a global's PATCH request body, so generated clients and docs now show the
real constraints. `@questpie/mcp`'s `createGlobalDataSchema` uses it as the data
schema for MCP tools, so an MCP client sending a malformed email to a global is
now rejected where it previously was not — the same rejection a collection has
always given. If you have an MCP integration writing globals, that is the one
place to look.

Admin-side validation is unaffected: it goes through `buildGlobalValidation` →
`buildFieldBasedSchema`, which already used field definitions.

Covered by `test/global/validation-parity.test.ts`, which mounts one field set
as both a collection and a global and asserts they agree — and asserts the
constraints are actually present, since parity with a schema that lost
everything would also be parity.
