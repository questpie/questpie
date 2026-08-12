import assert from "node:assert/strict";
import {
	mkdtemp,
	readdir,
	readFile,
	rm,
	stat,
	writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";

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

async function declarationProof() {
	const output = await mkdtemp(path.join(os.tmpdir(), "questpie-p2-dts-"));
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
			output,
			"--pretty",
			"false",
		]);
		const app = await readFile(
			path.join(output, "generated", "app.d.ts"),
			"utf8",
		);
		const client = await readFile(
			path.join(output, "generated", "client.d.ts"),
			"utf8",
		);
		const publicBytes = Buffer.byteLength(app) + Buffer.byteLength(client);
		assert.equal(
			/\b(?:any|unknown)\b|drizzle|kysely|QuestpieApp/i.test(app + client),
			false,
		);
		assert.match(app, /readonly moderationNote\?: string \| null;/);
		assert.match(
			client,
			/withContext\(input: AppContextInput\): ScopedClient;/,
		);
		assert.match(app, /readonly kind: "ordinary";/);
		assert.equal(/authority\??:.*system/i.test(app), false);
		assert.ok(publicBytes <= 256 * 1024);
		return {
			appBytes: Buffer.byteLength(app),
			clientBytes: Buffer.byteLength(client),
			publicBytes,
			exactOptionalOutput: true,
			exactContextInput: true,
			ordinaryDirectAuthorityOnly: true,
		};
	} finally {
		await rm(output, { recursive: true, force: true });
	}
}

function nestedExists(depth) {
	function at(level, outer) {
		const row = `row${level}`;
		const comparison = `${row}.id.equal(${outer}.nextId)`;
		if (level === depth) return comparison;
		return `query.and(${comparison}, policy.exists(collection${level + 1}, ({ row: row${level + 1} }) => ${at(level + 1, row)}))`;
	}
	return `policy.exists(collection1, ({ row: row1 }) => ${at(1, "row0")})`;
}

function scaleSource(depth, width) {
	const interfaces = Array.from({ length: depth + 1 }, (_, index) => {
		const wide = Array.from(
			{ length: width },
			(__, fieldIndex) => `readonly field${fieldIndex}: string;`,
		).join("\n");
		return `interface Row${index} { readonly id: string; readonly nextId: string; ${wide} }`;
	}).join("\n");
	const collections = Array.from(
		{ length: depth + 1 },
		(_, index) =>
			`const collection${index} = collection<"scale${index}", Row${index}, { readonly id: string }>("scale${index}");`,
	).join("\n");
	return `
import { collection, definePolicy, policy, query } from "questpie";
${interfaces}
${collections}
export const scalePolicy = definePolicy(collection0, {
  name: "scale.default",
  read: {
    admit: policy.authenticated(),
    rows: ({ row: row0 }) => ${nestedExists(depth)},
  },
});
`;
}

async function scaleMeasurement(depth, width) {
	const temporary = await mkdtemp(
		path.join(os.tmpdir(), `questpie-p2-scale-${depth}-${width}-`),
	);
	try {
		await writeFile(
			path.join(temporary, "fixture.ts"),
			scaleSource(depth, width),
		);
		await writeFile(
			path.join(temporary, "tsconfig.json"),
			JSON.stringify(
				{
					compilerOptions: {
						strict: true,
						noEmit: true,
						target: "ES2022",
						module: "ESNext",
						moduleResolution: "Bundler",
						skipLibCheck: true,
						baseUrl: ".",
						paths: { questpie: [path.join(typesRoot, "framework.ts")] },
					},
					include: ["fixture.ts"],
				},
				null,
				2,
			),
		);
		const diagnostics = run("bun", [
			tscPath,
			"-p",
			path.join(temporary, "tsconfig.json"),
			"--extendedDiagnostics",
			"--pretty",
			"false",
		]);
		return {
			depth,
			fieldsPerCollection: width + 2,
			types: metric(diagnostics, "Types").value,
			instantiations: metric(diagnostics, "Instantiations").value,
			memoryKiB: metric(diagnostics, "Memory used").value,
			totalSeconds: metric(diagnostics, "Total time").value,
		};
	} finally {
		await rm(temporary, { recursive: true, force: true });
	}
}

export async function runMeasurements() {
	const check = () =>
		run("bun", [
			tscPath,
			"-p",
			path.join(typesRoot, "tsconfig.json"),
			"--noEmit",
			"--extendedDiagnostics",
			"--pretty",
			"false",
		]);
	const coldOutput = check();
	const warmOutput = check();
	const typecheck = {
		types: metric(warmOutput, "Types").value,
		instantiations: metric(warmOutput, "Instantiations").value,
		memoryKiB: metric(warmOutput, "Memory used").value,
		coldTotalSeconds: metric(coldOutput, "Total time").value,
		warmTotalSeconds: metric(warmOutput, "Total time").value,
	};
	assert.ok(typecheck.instantiations <= 125_000);
	assert.ok(typecheck.memoryKiB <= 96 * 1024);
	assert.ok(typecheck.coldTotalSeconds <= 1.5);
	assert.ok(typecheck.warmTotalSeconds <= 1.5);

	const depth1 = await scaleMeasurement(1, 8);
	const depth2 = await scaleMeasurement(2, 8);
	const depth4 = await scaleMeasurement(4, 8);
	const wide4 = await scaleMeasurement(4, 48);
	const scaling = {
		depth1,
		depth2,
		depth4,
		wide4,
		depthInstantiationRatio: depth4.instantiations / depth1.instantiations,
		wideInstantiationRatio: wide4.instantiations / depth4.instantiations,
	};
	assert.ok(scaling.depthInstantiationRatio <= 4);
	assert.ok(scaling.wideInstantiationRatio <= 4);

	const sourceFiles = (await readdir(typesRoot, { recursive: true })).filter(
		(file) => file.endsWith(".ts"),
	);
	let sourceBytes = 0;
	for (const file of sourceFiles) {
		sourceBytes += (await stat(path.join(typesRoot, file))).size;
	}

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
		declarations: await declarationProof(),
		languageService: await runTypeScriptHarness(),
		scaling,
		source: { files: sourceFiles.length, bytes: sourceBytes },
	};
}

if (import.meta.main) {
	console.log(JSON.stringify(await runMeasurements(), null, 2));
	console.log("P2 Context and Policy TypeScript budgets: pass");
}
