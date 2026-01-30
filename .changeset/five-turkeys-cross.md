---
"@questpie/admin": patch
---

refactor: use optimized type utilities in admin builder types

Replace `Omit<T, "key"> & { key: NewType }` pattern with `SetProperty`, `TypeMerge`, and `UnsetProperty` utilities for faster TypeScript completion.
