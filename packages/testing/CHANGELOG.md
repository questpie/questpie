# @questpie/testing

## 3.22.0

### Minor Changes

- [`649ca34`](https://github.com/questpie/questpie/commit/649ca3465b394ce56b4bd45906ec27f4edeb82c4) Thanks [@drepkovsky](https://github.com/drepkovsky)! - Add a lease-protected disposable PostgreSQL primitive for production scenario tests.

- [`b5e8d4a`](https://github.com/questpie/questpie/commit/b5e8d4a23296e0895b20ed141dce97dcd1051cb2) Thanks [@drepkovsky](https://github.com/drepkovsky)! - Add a production server subprocess harness with readiness, restart, bounded logs, redaction, and verified shutdown semantics.

- [`83f89a4`](https://github.com/questpie/questpie/commit/83f89a49a765c36a0c3d38429205408bb68f625a) Thanks [@drepkovsky](https://github.com/drepkovsky)! - Add explicit typed anonymous, user, OAuth, and system test actors that run with production request-context semantics.

### Patch Changes

- [`b5b4a81`](https://github.com/questpie/questpie/commit/b5b4a81f2864d0e17f960b3e1e52c727d45b7124) Thanks [@drepkovsky](https://github.com/drepkovsky)! - Add the zero-config PGlite `createTestApp()` lifecycle with committed migrations, extension modules, bounded setup, and ordered idempotent disposal. Accept the real PGlite client type directly in QUESTPIE runtime configuration.

- [`a55f92a`](https://github.com/questpie/questpie/commit/a55f92ad92e5b911a6d5a4351c5d5da8ee72f0e8) Thanks [@drepkovsky](https://github.com/drepkovsky)! - Add the public `@questpie/testing` package with isolated in-process and production-scenario entrypoints.
