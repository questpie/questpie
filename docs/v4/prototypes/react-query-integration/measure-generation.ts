import { join } from "node:path";

import { renderClientContract } from "../../../../packages/compiler/src/runtime/client";
import { instrumentClient } from "./render-projection";
import { contextCodec, resources } from "./task-contract.fixture";

// Construction measurement, not a stable-runner benchmark or a release budget.
const measurements: object[] = [];
const compilerVersion = new TextDecoder()
	.decode(
		Bun.spawnSync(["bun", "run", "tsc", "--version"], {
			cwd: import.meta.dir,
			stdout: "pipe",
			stderr: "pipe",
		}).stdout,
	)
	.trim();
const manifest = await Bun.file(join(import.meta.dir, "package.json")).json();
if (compilerVersion !== `Version ${manifest.devDependencies.typescript}`)
	throw new Error("PROOF_TYPESCRIPT_VERSION_MISMATCH");
for (const operations of [25, 200]) {
	const expanded = Array.from({ length: operations }, (_, index) => {
		const base = resources[index % resources.length]!;
		const name = `tasks.op${index}`;
		return { ...base, name, identity: `${base.kind}:${name}` };
	});
	const baseline = renderClientContract(expanded, {
		application: "application:react-query-proof",
		clientContractDigest: "1".repeat(64),
		httpContractDigest: "2".repeat(64),
		contextCodec,
	});
	for (const variant of ["baseline", "candidate"] as const) {
		const stem = `${variant}-${operations}`;
		const source =
			variant === "baseline" ? baseline : instrumentClient(baseline, expanded);
		await Bun.write(join(import.meta.dir, "generated", `${stem}.ts`), source);
		const calls = expanded
			.map((resource, index) => {
				const name = JSON.stringify(resource.name);
				const input =
					resource.kind === "query"
						? '{ id: "example", asOf: new Date() }'
						: '{ id: "example", expectedVersion: 1, targetStatus: "done" }';
				if (variant === "baseline")
					return `const r${index} = await scope.${resource.kind === "query" ? "queries" : "mutations"}[${name}](${input}); r${index}?.updatedAt.toISOString();`;
				if (resource.kind === "query")
					return `const o${index} = adapter.queries[${name}].options(${input}); const r${index} = cache.getQueryData(o${index}.queryKey); r${index}?.updatedAt.toISOString();`;
				return `const m${index} = new MutationObserver(cache, adapter.mutations[${name}].options()); const r${index} = await m${index}.mutate(${input}); r${index}.updatedAt.toISOString();`;
			})
			.join("\n");
		const imports =
			variant === "baseline"
				? `import type { GeneratedClientScope } from "./${stem}";\nexport async function consume(scope: GeneratedClientScope) {`
				: `import { getClientProjection, type GeneratedClientScope } from "./${stem}";\nimport { QueryClient, MutationObserver } from "@tanstack/query-core";\nimport { bindProjection } from "../query-adapter";\nexport async function consume(scope: GeneratedClientScope, cache: QueryClient) { const adapter = bindProjection(getClientProjection(scope), cache);`;
		await Bun.write(
			join(import.meta.dir, "generated", `${stem}.consumer.ts`),
			`${imports}\n${calls}\n}\n`,
		);
		const config = join(import.meta.dir, "generated", `${stem}.json`);
		await Bun.write(
			config,
			JSON.stringify({
				extends: "../tsconfig.json",
				include: [`${stem}.consumer.ts`],
			}),
		);
		const started = performance.now();
		const checked = Bun.spawnSync(
			["bun", "run", "tsc", "-p", config, "--extendedDiagnostics"],
			{ cwd: import.meta.dir, stdout: "pipe", stderr: "pipe" },
		);
		const stdout = new TextDecoder().decode(checked.stdout);
		if (checked.exitCode !== 0)
			throw new Error(
				`${stem} typecheck failed:\n${stdout}\n${new TextDecoder().decode(checked.stderr)}`,
			);
		const metric = (label: string) =>
			stdout
				.split("\n")
				.find((line) => line.startsWith(label + ":"))
				?.split(":")
				.slice(1)
				.join(":")
				.trim() ?? null;
		measurements.push({
			compilerVersion,
			operations,
			variant,
			generatedBytes: new TextEncoder().encode(source).length,
			wallMilliseconds: Math.round(performance.now() - started),
			types: metric("Types"),
			instantiations: metric("Instantiations"),
			memory: metric("Memory used"),
			checkTime: metric("Check time"),
		});
	}
}
await Bun.write(
	join(import.meta.dir, "generated", "scale-measurement.json"),
	JSON.stringify(measurements, null, 2) + "\n",
);
console.log(JSON.stringify(measurements, null, 2));
