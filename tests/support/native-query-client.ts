import { cp, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import {
	renderClientContract,
	renderCodecType,
} from "../../packages/compiler/src/runtime/client";
import { projectRealtimeWireContract } from "../../packages/compiler/src/runtime/realtime-wire";
import { contextCodec, resources } from "./native-query-contract";

const repository = resolve(import.meta.dir, "../..");

/** Materialize actual compiler output; no projection instrumentation or authored DTOs. */
export async function renderNativeQueryClients(
	directory: string,
): Promise<void> {
	await symlink(
		join(repository, "node_modules"),
		join(directory, "node_modules"),
		"dir",
	);
	await writeFile(
		join(directory, "app.ts"),
		`export type AppContextInput = ${renderCodecType(contextCodec)};\n`,
	);
	const contract = {
		application: "application:native-query-tests",
		clientContractDigest: "1".repeat(64),
		httpContractDigest: "2".repeat(64),
		contextCodec,
	};
	await writeFile(
		join(directory, "ordinary-client.ts"),
		renderClientContract(resources, contract),
	);
	const realtime = projectRealtimeWireContract({
		application: contract.application,
		clientContractDigest: contract.clientContractDigest,
		operationHttpContractDigest: contract.httpContractDigest,
		resources,
		watchableQueries: ["query:tasks.detail"],
	});
	await writeFile(
		join(directory, "live-client.ts"),
		renderClientContract(resources, { ...contract, realtime }),
	);
	await writeFile(
		join(directory, "package.json"),
		JSON.stringify({
			private: true,
			type: "module",
			imports: {
				"#questpie/test-client": "./ordinary-client.ts",
				"#questpie/test-live-client": "./live-client.ts",
			},
		}),
	);
}

/** Run statically typed cases in disjoint output so concurrent suites share no generated paths. */
export async function runNativeQueryCases(
	names: readonly string[],
): Promise<Readonly<{ tests: number; assertions: number }>> {
	const directory = await mkdtemp(join(tmpdir(), "questpie-native-cases-"));
	try {
		await renderNativeQueryClients(directory);
		for (const name of names) {
			if (!/^[a-z][a-z-]+$/.test(name))
				throw new Error("Invalid native test case name");
			await cp(
				join(import.meta.dir, "native-query-cases", `${name}.case.ts`),
				join(directory, `${name}.test.ts`),
			);
		}
		await writeFile(
			join(directory, "tsconfig.json"),
			JSON.stringify({
				compilerOptions: {
					target: "ES2024",
					module: "ESNext",
					moduleResolution: "Bundler",
					strict: true,
					noEmit: true,
					skipLibCheck: true,
					exactOptionalPropertyTypes: true,
					noUncheckedIndexedAccess: true,
					lib: ["ES2024", "DOM", "DOM.Iterable"],
					types: ["bun"],
				},
				include: ["*.ts"],
			}),
		);
		const run = async (command: string[]) => {
			const child = Bun.spawn(command, {
				cwd: directory,
				stdout: "pipe",
				stderr: "pipe",
			});
			const [status, out, err] = await Promise.all([
				child.exited,
				new Response(child.stdout).text(),
				new Response(child.stderr).text(),
			]);
			const output = out + err;
			if (status !== 0)
				throw new Error(
					`Native generated consumer failed (${command[1]}):\n${output}`,
				);
			return output;
		};
		await run([
			"bun",
			join(repository, "node_modules/typescript/bin/tsc"),
			"-p",
			join(directory, "tsconfig.json"),
		]);
		const output = await run([
			"bun",
			"test",
			...names.map((name) => `${name}.test.ts`),
			"--timeout=15000",
		]);
		return {
			tests: Number(/(\d+) pass/.exec(output)?.[1] ?? 0),
			assertions: Number(/(\d+) expect\(\) calls/.exec(output)?.[1] ?? 0),
		};
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
}
