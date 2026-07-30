---
"questpie": patch
"@questpie/admin": patch
---

`{{ param }}` with spaces now interpolates in server messages and validation
messages, matching what the admin already did.

Message interpolation existed as five private copies with two different regexes.
The three in `questpie` — the server translator, the shared validation messages,
and `createSimpleI18n` on the client — used `/\{\{(\w+)\}\}/g`; the two in
`@questpie/admin` used `/\{\{\s*(\w+)\s*\}\}/g`. So a custom message written as
`Hello {{ name }}` interpolated in the admin and rendered literally on the
server and in the client i18n adapter — with nothing surfacing the difference,
since all five were file-private.

There is now one implementation, exported as `interpolate` from
`questpie/shared`, and it is the whitespace-tolerant one. Every placeholder
shipped with the framework uses the no-space form, so bundled messages are
byte-for-byte unchanged; this only affects custom messages supplied through
`translations`, where the spaced form previously did nothing.

Behaviour on a missing param is unchanged: the placeholder is echoed back as
`{{key}}` rather than becoming "undefined".

`createSimpleI18n` is the one users feel most directly — `t("greeting", { name })`
against a catalog entry of `Hello {{ name }}` used to render the braces.

One deliberate exception, left alone: `interpolateMessage` in the admin's
`use-server-validation` hook substitutes an empty string for a missing param
instead of echoing the placeholder. That difference is visible to end users in
form errors, so unifying it is a product decision rather than a cleanup.
