import assert from "node:assert/strict";
import {
	mkdtemp,
	mkdir,
	readdir,
	readFile,
	rm,
	stat,
	writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { gzipSync } from "node:zlib";

import { runP1Goldens } from "./p1-goldens.mjs";
import { runTypeScriptHarness } from "./typescript-harness.mjs";

const proofRoot = path.dirname(new URL(import.meta.url).pathname);
const repositoryRoot = path.resolve(proofRoot, "../../../..");
const typesRoot = path.join(proofRoot, "types");
const tscPath = path.join(
	repositoryRoot,
	"node_modules",
	"typescript",
	"bin",
	"tsc",
);

function run(command, args, cwd = repositoryRoot) {
	const result = Bun.spawnSync([command, ...args], {
		cwd,
		stdout: "pipe",
		stderr: "pipe",
		env: process.env,
	});
	const stdout = result.stdout.toString();
	const stderr = result.stderr.toString();
	assert.equal(result.exitCode, 0, `${stdout}\n${stderr}`);
	return stdout;
}

function metric(output, label) {
	const match = output.match(
		new RegExp(`^${label}:\\s+([0-9.]+)([A-Za-z]*)$`, "m"),
	);
	assert.ok(match, `Missing ${label} in TypeScript diagnostics`);
	return { value: Number(match[1]), unit: match[2] };
}

async function fileBytes(file) {
	return (await stat(file)).size;
}

async function declarationProof() {
	const outputDirectory = await mkdtemp(
		path.join(os.tmpdir(), "questpie-p1-dts-"),
	);
	try {
		run("bun", [
			tscPath,
			"-p",
			path.join(typesRoot, "tsconfig.json"),
			"--noEmit",
			"false",
			"--declaration",
			"--emitDeclarationOnly",
			"--outDir",
			outputDirectory,
			"--pretty",
			"false",
		]);
		const appPath = path.join(outputDirectory, "generated", "app.d.ts");
		const clientPath = path.join(outputDirectory, "generated", "client.d.ts");
		const app = await readFile(appPath, "utf8");
		const client = await readFile(clientPath, "utf8");
		const publicBytes = Buffer.byteLength(app) + Buffer.byteLength(client);
		const forbidden = /\b(?:any|unknown)\b|typeof import|QuestpieApp/;
		assert.equal(forbidden.test(app + client), false);
		assert.ok(publicBytes <= 256 * 1024);
		return {
			appBytes: Buffer.byteLength(app),
			clientBytes: Buffer.byteLength(client),
			publicBytes,
		};
	} finally {
		await rm(outputDirectory, { recursive: true, force: true });
	}
}

function scaleAppContractSource(resourceCount) {
	const queries = Array.from(
		{ length: resourceCount },
		(_, index) =>
			`\t\t"scale.query${index}": Operation<{ id: string }, { id: string; body: string } | null>;`,
	).join("\n");
	return `
import {
	__definitionFactories,
	type ApplicationContract,
	type Operation,
	type QueryFactory,
	type ReadCollection,
	type WriteCollection,
} from "./framework";
export interface Message { id: string; body: string; }
export interface ScaleContract extends ApplicationContract {
	readData: { messages: ReadCollection<Message, { id: string }> };
	writeData: { messages: WriteCollection<Message, { id: string }> };
	queries: {
${queries}
	};
	mutations: Record<never, never>;
	actions: Record<never, never>;
	dispatch: Record<never, never>;
	jobs: Record<never, never>;
}
export const defineQuery: QueryFactory<ScaleContract> = __definitionFactories.defineQuery;
`;
}

function scaleApplicationSource(resourceCount) {
	return `
import { defineQuery } from "#questpie/app";
import { operation } from "questpie";
${Array.from(
	{ length: resourceCount },
	(_, index) => `
export const query${index} = defineQuery({
	name: "scale.query${index}",
	input: operation.object({ id: operation.uuid() }),
	handler: ({ input, ctx }) => ctx.data.messages.get({
		key: { id: input.id },
		select: { id: true, body: true },
	}),
});`,
).join("\n")}
`;
}

async function scalingMeasurement(multiplier) {
	const temporary = await mkdtemp(
		path.join(os.tmpdir(), `questpie-p1-scale-${multiplier}-`),
	);
	try {
		const resourceCount = 8 * multiplier;
		await writeFile(
			path.join(temporary, "framework.ts"),
			await readFile(path.join(typesRoot, "framework.ts"), "utf8"),
		);
		await writeFile(
			path.join(temporary, "generated-app.ts"),
			scaleAppContractSource(resourceCount),
		);
		await writeFile(
			path.join(temporary, "application.ts"),
			scaleApplicationSource(resourceCount),
		);
		await writeFile(
			path.join(temporary, "client.ts"),
			`import type { ScaleContract } from "#questpie/app";\nexport type Client = ScaleContract["queries"];\n`,
		);
		await writeFile(
			path.join(temporary, "tsconfig.json"),
			JSON.stringify(
				{
					compilerOptions: {
						strict: true,
						target: "ES2022",
						module: "ESNext",
						moduleResolution: "Bundler",
						skipLibCheck: true,
						baseUrl: ".",
						paths: {
							questpie: ["framework.ts"],
							"#questpie/app": ["generated-app.ts"],
						},
					},
					include: ["*.ts"],
				},
				null,
				2,
			),
		);
		const diagnostics = run("bun", [
			tscPath,
			"-p",
			path.join(temporary, "tsconfig.json"),
			"--noEmit",
			"--extendedDiagnostics",
			"--pretty",
			"false",
		]);
		const declarationDirectory = path.join(temporary, "declarations");
		run("bun", [
			tscPath,
			"-p",
			path.join(temporary, "tsconfig.json"),
			"--declaration",
			"--emitDeclarationOnly",
			"--outDir",
			declarationDirectory,
			"--pretty",
			"false",
		]);
		const declarationFiles = (await readdir(declarationDirectory)).filter(
			(file) => file.endsWith(".d.ts"),
		);
		let declarationBytes = 0;
		for (const file of declarationFiles) {
			declarationBytes += await fileBytes(
				path.join(declarationDirectory, file),
			);
		}
		return {
			resourceCount,
			types: metric(diagnostics, "Types").value,
			instantiations: metric(diagnostics, "Instantiations").value,
			declarationBytes,
		};
	} finally {
		await rm(temporary, { recursive: true, force: true });
	}
}

async function bundleMeasurement() {
	const temporary = await mkdtemp(
		path.join(os.tmpdir(), "questpie-p1-bundle-"),
	);
	try {
		const kinds = ["query", "mutation", "action", "route", "reaction", "job"];
		const sources = {
			baseline: "export const compilerBindingVersion = 1;\n",
		};
		for (const kind of kinds) {
			sources[kind] =
				`${sources.baseline}export async function ${kind}Handler(input) { return { kind: \"${kind}\", input }; }\n`;
		}
		const measurements = {};
		for (const [name, source] of Object.entries(sources)) {
			const entry = path.join(temporary, `${name}.ts`);
			await writeFile(entry, source);
			const build = await Bun.build({
				entrypoints: [entry],
				target: "bun",
				format: "esm",
				minify: true,
				write: false,
			});
			assert.equal(build.success, true);
			const output = await build.outputs[0].arrayBuffer();
			const buffer = Buffer.from(output);
			measurements[name] = {
				rawBytes: buffer.byteLength,
				gzipBytes: gzipSync(buffer, { level: 9, mtime: 0 }).byteLength,
			};
		}
		const baseline = measurements.baseline;
		return {
			baseline,
			bundles: Object.fromEntries(
				kinds.map((kind) => [kind, measurements[kind]]),
			),
			deltas: Object.fromEntries(
				kinds.map((kind) => [
					kind,
					{
						rawBytes: measurements[kind].rawBytes - baseline.rawBytes,
						gzipBytes: measurements[kind].gzipBytes - baseline.gzipBytes,
					},
				]),
			),
		};
	} finally {
		await rm(temporary, { recursive: true, force: true });
	}
}

export async function runMeasurements() {
	const typecheckOutput = run("bun", [
		tscPath,
		"-p",
		path.join(typesRoot, "tsconfig.json"),
		"--noEmit",
		"--extendedDiagnostics",
		"--pretty",
		"false",
	]);
	const typecheck = {
		types: metric(typecheckOutput, "Types").value,
		instantiations: metric(typecheckOutput, "Instantiations").value,
		memoryKiB: metric(typecheckOutput, "Memory used").value,
		totalSeconds: metric(typecheckOutput, "Total time").value,
	};
	assert.ok(typecheck.instantiations <= 125_000);
	assert.ok(typecheck.memoryKiB <= 96 * 1024);
	assert.ok(typecheck.totalSeconds <= 1.5);

	const declarations = await declarationProof();
	const scale1 = await scalingMeasurement(1);
	const scale4 = await scalingMeasurement(4);
	const scaling = {
		one: scale1,
		four: scale4,
		instantiationRatio: scale4.instantiations / scale1.instantiations,
		declarationRatio: scale4.declarationBytes / scale1.declarationBytes,
	};
	assert.ok(scaling.instantiationRatio <= 5);
	assert.ok(scaling.declarationRatio <= 5);

	const goldens = runP1Goldens();
	const bindingBytes = Buffer.byteLength(
		JSON.stringify(goldens.baseline.runtime.slots),
	);
	const bindingSizes = goldens.baseline.runtime.slots.map((slot) =>
		Buffer.byteLength(JSON.stringify(slot)),
	);
	const bindingMetadata = {
		resourceCount: goldens.baseline.runtime.slots.length,
		totalBytes: bindingBytes,
		bytesPerResource: bindingBytes / goldens.baseline.runtime.slots.length,
		maximumResourceBytes: Math.max(...bindingSizes),
	};
	assert.ok(bindingMetadata.maximumResourceBytes <= 4 * 1024);

	const typescriptHarness = await runTypeScriptHarness();
	const bundles = await bundleMeasurement();
	return {
		host: {
			platform: process.platform,
			architecture: process.arch,
			cpu: os.cpus()[0]?.model ?? "unrecorded",
			logicalCpus: os.cpus().length,
			bun: process.versions.bun,
			typescript: "5.9.2",
		},
		typecheck,
		declarations,
		languageService: typescriptHarness.languageService,
		scaling,
		bindingMetadata,
		bundles,
		firstSync: typescriptHarness.firstSync,
		staleOutput: typescriptHarness.staleOutput,
	};
}

if (import.meta.main) {
	console.log(JSON.stringify(await runMeasurements(), null, 2));
	console.log("P1 executable Definition budgets: pass");
}
