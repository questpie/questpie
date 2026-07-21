# @questpie/ai

AI run orchestration for QUESTPIE apps. The package provides the reusable AI module, worker/run collections, runtime runner contracts, resumable streams, and a Harness-backed worker path that product apps can use without owning the low-level execution lifecycle.

## Features

- **Reusable AI module** - register `aiModule` in any QUESTPIE app through `modules.ts`.
- **Run and worker lifecycle** - spawn, claim, heartbeat, complete, fail, timeout, and event reporting primitives.
- **Runtime facade** - `AgentRuntimeRunner` decouples stored runs from a concrete agent backend.
- **Harness integration** - optional Harness/AI SDK runner utilities for local hosted agent execution.
- **Resumable streams** - KV-backed UI message stream storage for reconnectable clients.
- **Headless first** - admin UI can sit on top, but the package is usable from server code and workers.

## Installation

```bash
bun add @questpie/ai
```

## Register The Module

```ts
// modules.ts
import { aiModule } from "@questpie/ai/modules/ai";

export default [aiModule] as const;
```

Run codegen after registering the module:

```bash
bun questpie generate
```

## Worker Runtime

The public runtime contract is exported from the root package:

```ts
import type { AgentRuntimeRunner } from "@questpie/ai";

export const runner: AgentRuntimeRunner = {
	runtime: "harness",
	async run(request) {
		// Start your agent backend and return a run handle.
	},
};
```

Use `@questpie/ai/worker` and `@questpie/ai/harness-core` for the bundled worker helpers and Harness-oriented adapters.

## AI SDK Package Train

The package and Autopilot app use one exact stable AI SDK/Harness train. Keep
these versions together when upgrading or rolling back; partial changes can
install incompatible peer copies.

This train was selected by the `2026-07-15T20:17Z` publish-age check and is
qualified for the repository's unchanged 72-hour `minimumReleaseAge` policy.
The root workspace also overrides `ws` to exactly `8.21.0`; the direct package
pin alone does not constrain Bun's isolated transitive resolution for both
Harness adapters.

| Package                       | Stable upgrade | Prior train reference |
| ----------------------------- | -------------- | --------------------- |
| `ai`                          | `7.0.22`       | `7.0.0-canary.173`    |
| `@ai-sdk/react`               | `4.0.23`       | `4.0.0-canary.173`    |
| `@ai-sdk/harness`             | `1.0.27`       | `1.0.0-canary.9`      |
| `@ai-sdk/harness-claude-code` | `1.0.27`       | `1.0.0-canary.5`      |
| `@ai-sdk/harness-codex`       | `1.0.29`       | not installed         |
| `@ai-sdk/provider-utils`      | `5.0.7`        | `5.0.0-canary.48`     |
| `ws`                          | `8.21.0`       | `8.21.0`              |

The rollback `ws` value is the exact version from the previous lockfile; its
previous manifest range was `^8.20.1`. After changing the whole set in
`package.json`, `packages/ai/package.json`, and `apps/autopilot/package.json`,
regenerate `bun.lock` with `bun install`, then require
`bun install --frozen-lockfile` to pass before merging.

The prior-version column is a forensic reference, not a version-only rollback
procedure. The stable train also changes the package source contract from the
deprecated `onSandboxSession` setting to `sandboxConfig.onSession` and removes
the canary peer-type cast. Mixing the prior dependencies with the stable source
is unsupported.

Land this train as one dedicated commit. To roll it back, first identify and
inspect that commit, then revert the complete source-and-lockfile change:

```bash
git log -S '"@ai-sdk/harness-codex": "1.0.29"' -- packages/ai/package.json
git show --stat <rp1-commit>
git revert <rp1-commit>
bun install
bun install --frozen-lockfile
```

The revert must restore `packages/ai/src/server/modules/ai/lib/harness-core.ts`,
the root and both package manifests, `bun.lock`, this documentation, and the
stable adapter tests together. If RP1 is not a dedicated commit, create and
review an exact reverse patch containing those paths instead of changing only
the version table.

