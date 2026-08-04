---
"questpie": minor
"@questpie/admin": minor
---

Remove the deprecated `discoverPatterns` option from `ModuleTemplateOptions` in
`questpie/codegen`.

Registry augmentation moved to the root template some time ago and
`generateModuleTemplate` stopped reading the option then, so passing it has been
a no-op. It is gone from the type and from both call sites.

If you pass it to `generateModuleTemplate` in your own codegen plugin, delete the
line. Nothing else changes: the generated output is byte for byte the same,
because the option never reached it.

Note that `generateTemplate` has its own `discoverPatterns`, which is live and
untouched. Only the module-template one is removed.
