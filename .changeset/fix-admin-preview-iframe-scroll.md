---
"@questpie/admin": patch
---

Fix live preview iframe scrolling up by ~one viewport when focusing a block. The iframe-side `FOCUS_FIELD` handler no longer calls `scrollIntoView`; the form-panel scroll in the editor still brings the corresponding field into view.
