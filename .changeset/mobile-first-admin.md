---
"@questpie/admin": minor
"create-questpie": patch
---

Mobile-first admin overhaul — the admin panel is now genuinely usable on phones (≤390px).

- **Touch foundation:** 44px touch targets and 16px inputs under `@media (pointer: coarse)` (no more iOS zoom-on-focus), `hover: none` fallbacks so hover-only controls stay reachable, `touch-action`/tap-highlight tuning, and `svh`/`dvh` instead of `vh`.
- **Navigation & forms:** a persistent mobile header with a reopenable navigation drawer, a sticky bottom save bar on record forms, and confirmation/workflow dialogs that become bottom drawers on mobile.
- **List view:** replaces the desktop horizontal-scroll table on mobile with compact, expandable record rows — tap a row to reveal the remaining fields inline — reusing the same cell renderers, selection, bulk actions, sorting, presence and reorder.
- **Fields:** native date pickers, correct `inputMode` keyboards, comfortable select/array/relation controls, and a working relation reorder.
- **Media, editors, filters, dashboard** reflow for narrow screens; live-preview re-render churn is fixed by isolating the preview iframe behind `React.memo`.
- `create-questpie` templates now emit `viewport-fit=cover` + a `theme-color` so the admin sits correctly under device notches with branded browser chrome.
