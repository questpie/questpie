---
"@questpie/workflows": patch
---

`workflow()` is now generic over the Zod schema and reads it through `z.output`, like `job()` in `questpie`. Inferring the input from `schema: z.ZodSchema<TInput>` compared every schema with `ZodType<TInput>` member by member. Inferred input types are unchanged, except that a branded schema now keeps its brand and an `any`-typed schema infers `any`. Explicit type arguments (`workflow<Name, Input>(…)`) change shape.
