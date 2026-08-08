---
"@questpie/admin": minor
---

Make the audit collection private by default and omit credential-like fields from new audit diffs unless an application explicitly overrides their audit classification. Applications that expose audit history must now grant read access explicitly.
