---
"questpie": patch
---

Fixes `observability` being silently dropped from the runtime config.

The key was declared on the config type and read by the service, but app
construction never copied it across, so `runtimeConfig({ observability: {
adapter } })` typechecked, was accepted, and left the service disabled. Every
span, metric and log the framework emits already worked; none of them reached a
collector, because the documented way to turn tracing on did nothing.
