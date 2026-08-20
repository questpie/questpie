# BETA-12 package and declaration report

## Result

The release contains one public package, `questpie@4.0.0-beta.1`. Compiler and
Runtime remain private modules and are vendored under `dist/internal`; they are
not importable package subpaths. The tarball exposes `dist/index.js`,
`dist/index.d.ts`, and the `questpie` binary at `dist/cli.js`.

`quality/release/package-artifacts.json` pins the tarball SHA-256 and public
declaration SHA-256. `bun run release -- --dry-run` packs twice, requires equal
bytes, checks both committed digests, performs a clean tarball install, imports
the public root, rejects `questpie/runtime` and `@questpie/runtime`, and builds
the archive fixture through the installed binary. A changed artifact or
declaration fails before publication.

The package build removes every compiler, Runtime, and public-package `dist`
directory before compiling and vendoring private bytes. Turbo hashes that build
producer plus the compiler and Runtime sources, so a cache restore cannot put a
removed private module back into the tarball. A stale-file probe was deleted by
the build, and a clean Linux checkout reproduced the committed tarball digest.

The connected PostgreSQL release test passes the same tarball to both existing
fixture harnesses. In packed mode their active `.questpie/generated` output is
written by `dist/cli.js`; the collaboration and archive Runtime tests then run
against that output. The installed CLI applies migrations idempotently, starts
the Runtime over HTTP, and drains cleanly on termination. Reapplying an already
applied migration is a successful retry rather than an error.

The connected tracer harness links the repository's TypeScript and Bun type
directories into its temporary fixture to avoid a network install during the
PostgreSQL lane. That proves packed CLI execution, not clean dependency
installation. The separate release dry-run performs the clean `bun install`
from the tarball before invoking the installed CLI. `typescript` and
`@types/bun` are production dependencies because application compilation is a
runtime CLI capability and consumer projects may name Bun types in their
TypeScript configuration.

## Boundary

Only `questpie` is public. Vendoring private implementation bytes does not add
an export, provider SPI, second Runtime, or alternate semantic kernel. A clean
consumer never imports a repository source path.
