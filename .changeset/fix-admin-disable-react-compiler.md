---
"@questpie/admin": patch
---

Disable React Compiler when building the published `dist`. Pre-compiling the package memoized method calls on stable-but-internally-mutable references from `@tanstack/react-table` (e.g. `table.getSelectedRowModel()`) and `@tiptap/react` (e.g. `editor.isActive()`), returning stale values across renders.

User-visible symptoms in the published builds: row selection in collection table views did not show the floating bulk-action toolbar, rich-text toolbar buttons did not reflect the active formatting state, and various interactions on Base UI dropdowns/popovers behaved as if the underlying state was frozen on first render.

The compiler is now off for the package's `dist` output. Consumer apps that enable React Compiler in their own Vite config continue to optimize their application code as before; only the prebuilt admin package itself is no longer compiled.
