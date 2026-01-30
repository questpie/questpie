# questpie

## 1.0.5

### Patch Changes

- [`a043841`](https://github.com/questpie/questpie-cms/commit/a0438419b01421ef16ca4b7621cb3ec7562cbec9) Thanks [@drepkovsky](https://github.com/drepkovsky)! - refactor: use cms.api.collections for CRUD operations

## 1.0.4

### Patch Changes

- [`01562df`](https://github.com/questpie/questpie-cms/commit/01562dfb6771a47eddcb797f36f951ae434f29c8) Thanks [@drepkovsky](https://github.com/drepkovsky)! - feat: add Prettify to admin builder types and improve DX
  - Add `Prettify` wrapper to merged types in AdminBuilder for better IDE tooltips
  - Add default `ConsoleAdapter` for email in development mode (no config needed)
  - Fix package.json dependencies: move runtime deps (pino, drizzle-orm, zod) to dependencies, keep optional adapters (pg, ioredis, nodemailer, pg-boss) as optional peer deps

## 1.0.3

## 1.0.2

### Patch Changes

- [`eb98bb9`](https://github.com/questpie/questpie-cms/commit/eb98bb9d86c3971e439d9d3081ed0efb3bcb1f77) Thanks [@drepkovsky](https://github.com/drepkovsky)! - Fix npm publish by converting workspace:\* to actual versions
  - Remove internal @questpie/typescript-config package (inline tsconfig)
  - Add publish script that converts workspace:\* references before changeset publish
  - Fixes installation errors when installing packages from npm

## 1.0.1

### Patch Changes

- [`87c7afb`](https://github.com/questpie/questpie-cms/commit/87c7afbfad14e3f20ab078a803f11abf173aae99) Thanks [@drepkovsky](https://github.com/drepkovsky)! - Remove internal @questpie/typescript-config package and inline tsconfig settings

  This removes the workspace:\* dependency that was causing issues when installing published packages from npm.

## 1.0.0

### Minor Changes

- [`934c362`](https://github.com/questpie/questpie-cms/commit/934c362c22a5f29df20fa12432659b3b10400389) Thanks [@drepkovsky](https://github.com/drepkovsky)! - Initial public release of QUESTPIE CMS framework.

## 0.0.2

### Patch Changes

- chore: include files in package.json

## 0.0.1

### Patch Changes

- feat: initial release
