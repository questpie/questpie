import { expect, test } from "bun:test";
import {
	cp,
	mkdir,
	mkdtemp,
	readFile,
	readdir,
	rm,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

const repository = resolve(import.meta.dir, "../..");

import {
	nativeQueryDocsExample,
	prepareNativeQueryDocs,
	runNativeQueryDocs,
} from "../support/native-query-docs-consumer";

test("the exact Start tutorial builds with its packed generated Barbershop client", async () => {
	const guide = await readFile(
		join(repository, "apps/docs/content/docs/v4/react-query-start.mdx"),
		"utf8",
	);
	const temporary = await mkdtemp(join(tmpdir(), "questpie-start-docs-"));
	try {
		const consumer = await prepareNativeQueryDocs(temporary);
		const manifestPath = join(consumer, "package.json");
		const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
		const dependencies = {
			"@tanstack/react-start": "1.168.32",
			"@tanstack/react-router": "1.170.18",
			"@tanstack/react-router-ssr-query": "1.167.2",
			vite: "8.1.5",
			"@vitejs/plugin-react": "6.0.4",
		};
		for (const [name, version] of Object.entries(dependencies)) {
			expect(guide).toContain(`${name}@${version}`);
		}
		Object.assign(manifest.dependencies, dependencies);
		await writeFile(manifestPath, JSON.stringify(manifest));
		for (const path of [
			"vite.config.ts",
			"build-start.ts",
			"web-start/client.tsx",
			"web-start/data/questpie.ts",
			"web-start/router.tsx",
			"web-start/routes/__root.tsx",
			"web-start/routes/index.tsx",
			"web-start/routes/pages.tsx",
		]) {
			await mkdir(dirname(join(consumer, path)), { recursive: true });
			await writeFile(
				join(consumer, path),
				nativeQueryDocsExample(guide, path),
			);
		}
		for (const [source, target] of [
			["native-query-start-docs-peer.ts", "start-docs-peer.ts"],
			["native-query-start-docs-observer.ts", "start-docs-observer.ts"],
			["native-query-start-docs-run.ts", "start-docs-run.ts"],
			[
				"native-query-start-docs-cleanup.tsx",
				"web-start/routes/test-cleanup.tsx",
			],
		])
			await cp(
				join(repository, "tests/support", source!),
				join(consumer, target!),
			);
		await writeFile(
			join(consumer, "tsconfig.start.json"),
			JSON.stringify({
				extends: "./tsconfig.json",
				compilerOptions: { types: ["bun", "vite/client"] },
				include: [
					"web-start/**/*.ts",
					"web-start/**/*.tsx",
					"vite.config.ts",
					"build-start.ts",
					"start-docs-*.ts",
				],
			}),
		);
		await runNativeQueryDocs(
			["bun", "install", "--ignore-scripts"],
			consumer,
			temporary,
		);
		await runNativeQueryDocs(["bun", "build-start.ts"], consumer, temporary);
		await runNativeQueryDocs(
			["bun", "node_modules/typescript/bin/tsc", "-p", "tsconfig.start.json"],
			consumer,
			temporary,
		);
		const serverDirectory = join(consumer, "dist/server");
		const serverFiles = (
			await readdir(serverDirectory, { recursive: true })
		).filter((name) => /\.(?:js|mjs)$/.test(name));
		const server = (
			await Promise.all(
				serverFiles.map((name) =>
					readFile(join(serverDirectory, name), "utf8"),
				),
			)
		).join("\n");
		expect(server).toContain("QUESTPIE_API_ORIGIN");
		expect(server).toContain("Unexpected credential destination");
		const routes = await readFile(
			join(consumer, "web-start/routeTree.gen.ts"),
			"utf8",
		);
		expect(routes).toContain("/pages");
		const clientAssets = join(consumer, "dist/client");
		const scripts = (await readdir(clientAssets, { recursive: true })).filter(
			(name) => /\.(?:js|mjs|html)$/.test(name),
		);
		expect(scripts.length).toBeGreaterThan(0);
		for (const script of scripts) {
			expect(await readFile(join(clientAssets, script), "utf8")).not.toContain(
				"QUESTPIE_API_ORIGIN",
			);
		}
		const result = JSON.parse(
			await runNativeQueryDocs(
				["bun", "start-docs-run.ts"],
				consumer,
				temporary,
			),
		);
		expect(result.ssr).toBe(true);
		expect(result.browser).toBe(
			process.env.QUESTPIE_NATIVE_START_DOCS_BROWSER === "1",
		);
		if (result.browser) {
			const missing = Bun.spawn([process.execPath, "start-docs-run.ts"], {
				cwd: consumer,
				env: {
					...process.env,
					TMPDIR: temporary,
					FIREFOX_BIN: join(consumer, "missing-firefox"),
				},
				stdout: "pipe",
				stderr: "pipe",
				timeout: 60_000,
			});
			const [exit, output, error] = await Promise.all([
				missing.exited,
				new Response(missing.stdout).text(),
				new Response(missing.stderr).text(),
			]);
			expect(exit, output).not.toBe(0);
			expect(error).toContain("missing-firefox");
			expect(
				(await readdir(consumer)).filter((name) =>
					name.startsWith("start-docs-firefox-"),
				),
			).toEqual([]);
			// Fault injection touches only the copied test host, not public tutorial code.
			const worker = await readFile(
				join(consumer, "start-docs-run.ts"),
				"utf8",
			);
			const canceled = worker.replace(
				"\t\t\tawait stopBrowser();",
				'\t\t\tawait stopBrowser();\n\t\t\tif (path === "/test-cleanup") process.emit("SIGTERM", "SIGTERM");',
			);
			expect(canceled).not.toBe(worker);
			await writeFile(join(consumer, "start-docs-cancel.ts"), canceled);
			await expect(
				runNativeQueryDocs(
					["bun", "start-docs-cancel.ts"],
					consumer,
					temporary,
				),
			).rejects.toThrow(/abort/i);
		}
	} finally {
		await rm(temporary, { force: true, recursive: true });
	}
}, 120_000);
