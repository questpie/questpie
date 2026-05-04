---
"@questpie/admin": patch
"create-questpie": patch
"questpie": patch
"@questpie/hono": patch
"@questpie/elysia": patch
---

Enhance the existing Preview flow with visual editing support, draft patch synchronization, inline scalar editing, block preview annotations, and block insertion affordances wired to the existing block editor.

Update the barbershop example, documentation, scaffolder templates, and bundled QUESTPIE skills to describe and preserve the single Preview system architecture.

Cache admin auth branding snapshots to avoid React update loops on login pages, translate select option labels consistently across admin tables and related UI, reduce hook recursion noise for legitimate nested read flows, resolve generated app output next to re-exported server configs for CLI commands, and add configurable request logging with request/trace id propagation and scoped application log correlation.

The observability work provides a foundation without introducing OpenTelemetry tracing or exporter dependencies yet.

Add a `questpie cloud deploy` command for submitting QUESTPIE project deploy requests to QUESTPIE Cloud.