While running the stable train, the required Harness lifecycle hook is
`sandboxConfig.onSession`. Installing the Codex adapter in this train only
establishes package compatibility. It does not advertise Codex as a supported
product runtime; that requires the separate authenticated compatibility gate.

### Codex compatibility gate

`@ai-sdk/harness-codex@1.0.29` ships bridge assets that independently install
`@openai/codex-sdk@0.130.0` and select `gpt-5.3-codex` when the caller omits a
model. A root workspace override cannot change that sandbox-local install.

`createQuestpieCodex()` in `@questpie/ai/harness-core` is the reviewed narrow
compatibility seam. It preserves adapter `1.0.29`, requires a non-empty explicit
model, rejects `gpt-5.3-codex`, and replaces only the bridge manifest/lock with
the checked-in frozen Bun recipe for exact SDK and CLI `0.144.1`. The lock
contains the registry integrity for all supported platform binaries. It does
not enable Codex in the Autopilot product runtime.

The protected real-turn probe deliberately requires an operator-provided auth
file. It copies only that file into a temporary `0700` HOME / `CODEX_HOME`,
sets the copied credential to `0600`, blocks implicit API-key fallback from the
parent environment, and destroys the session and directory afterward:

```bash
AUTOPILOT_REAL_CODEX_SMOKE=1 \
AUTOPILOT_CODEX_MODEL="<supported-model>" \
AUTOPILOT_CODEX_AUTH_FILE="/path/to/staged/auth.json" \
bun run packages/ai/scripts/smoke-codex.ts
```

The auth file must be staged outside the repository. The probe exits non-zero
when the opt-in flag, auth, explicit model, CLI startup, real turn, or expected
output is missing. After trimming surrounding whitespace, the result must equal
`CODEX_COMPATIBILITY_OK` exactly; merely mentioning the sentinel fails. Setup
failures, timeouts, `SIGINT`, and `SIGTERM` all run the same idempotent bounded
session/provider teardown before removing the temporary auth directory and
exiting non-zero. It never prints credential values, auth paths, or model
output. This follows Codex guidance that `auth.json` under `CODEX_HOME` is a
password-like secret and automation should isolate credentials. See the official
[Codex authentication documentation](https://developers.openai.com/codex/auth/)
and [non-interactive mode guidance](https://developers.openai.com/codex/noninteractive/).

The credential-free compatibility test is also a required GitHub Actions matrix
on `ubuntu-latest` and `macos-latest`, using the repository's Bun `1.3.13` and
Node 24. Each runner performs the frozen bridge install, starts its native Codex
CLI, checks the exact version, and starts/destroys the full Harness bridge. The
matrix never receives protected Codex auth, including on fork pull requests.
Local macOS success does not prove Linux execution; Linux remains unverified
until the external matrix completes successfully.

Rollback is intentionally small: remove the `createQuestpieCodex` export,
wrapper, bridge manifest/lock assets, probe, and this section after an
age-qualified upstream adapter removes both the embedded SDK and implicit model
seams. Do not roll back only the lock or model guard.

## Development

Run the package typecheck and Bun test suite from the monorepo root:

```bash
bun run --cwd packages/ai check-types
bun run --cwd packages/ai test
```

## Exports

| Entry Point                      | Purpose                                           |
| -------------------------------- | ------------------------------------------------- |
| `@questpie/ai`                   | Config, plugin, and runtime/worker contract types |
| `@questpie/ai/modules/ai`        | `aiModule` for `modules.ts`                       |
| `@questpie/ai/worker`            | Embedded worker execution helpers                 |
| `@questpie/ai/harness-core`      | Harness runtime helpers                           |
| `@questpie/ai/client`            | Client helpers                                    |
| `@questpie/ai/client/modules/ai` | Client module exports                             |

## License

MIT
