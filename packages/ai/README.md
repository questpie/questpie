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

## Exports

| Entry Point                    | Purpose                                          |
| ------------------------------ | ------------------------------------------------ |
| `@questpie/ai`                 | Config, plugin, and runtime/worker contract types |
| `@questpie/ai/modules/ai`      | `aiModule` for `modules.ts`                      |
| `@questpie/ai/worker`          | Embedded worker execution helpers               |
| `@questpie/ai/harness-core`    | Harness runtime helpers                          |
| `@questpie/ai/client`          | Client helpers                                   |
| `@questpie/ai/client/modules/ai` | Client module exports                          |

## License

MIT
