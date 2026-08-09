---
"@questpie/elysia": patch
"@questpie/next": patch
---

Accept generated QUESTPIE app values across physical package boundaries in the
Next and Elysia adapter entrypoints. Their runtime input now follows the
existing low-level Fetch seam instead of requiring the nominal `Questpie` class
identity from the adapter package's own installation.
