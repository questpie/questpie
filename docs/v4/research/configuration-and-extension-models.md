# Configuration and extension models in current TypeScript frameworks

Status: research note
Research date: 2026-08-09
Scope: observed behavior in current official documentation and first-party
interfaces. This document does not propose a QUESTPIE configuration or feature
syntax.

## Research questions

This note examines:

- what each framework puts in its root configuration;
- how installing framework functionality differs from defining application
  features;
- which values are evaluated at build or tool startup and which values remain
  available at application runtime;
- how environment values and secrets are handled;
- how plugins, integrations, modules, layers, and generators are registered;
- how reusable feature packages are represented;
- where generated types come from;
- which failure modes the official documentation calls out.

The sources are official framework documentation. Product conclusions are not
part of this note. The final section lists open design questions only.

## Summary of observed models

| System      | Root or tool configuration                                            | Extension installation                                                       | Application definitions                                                       | Runtime or secret configuration                                                            | Type generation                                                                                                           |
| ----------- | --------------------------------------------------------------------- | ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| Vite        | `vite.config.*` controls the build and dev server                     | Explicit `plugins` array                                                     | Normal source modules remain outside Vite config                              | Config executes before Vite loads `.env*`; app variables use `import.meta.env`             | Vite types its config; plugins can expose virtual modules but Vite does not define a general application-schema generator |
| Astro       | `astro.config.*` controls build and rendering                         | Explicit `integrations` array or `astro add` config edit                     | Routes, content, components, and middleware remain source files               | `astro:env` separates server/client and public/secret variables                            | Integrations can inject `.d.ts` files                                                                                     |
| Nuxt        | `nuxt.config.ts` controls framework/build behavior                    | Published modules in config; local modules and layers can be auto-discovered | Pages, server routes, plugins, components, and other features use directories | `runtimeConfig` separates private server values from public values; `app.config` is public | Nuxt generates `.nuxt`, aliases, runtime-config types, and inferred app-config types                                      |
| SvelteKit   | `svelte.config.js`, or SvelteKit options passed to the Vite plugin    | Adapter in SvelteKit config; Vite plugins in `vite.config.*`                 | Routes, hooks, params, and application code use source conventions            | `$env/*/private` and `$env/*/public` provide static and dynamic environment access         | `svelte-kit sync` and dev/build generate `.svelte-kit` contracts and aliases                                              |
| Prisma ORM  | `prisma.config.ts` controls CLI paths, migrations, and datasource URL | Generator blocks name built-in or package generators                         | Models and relations live in Prisma Schema files                              | CLI config can read environment values; runtime client receives a driver Adapter           | `prisma generate` emits a schema-specific client and model/input types                                                    |
| Better Auth | Exported `auth` instance is the server configuration                  | Server plugins in Auth options; client plugins in client creation            | Framework routes mount the generated Auth handler                             | Options commonly read process environment and construct database/provider implementations  | Server plugin types are projected to client plugins through `$InferServerPlugin`; CLI can generate database schema        |

## Vite

### Root configuration

