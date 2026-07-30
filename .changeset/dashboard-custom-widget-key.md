---
"@questpie/admin": patch
---

Fixes custom dashboard widgets rendering "component not found".

`ServerCustomWidget` is `{ type: "custom", widgetType, props }`, and its own
declaration documents `widgetType` as "resolved by client registry". The
renderer never resolved it. `config.type === "custom"` short-circuited to an
inline-component branch that read `config.component` and `config.config` —
neither of which exists on that interface — so the loader was always
`undefined` and the widget rendered an error card. The registry lookup that
would have found the component sat in the branch below, unreachable for every
custom widget, and looked up `config.type` (`"custom"`) rather than the
widgetType anyway.

Any module contributing a custom widget was affected. `@questpie/workflows`
declares `type: "custom", widgetType: "workflow-stats"` exactly as the contract
prescribes, and its client component has been registered and shipped in the
browser bundle the whole time with nothing able to reach it.

The registry key is now resolved through an exported `resolveWidgetKey`: for a
custom widget it is `widgetType`, otherwise the type. The legacy inline form —
a config carrying its own `component`, built outside the declared interface —
still works when no `widgetType` is present. A missing custom widget now names
the widgetType in the fallback instead of the word "custom".

Covered by `test/client/dashboard-widget-key.test.ts`. The resolver is exported
and pure on purpose: this bug lived entirely in the render path, where the
server-side tests that check the config DTO could never see it.
