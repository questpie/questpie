---
"@questpie/workflows": patch
---

Use the existing match-hash index when dispatching workflow events from the client, HTTP routes and workflow steps. Preserve wildcard, partial and nested containment, legacy unhashed waiters and collision checks; paginate candidates so matching waiters beyond the first 1,000 are delivered. Bound subset enumeration for wide or deeply nested event criteria, falling back to the name/status lookup to preserve matching semantics.
