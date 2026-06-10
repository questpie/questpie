---
"questpie": minor
---

Server-side create/update now enforces field-level zod schemas. Collection insert/update validation overlays each field's `toZodSchema()` (including `.zod()` transforms, email format, select enums, array shapes) on top of the column-derived base schema — previously field schemas only drove admin form validation and OpenAPI docs, so invalid values (wrong enum, bad email) passed straight through CRUD into the database. System fields (`id`, timestamps) and relation/upload foreign keys keep their column-shape validation (FK id formats are app-defined), `input: false` fields keep system-write semantics, and `.validation({ exclude, refine })` works unchanged with `refine` applying on top of the field schema.
