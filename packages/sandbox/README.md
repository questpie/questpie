# @questpie/sandbox

Hardened sandboxed code execution for QUESTPIE executor workloads. The package ships the HTTP adapter used by a QUESTPIE app and the Deno supervisor source that executes untrusted code in a separate process with capability-scoped network, import, file, and app bindings.

## Features

- **HTTP executor adapter** - connect `ctx.executor.run()` to a standalone sandbox service.
- **Deno supervisor** - run guest code outside the main Bun/Node app process.
- **Capability-scoped bindings** - expose only declared collections, stores, files, and fetch access.
- **SSRF protection** - validate literal IPs, DNS rebinding, redirects, and private/metadata ranges.
- **Network isolation support** - Linux network namespace/firewall planning for defense in depth.
- **Structured failures** - timeouts, non-JSON responses, and network failures return predictable results.

## Installation

```bash
bun add @questpie/sandbox
```

## Configure The Adapter

```ts
// config/app.ts
import { httpSandboxAdapter } from "@questpie/sandbox/adapter";
import { appConfig } from "questpie";

export default appConfig({
	executor: {
		sandboxed: httpSandboxAdapter({
			url: process.env.SANDBOX_URL,
		}),
	},
});
```

Guest bindings require a host-side broker route in the app or control-plane layer. Compute-only sandboxed execution only needs the adapter above.

## Run The Supervisor

The Deno supervisor source is published with the package:

```bash
deno run --allow-net --allow-env --allow-run --allow-read --allow-write=$TMPDIR \
	node_modules/@questpie/sandbox/src/sandbox-server.ts
```

Set `SANDBOX_URL` in the app to the supervisor URL.

## Exports

| Entry Point                 | Purpose                                    |
| --------------------------- | ------------------------------------------ |
| `@questpie/sandbox`         | Adapter, validation, and binding utilities |
| `@questpie/sandbox/adapter` | `httpSandboxAdapter()` only                |

## License

MIT
