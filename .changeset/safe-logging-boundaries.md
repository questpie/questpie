---
"questpie": patch
"@questpie/observability": patch
---

Validate inbound correlation identifiers and apply one redaction policy to the final effective Pino and OTLP log record. Structured values now use a canonical inert schema: unsupported values, cycles, and non-finite numbers become explicit markers; Date, URL, Map, Set, and TypedArray values use tagged records; URL credentials and fragments are removed. OpenTelemetry log attributes support the recursive AnyValue contract independently from scalar span and metric attributes.
