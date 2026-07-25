import { afterAll, describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import {
	cpSync,
	mkdirSync,
	mkdtempSync,
	realpathSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = resolve(packageRoot, "../..");
const fixtureRoot = mkdtempSync(join(tmpdir(), "questpie-crdt-yjs-node-"));

afterAll(() => rmSync(fixtureRoot, { recursive: true, force: true }));

describe("published Node.js server runtime", () => {
	it("stages and disposes through Node worker_threads", () => {
		buildPackage(resolve(repositoryRoot, "packages/questpie"));
		buildPackage(packageRoot);
		installPublishedFixture();
		writeFileSync(join(fixtureRoot, "acceptance.mjs"), nodeAcceptanceProgram);

		const result = spawnSync("node", ["acceptance.mjs"], {
			cwd: fixtureRoot,
			encoding: "utf8",
			timeout: 20_000,
		});

		expect(result.error).toBeUndefined();
		expect(result.status, result.stderr).toBe(0);
		expect(result.stdout.trim()).toBe("safe!");
	}, 90_000);
});

function buildPackage(cwd: string): void {
	const result = spawnSync("bun", ["run", "build"], {
		cwd,
		encoding: "utf8",
		timeout: 60_000,
	});
	expect(result.error).toBeUndefined();
	expect(result.status, result.stderr).toBe(0);
}

function installPublishedFixture(): void {
	const nodeModules = join(fixtureRoot, "node_modules");
	const questpieRoot = join(nodeModules, "questpie");
	const yjsRoot = join(nodeModules, "@questpie/crdt-yjs");
	mkdirSync(questpieRoot, { recursive: true });
	mkdirSync(yjsRoot, { recursive: true });

	cpSync(
		resolve(repositoryRoot, "packages/questpie/dist"),
		join(questpieRoot, "dist"),
		{
			recursive: true,
		},
	);
	writeFileSync(
		join(questpieRoot, "package.json"),
		JSON.stringify({
			name: "questpie",
			type: "module",
			exports: { "./crdt": "./dist/crdt.mjs" },
		}),
	);

	cpSync(resolve(packageRoot, "dist"), join(yjsRoot, "dist"), {
		recursive: true,
	});
	writeFileSync(
		join(yjsRoot, "package.json"),
		JSON.stringify({
			name: "@questpie/crdt-yjs",
			type: "module",
			exports: { "./server": "./dist/server.mjs" },
		}),
	);

	symlinkSync(
		realpathSync(resolve(packageRoot, "node_modules/yjs")),
		join(nodeModules, "yjs"),
		"junction",
	);
}

const nodeAcceptanceProgram = String.raw`
	import { yjsServerEngine } from "@questpie/crdt-yjs/server";
	import * as Y from "yjs";

	const engine = yjsServerEngine({
		operationTimeoutMs: 5_000,
		maximumActiveWorkers: 1,
	});
	const initial = await engine.create({
		value: "safe",
		basis: { fieldEpoch: 0n, fieldCursor: 0n },
	});
	const document = new Y.Doc();
	Y.applyUpdate(document, initial.state);
	document.getText("text").insert(4, "!");
	const update = Y.encodeStateAsUpdate(
		document,
		Y.encodeStateVectorFromUpdate(initial.state),
	);
	const candidate = await engine.stage({ replica: initial, update });
	await engine.dispose();
	console.log(candidate.projection);
`;
