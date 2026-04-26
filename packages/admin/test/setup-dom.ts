/**
 * DOM test setup
 *
 * Bun's test runner runs in pure-Node mode by default. Component
 * tests need a `window`, `document`, etc. — boot a happy-dom
 * window and copy its globals onto the runtime so React +
 * @testing-library can render into a virtual DOM.
 *
 * Loaded via `bun test --preload ./test/setup-dom.ts`.
 *
 * Pure-helper tests (no React, no DOM) keep working unchanged
 * because we only set globals that don't already exist.
 */

import { GlobalRegistrator } from "@happy-dom/global-registrator";

// `register()` mounts a happy-dom Window on the global scope and
// preserves any globals already set (so bun's own polyfills are
// untouched). Idempotent — safe to call from a preload script.
GlobalRegistrator.register({
	url: "http://localhost:3000",
});