Vite reads `vite.config.*` as executable JavaScript or TypeScript. A config may
export a plain object, a synchronous function, or an asynchronous function. A
function receives `command`, `mode`, `isSsrBuild`, and `isPreview`, so structural
build configuration can vary between development, production build, SSR, and
preview. `defineConfig()` and `satisfies UserConfig` provide editor typing; they
do not make the file a static data format. [Vite: Configuring Vite](https://vite.dev/config/)

The root config concerns the build system and development server: plugins,
resolution, environments, server options, build options, and related tool
behavior. Application routes and domain features are ordinary source modules,
not entries in the Vite config contract.

### Plugin installation and authoring

Users install a plugin package and explicitly call its factory in the root
`plugins` array. Vite ignores falsy entries and flattens plugin presets that
return multiple plugins. Plugin factories are the documented convention for
accepting options. [Vite: Plugin API, plugin configuration](https://vite.dev/guide/api-plugin.html#plugins-config)

A Vite plugin is identified by a required `name` and contributes lifecycle
hooks such as `config`, `configResolved`, `resolveId`, `load`, `transform`, and
server hooks. The `config` hook can return a partial config that Vite merges or
mutate the current config. Vite documents that user plugins have already been
resolved before `config` runs, so adding more plugins from that hook has no
effect. [Vite: Plugin API, config hook](https://vite.dev/guide/api-plugin.html#config)

Plugins can publish virtual modules. These expose build-time information through
normal ESM imports, with a public `virtual:` ID and an internal resolved ID.
[Vite: virtual modules convention](https://vite.dev/guide/api-plugin.html#virtual-modules-convention)

Vite's current Environment API allows a plugin to apply to selected build/dev
environments. The docs also warn that plugin state may need to be keyed by the
environment rather than shared globally. [Vite: Environment API for plugins](https://vite.dev/guide/api-environment-plugins)

### Environment values and failure modes

While `vite.config.*` is being evaluated, Vite has not yet loaded `.env*` files.
Only variables already present in `process.env` are available. Vite resolves
`root`, `envDir`, and `mode` before loading those files. Config code that needs
`.env*` values must call `loadEnv()` explicitly. Application code receives
filtered variables later through `import.meta.env`; the default public prefix is
`VITE_`. [Vite: using environment variables in config](https://vite.dev/config/#using-environment-variables-in-config),
[Vite: environment variables and modes](https://vite.dev/guide/env-and-mode)

Observed failure modes include:

- expecting `.env*` variables in `process.env` while the config is evaluating;
- injecting a plugin from the `config` hook after plugin resolution;
- using shared mutable plugin state across Vite environments;
- exposing sensitive values through the client-facing environment prefix;
- depending on development-only or build-only hooks in the opposite execution
  mode.

## Astro

### Root configuration and application definitions

Astro starter projects place `astro.config.mjs` at the project root, although
the file is only required when there is something to configure. The config
controls how Astro builds and renders the project. Astro explicitly says that
ordinary SEO metadata does not belong in this file; it belongs in page or
layout HTML. [Astro: configuration overview](https://docs.astro.build/en/guides/configuring-astro/)

Astro application features remain source definitions: file-based routes,
components, content collections, middleware, actions, and layouts. The root
config selects build and rendering behavior and installs integrations.

### Integration installation and authoring

Integrations are explicitly imported and called in the `integrations` array.
`astro add` automates dependency installation and edits `astro.config.*`; it
does not create a separate runtime registry. Integrations are normally factory
functions with options. Falsy integrations are ignored. [Astro: add integrations](https://docs.astro.build/en/guides/integrations-guide/)

An integration has a `name` and lifecycle hooks. The hooks can update Astro or
Vite config, register renderers, middleware, routes, watch files, toolbar apps,
and other build/runtime entrypoints. Integration presets may return arrays of
smaller integrations. Integrations execute in configured order, and the docs
recommend order-independent behavior where possible. [Astro: Integration API](https://docs.astro.build/en/reference/integrations-reference/)

The `astro:config:done` hook can call `injectTypes()` to write an integration's
`.d.ts` file under `.astro/integrations/<integration-name>/`. This gives an
integration an explicit generated-type mechanism. [Astro: `injectTypes()`](https://docs.astro.build/en/reference/integrations-reference/#injecttypes-option)

For package discovery by `astro add`, package authors add the
`astro-integration` keyword. The automated installer expects a default-exported
factory. [Astro: allow installation with `astro add`](https://docs.astro.build/en/reference/integrations-reference/#allow-installation-with-astro-add)

### Environment values and failure modes

Astro's `astro:env` schema declares whether a variable is available in the
server or client context and whether it is public or secret. Server secrets are
not included in the client bundle. Astro rejects a secret whose name matches
Vite's client-exposed `envPrefix`. [Astro: environment variables API](https://docs.astro.build/en/reference/modules/astro-env/),
[Astro: secret prefix conflict](https://docs.astro.build/en/reference/errors/env-prefix-conflicts-with-secret/)

Observed failure modes include:

- integration behavior that depends on array order;
- a package that cannot be installed by `astro add` because its export shape or
  metadata does not match the installer contract;
- missing peer dependencies after integration installation;
- invalid variables against the declared environment schema;
- exposing a declared secret through a Vite client prefix;
- relying on a config file that is not watched without registering it with
  `addWatchFile()`.

## Nuxt

### Root configuration, runtime configuration, and app configuration

`nuxt.config.ts` is Nuxt's main framework configuration. Nuxt restarts when the
main config, `.env`, `.nuxtignore`, or `.nuxtrc` changes. [Nuxt: `nuxt.config.ts`](https://nuxt.com/docs/4.x/directory-structure/nuxt-config)

Nuxt separates three kinds of configuration:

1. `nuxt.config.ts` configures the framework, build, installed modules, and
   defaults.
2. `runtimeConfig` declares runtime-overridable values. Private keys are
   server-only; `public` and reserved `app` keys reach the client.
3. `app/app.config.ts` contains public, reactive, build-known application
   configuration and cannot be overridden by environment variables.

[Nuxt: runtime config](https://nuxt.com/docs/4.x/guide/going-further/runtime-config),
[Nuxt: app config](https://nuxt.com/docs/4.x/directory-structure/app/app-config)

Nuxt serializes `runtimeConfig` before Nitro receives it. Functions, `Map`,
`Set`, and other non-serializable values must instead live in a Nuxt plugin,
Nitro plugin, or middleware. Runtime environment overrides must use the
documented `NUXT_` naming convention and must correspond to keys already
declared in `runtimeConfig`. The built server does not read the development
`.env` file. [Nuxt: runtime config serialization and environment variables](https://nuxt.com/docs/4.x/guide/going-further/runtime-config)

### Modules

Nuxt modules run sequentially when Nuxt starts in development or performs a
production build. Published and local modules use the same underlying model.
`defineNuxtModule()` supports metadata, a configuration key, defaults,
compatibility constraints, hooks, module dependencies, and async setup. Its
wrapper also ensures that a module is installed once using a key derived from
module metadata. [Nuxt: module anatomy](https://nuxt.com/docs/4.x/guide/modules/module-anatomy)

Published modules are listed in `nuxt.config.ts`. Local modules under the
`modules/` directory are auto-registered. Local module execution follows the
documented config-first and alphabetical ordering. A module can add build
templates, runtime plugins, components, composables, and server routes. The
module itself does not remain in the application runtime; it injects runtime
code when that is required. [Nuxt: local modules directory](https://nuxt.com/docs/4.x/directory-structure/modules),
[Nuxt: module recipes](https://nuxt.com/docs/4.x/guide/modules/recipes-basics)

### Layers and reusable application structure

Nuxt Layers reuse application-shaped source trees and configuration. Local
directories under `layers/` are auto-registered; external layers are listed in
the root `extends` array and can come from local paths, npm, or remote Git
sources. Layers can carry configuration, components, composables, pages,
layouts, middleware, plugins, server code, and shared code. [Nuxt: Layers](https://nuxt.com/docs/4.x/getting-started/layers)

Layers use explicit precedence. Project files have highest priority; local
auto-scanned layers and `extends` entries follow documented ordering rules.
Conflicting files can therefore be resolved by location and order rather than
by a collision error. [Nuxt: layer priority](https://nuxt.com/docs/4.x/getting-started/layers#layer-priority)

### Generated types and failure modes

Nuxt writes generated development artifacts to `.nuxt/`; the directory is
recreated and should not be edited. Nuxt adds aliases to generated TypeScript
configuration and infers runtime-config and app-config types. The inferred
`app.config` type is context-sensitive: some server/shared/config contexts see
keys as `unknown`, and module authors can use declaration augmentation for
input or output types. [Nuxt: `.nuxt`](https://nuxt.com/docs/4.x/directory-structure/nuxt),
[Nuxt: typing app config](https://nuxt.com/docs/4.x/directory-structure/app/app-config#typing-app-config)

Observed failure modes include:

- placing non-serializable implementations in `runtimeConfig`;
- assuming a differently named environment variable will override runtime
  config after deployment;
- exposing secrets under public runtime config or `app.config`;
- depending on module or layer execution/override order;
- importing code into `app.config` that is unavailable in the Nitro processing
  context;
- manually editing generated `.nuxt` files;
- using declaration augmentation that replaces, rather than extends as
  expected, inferred `AppConfig` members.

## SvelteKit

### Configuration split

SvelteKit traditionally uses root `svelte.config.js`; editor extensions and
other Svelte tooling also read this file. The config contains Svelte compiler
settings and a `kit` namespace that includes the deployment Adapter and other
framework options. [SvelteKit: Configuration](https://svelte.dev/docs/kit/configuration)

Current SvelteKit also permits the Svelte and SvelteKit configuration to be
passed directly to the `sveltekit()` Vite plugin in `vite.config.*`. When this
form is used, `svelte.config.js` is ignored. The docs state that non-SvelteKit
options pass through to `vite-plugin-svelte`. This creates one authoritative
location rather than merging both files. [SvelteKit: configuration through the Vite plugin](https://svelte.dev/docs/kit/configuration)

Vite-specific concerns still live in `vite.config.*`. Application routes,
hooks, parameter matchers, server-only modules, and other features use SvelteKit
source-file conventions. [SvelteKit: project structure](https://svelte.dev/docs/kit/project-structure)

### Environment values and generated contracts

SvelteKit classifies environment access along two dimensions:

- static versus dynamic;
- public versus private.

The `$env/static/*` modules enable build-time replacement and dead-code
elimination. `$env/dynamic/*` reads runtime values. Public variables use a
configured prefix; private variables are server-only. [SvelteKit: environment variables](https://svelte.dev/docs/kit/$env-static-private),
[SvelteKit: `$env/dynamic/private`](https://svelte.dev/docs/kit/$env-dynamic-private),
[SvelteKit: configuration environment prefixes](https://svelte.dev/docs/kit/configuration#env)

SvelteKit writes generated files under `.svelte-kit`. Development and
`svelte-kit sync` generate TypeScript configuration and route-related contracts.
Generated output is excluded from version control. [SvelteKit: project structure](https://svelte.dev/docs/kit/project-structure)

Observed failure modes include:

- defining both plugin-inline SvelteKit config and `svelte.config.js` while
  expecting the files to merge;
- expecting Vite's `envPrefix` and SvelteKit's environment prefixes to be the
  same setting;
- importing private environment modules into client-reachable code;
- using generated aliases before `svelte-kit sync` has produced the supporting
  TypeScript configuration;
- treating a deployment Adapter as an application feature rather than a build
  output concern.

## Prisma ORM

### Config, schema, generators, and runtime client

Current Prisma separates several concerns:

- root `prisma.config.ts` configures the CLI, schema path, migration paths,
  datasource URL, views, and TypedSQL paths;
- Prisma Schema files define datasource provider, data models, relations,
  enums, and generator blocks;
- `prisma generate` executes configured generators;
- application runtime code constructs `PrismaClient` with a database driver
  Adapter.

[Prisma: Config API](https://docs.prisma.io/docs/orm/reference/prisma-config-reference),
[Prisma: schema overview](https://docs.prisma.io/docs/orm/prisma-schema/overview),
[Prisma: Client introduction](https://docs.prisma.io/docs/orm/prisma-client/setup-and-configuration/introduction)

The root config is executable TypeScript. Prisma's documented example imports
`dotenv/config` and resolves `DATABASE_URL` with the config `env()` helper. The
schema and migrations remain independent source artifacts. [Prisma: Config API](https://docs.prisma.io/docs/orm/reference/prisma-config-reference)

A Prisma Schema may contain one or more generator blocks. A generator provider
can be built in or an npm/file implementation that follows Prisma's generator
contract. The current `prisma-client` generator requires an explicit output
path and emits plain TypeScript. Official docs mark generated `internal/*` files
as unstable and direct callers to stable generated entries. [Prisma: Generators](https://docs.prisma.io/docs/orm/prisma-schema/overview/generators)

Prisma Client is generated from the concrete application schema. Schema changes
require another `prisma generate` run. In Prisma 7, constructing the client
without a driver Adapter is an error. Creating many client instances creates
multiple pools and can exhaust database connections. [Prisma: generating Prisma Client](https://docs.prisma.io/docs/orm/prisma-client/setup-and-configuration/generating-prisma-client),
[Prisma: Client introduction](https://docs.prisma.io/docs/orm/prisma-client/setup-and-configuration/introduction)

Observed failure modes include:

- stale generated types after a schema change;
- importing unstable generated internals;
- missing the required generated output path;
- constructing a runtime client without its driver Adapter;
- creating many client instances and connection pools;
- assuming `.env` loading occurs automatically without the documented config
  import/setup;
- mixing CLI config, schema model, generator selection, and runtime connection
  construction as though they were one lifecycle.

## Better Auth

### Server configuration and CLI discovery

Better Auth conventionally places an exported Auth instance in `auth.ts`. The
installation guide lists supported search locations and requires the exported
name `auth` or a default export. The instance options may contain database
Adapters, provider credentials, callbacks, hooks, and plugins. The framework
route mounts `auth.handler` separately in the host framework. [Better Auth: installation](https://better-auth.com/docs/installation)

Better Auth's CLI accepts an explicit config path and otherwise loads the Auth
configuration to inspect schema and options. Its documentation notes that some
imports cannot execute outside their normal bundler, including component files
and `import.meta.glob`; these must stay out of the config import graph. The CLI's
diagnostic output redacts sensitive values. [Better Auth: CLI](https://better-auth.com/docs/concepts/cli)

Better Auth can read `BETTER_AUTH_SECRET` or `AUTH_SECRET`, supports explicit
and versioned secrets, and throws in production when a usable secret is absent.
Its base URL can be explicit, environment-derived, or request-derived, although
the docs recommend an explicit value for security and stability. [Better Auth: options](https://better-auth.com/docs/reference/options)

### Plugin model and generated contracts

Server plugins are listed in the server Auth options. They may contribute
endpoints, database schema, middleware, hooks, rate limits, and other behavior.
Client plugins are listed separately when creating the Auth client. A client
plugin can use `$InferServerPlugin` to infer endpoint and schema types from its
server plugin. Server and client plugins conventionally share an ID. [Better Auth: creating a plugin](https://better-auth.com/docs/guides/your-first-plugin),
[Better Auth: plugin concepts](https://better-auth.com/docs/concepts/plugins)

The server and client installation steps are separate. Official examples add a
server plugin to `betterAuth({ plugins: [...] })`, then add its corresponding
client plugin to `createAuthClient({ plugins: [...] })`. A schema-contributing
plugin also requires a schema generation/migration step. [Better Auth: basic plugin usage](https://better-auth.com/docs/basic-usage#using-plugins)

Better Auth's generated server `api` contains endpoints added by core and
installed plugins. The client converts endpoint paths into typed method trees.
[Better Auth: server API](https://better-auth.com/docs/concepts/api)

Observed failure modes include:

- configuring only the server or only the client half of a feature;
- forgetting the schema generation or migration required by a plugin;
- loading config through the CLI when its import graph contains bundler-only
  modules;
- leaking database or provider implementations into client imports;
- running without a production secret;
- allowing request-derived base URLs without the documented host validation;
- plugin ID or inferred server-plugin drift between the server and client
  definitions.

## Cross-system observations

The following are observations from the reviewed systems, not recommendations
for QUESTPIE.

### Root configuration is a tool or framework composition point

Vite, Astro, Nuxt, SvelteKit, and Prisma all reserve a root config for concerns
that affect compilation, framework boot, output, discovery, or external tool
execution. Ordinary domain features usually live in source files or framework
directories. Better Auth differs because its exported configured instance is
both runtime object and CLI input.

### Installation and application feature definition are normally distinct

Vite plugins, Astro integrations, Nuxt modules, SvelteKit Adapters, and Prisma
generators are explicitly installed build/tool extensions. Pages, routes,
models, handlers, and other application features are authored through different
interfaces. Nuxt Layers are the clearest reviewed example of packaging reusable
application-shaped source rather than only a build hook.

### Auto-discovery is usually narrow

Nuxt auto-discovers local modules and layers only in documented directories.
Better Auth CLI searches documented Auth config locations and export names.
Prisma searches documented config/schema locations. Vite and Astro require
explicit plugin/integration registration in root config.

### Build configuration is executable code

All reviewed TypeScript/JavaScript configs can execute code. Helper functions
provide typing but do not make evaluation pure or deterministic. Vite permits
async and conditional config. Astro permits conditional integrations. Nuxt
modules execute setup functions. Better Auth config constructs runtime objects.
Tooling therefore needs explicit rules for which imports and side effects are
safe during config evaluation.

### Secret safety is enforced at different seams

- Vite filters client environment variables by prefix but allows config code to
  load any environment value.
- Astro types variables by server/client and public/secret classification and
  diagnoses prefix conflicts.
- Nuxt serializes declared runtime config and exposes only `public` and `app`
  namespaces to the client.
- SvelteKit exposes separate static/dynamic and public/private modules.
- Prisma config can resolve a datasource URL for CLI work; runtime connection
  construction is separate.
- Better Auth reads secrets as ordinary server configuration and relies on
  config loading plus diagnostic redaction.

### Generated types follow structural inputs

Prisma generates a concrete client from the schema. Nuxt and SvelteKit generate
project contracts from config and file conventions. Astro integrations can
inject declaration files. Better Auth uses TypeScript inference between paired
server and client plugins. All have failure modes when structural input changes
without regenerating or when server and client extension lists drift.

### Ordering semantics create observable behavior

Vite and Astro process configured extension arrays in order. Nuxt modules run
sequentially, and Nuxt Layers define explicit precedence. These models make
order part of the extension Interface. Their official docs either document the
order or recommend that extensions avoid depending on it.

## Open questions for later QUESTPIE design work

These are questions raised by the evidence. They do not prescribe syntax or an
answer.

1. Which concerns require one root composition file, and which should be
   discovered from application definition directories?
2. Should optional first-party capabilities use the same installation path as
   third-party compiler extensions, or should those be separate concepts?
3. Which configuration values affect the compiled resource graph, and which
   values may vary when an already-built application starts?
4. How will the compiler prevent config-time imports or environment reads from
   leaking secrets or performing runtime side effects?
5. Must a capability that contributes server and browser behavior describe both
   projections under one identity?
6. Should reusable application feature packages resemble Nuxt Layers, ordinary
   source imports, or a stricter compiled-definition format?
7. Is extension order part of the public contract, or should collisions and
   ownership be resolved independently of discovery order?
8. Which generated files are stable public contracts, and which are explicitly
   internal like Prisma's generated `internal/*` directory?
9. How does the CLI load user configuration when the import graph contains host
   framework aliases, virtual modules, browser files, or runtime-only objects?
10. What diagnostic prevents a stale generated server/client contract after a
    structural config or definition change?
11. Should absence of a capability remove its generated context and client
    members entirely, or leave optional members?
12. Which application-level reuse cases require a feature-package mechanism
    rather than ordinary TypeScript imports and file discovery?
