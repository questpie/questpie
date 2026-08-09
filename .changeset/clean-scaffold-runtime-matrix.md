---
"create-questpie": patch
---

Harden and align every generated runtime before release.

- **Scaffolds:** Next, Hono, and Elysia now install and mount their canonical
  QUESTPIE adapters; TanStack Start keeps the supported low-level Fetch seam and
  forwards all seven HTTP methods. Browser scaffolds install the realtime peer,
  and headless production builds retain their external runtime dependencies.
- **Examples:** repository examples invoke the public `questpie` binary instead
  of package source paths while retaining their explicit config compatibility
  flags.
- **Docs and Skills:** runtime ownership, migration guidance, typed-client
  boundaries, and module/plugin graph rules now match executable behavior.
- **Release proof:** a publish-shaped four-runtime matrix scaffolds through the
  installed public CLI, generates, typechecks, builds, boots, probes ownership
  boundaries, and verifies bounded SIGTERM cleanup before publish.
