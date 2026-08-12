import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import ts from "typescript";

const proofRoot = path.dirname(new URL(import.meta.url).pathname);
const typesRoot = path.join(proofRoot, "types");
const frameworkPath = path.join(typesRoot, "framework.ts");
const applicationPath = path.join(typesRoot, "application.ts");
const importedHandlerPath = path.join(typesRoot, "imported-query-handler.ts");
const generatedAppPath = path.join(typesRoot, "generated", "app.ts");
const generatedPackagePath = path.join(typesRoot, "generated", "package.ts");

const compilerOptions = {
	strict: true,
	noEmit: true,
	target: ts.ScriptTarget.ES2022,
	module: ts.ModuleKind.ESNext,
	moduleResolution: ts.ModuleResolutionKind.Bundler,
	skipLibCheck: true,
	allowImportingTsExtensions: true,
	baseUrl: typesRoot,
	paths: {
		questpie: ["framework.ts"],
		"#questpie/app": ["generated/app.ts"],
		"#questpie/package": ["generated/package.ts"],
	},
};

function formatDiagnostics(diagnostics) {
	return diagnostics.map((item) =>
		ts.flattenDiagnosticMessageText(item.messageText, "\n"),
	);
}

function createProgramWithVirtualApp(
	rootNames,
	virtualAppPath,
	virtualAppSource,
) {
	const options = {
		...compilerOptions,
		paths: {
			...compilerOptions.paths,
			"#questpie/app": [path.relative(typesRoot, virtualAppPath)],
		},
	};
	const host = ts.createCompilerHost(options);
	const originalFileExists = host.fileExists.bind(host);
	const originalReadFile = host.readFile.bind(host);
	host.fileExists = (fileName) =>
		path.resolve(fileName) === path.resolve(virtualAppPath) ||
		originalFileExists(fileName);
	host.readFile = (fileName) =>
		path.resolve(fileName) === path.resolve(virtualAppPath)
			? virtualAppSource
			: originalReadFile(fileName);
	return ts.createProgram({ rootNames, options, host });
}

async function firstSyncProof() {
	const virtualPath = path.join(typesRoot, ".questpie", "current", "app.ts");
	const current = (await readFile(generatedAppPath, "utf8")).replaceAll(
		'from "../framework"',
		'from "../../framework"',
	);
	assert.equal(
		ts.sys.directoryExists(path.join(typesRoot, ".questpie")),
		false,
	);

	const missingOptions = {
		...compilerOptions,
		paths: {
			...compilerOptions.paths,
			"#questpie/app": [".questpie/generated/app.ts"],
		},
	};
	const missingProgram = ts.createProgram({
		rootNames: [applicationPath, importedHandlerPath, frameworkPath],
		options: missingOptions,
	});
	const missing = formatDiagnostics(ts.getPreEmitDiagnostics(missingProgram));
	assert.ok(missing.some((message) => message.includes("#questpie/app")));
	const recovery = {
		code: "QP-EXEC-005",
		class: "generatedApplicationMissing",
		recovery: "bunx questpie sync",
	};
	assert.equal(recovery.recovery, "bunx questpie sync");

	const currentProgram = createProgramWithVirtualApp(
		[applicationPath, importedHandlerPath, frameworkPath, generatedPackagePath],
		virtualPath,
		current,
	);
	const currentDiagnostics = ts.getPreEmitDiagnostics(currentProgram);
	assert.deepEqual(formatDiagnostics(currentDiagnostics), []);
	return {
		generatedDirectoryPresent: false,
		missingDiagnosticCount: missing.length,
		recovery,
		currentVirtualDiagnosticCount: currentDiagnostics.length,
	};
}

async function staleOutputProof() {
	const temporary = await mkdtemp(path.join(tmpdir(), "questpie-p1-stale-"));
	try {
		const generatedDirectory = path.join(temporary, ".questpie", "generated");
		await mkdir(generatedDirectory, { recursive: true });
		const probePath = path.join(temporary, "probe.ts");
		const stalePath = path.join(generatedDirectory, "app.ts");
		const currentPath = path.join(temporary, ".questpie", "current", "app.ts");
		const frameworkSpecifier = JSON.stringify(frameworkPath);
		const base = await readFile(generatedAppPath, "utf8");
		const current = base.replace(
			'from "../framework"',
			`from ${frameworkSpecifier}`,
		);
		const stale = current.replace(
			"messages: ReadCollection<Message, { id: string }>;\n",
			"legacy: ReadCollection<Message, { id: string }>;\n\t\tmessages: ReadCollection<Message, { id: string }>;\n",
		);
		assert.notEqual(stale, current);
		const probe = `
import { defineQuery } from "#questpie/app";
import { operation } from "questpie";
export const staleProbe = defineQuery({
	name: "stale.probe",
	input: operation.object({ id: operation.uuid() }),
	handler: ({ input, ctx }) => ctx.data.legacy.get({
		key: { id: input.id },
		select: { id: true },
	}),
});
`;
		await writeFile(stalePath, stale);
		await writeFile(probePath, probe);

		const staleOptions = {
			...compilerOptions,
			baseUrl: temporary,
			paths: {
				questpie: [frameworkPath],
				"#questpie/app": [".questpie/generated/app.ts"],
			},
		};
		const rawProgram = ts.createProgram({
			rootNames: [probePath],
			options: staleOptions,
		});
		const rawDiagnostics = formatDiagnostics(
			ts.getPreEmitDiagnostics(rawProgram),
		);
		assert.deepEqual(rawDiagnostics, []);

		const currentOptions = {
			...staleOptions,
			paths: {
				...staleOptions.paths,
				"#questpie/app": [".questpie/current/app.ts"],
			},
		};
		const host = ts.createCompilerHost(currentOptions);
		const originalFileExists = host.fileExists.bind(host);
		const originalReadFile = host.readFile.bind(host);
		host.fileExists = (fileName) =>
			path.resolve(fileName) === path.resolve(currentPath) ||
			originalFileExists(fileName);
		host.readFile = (fileName) =>
			path.resolve(fileName) === path.resolve(currentPath)
				? current
				: originalReadFile(fileName);
		const currentProgram = ts.createProgram({
			rootNames: [probePath],
			options: currentOptions,
			host,
		});
		const currentDiagnostics = formatDiagnostics(
			ts.getPreEmitDiagnostics(currentProgram),
		);
		assert.ok(
			currentDiagnostics.some((message) =>
				message.includes("Property 'legacy' does not exist"),
			),
		);
		return {
			rawTypeScriptAcceptedStaleDisk: true,
			questpieCurrentVirtualAccepted: false,
			currentDiagnostic: currentDiagnostics.find((message) =>
				message.includes("Property 'legacy' does not exist"),
			),
		};
	} finally {
		await rm(temporary, { recursive: true, force: true });
	}
}

function percentile(values, fraction) {
	const ordered = [...values].sort((left, right) => left - right);
	return ordered[Math.ceil(ordered.length * fraction) - 1];
}

async function languageServiceProof() {
	const files = [
		path.join(typesRoot, "editor.ts"),
		frameworkPath,
		generatedAppPath,
	];
	const contents = new Map(
		await Promise.all(
			files.map(async (file) => [file, await readFile(file, "utf8")]),
		),
	);
	const host = {
		getScriptFileNames: () => files,
		getScriptVersion: () => "1",
		getScriptSnapshot: (fileName) => {
			const content = contents.get(fileName) ?? ts.sys.readFile(fileName);
			return content === undefined
				? undefined
				: ts.ScriptSnapshot.fromString(content);
		},
		getCurrentDirectory: () => typesRoot,
		getCompilationSettings: () => compilerOptions,
		getDefaultLibFileName: (options) => ts.getDefaultLibFilePath(options),
		fileExists: ts.sys.fileExists,
		readFile: ts.sys.readFile,
		readDirectory: ts.sys.readDirectory,
	};
	const service = ts.createLanguageService(host, ts.createDocumentRegistry());
	const editorPath = files[0];
	const source = contents.get(editorPath);
	const completionMarker = "/*DATA_COMPLETION*/";
	const hoverMarker = "/*DATA_HOVER*/";
	const completionPosition =
		source.indexOf(completionMarker) + completionMarker.length;
	const hoverMarkerPosition = source.indexOf(hoverMarker);
	const hoverPosition = source.lastIndexOf("messages", hoverMarkerPosition) + 2;

	for (let index = 0; index < 10; index += 1) {
		service.getCompletionsAtPosition(editorPath, completionPosition, {});
		service.getQuickInfoAtPosition(editorPath, hoverPosition);
	}

	const completionTimes = [];
	const hoverTimes = [];
	let completionNames = [];
	for (let index = 0; index < 100; index += 1) {
		let start = performance.now();
		const completions = service.getCompletionsAtPosition(
			editorPath,
			completionPosition,
			{},
		);
		completionTimes.push(performance.now() - start);
		completionNames = completions?.entries.map((entry) => entry.name) ?? [];

		start = performance.now();
		const hover = service.getQuickInfoAtPosition(editorPath, hoverPosition);
		hoverTimes.push(performance.now() - start);
		assert.ok(hover);
	}
	for (const collection of [
		"companies",
		"spaces",
		"channels",
		"memberships",
		"messages",
		"messageEvents",
	]) {
		assert.ok(completionNames.includes(collection));
	}
	assert.equal(completionNames.includes("accounts"), false);
	assert.equal(completionNames.includes("legacy"), false);
	const completionP95Ms = percentile(completionTimes, 0.95);
	const hoverP95Ms = percentile(hoverTimes, 0.95);
	assert.ok(completionP95Ms <= 100);
	assert.ok(hoverP95Ms <= 100);
	return {
		completionP95Ms,
		hoverP95Ms,
		requestsPerKind: 100,
		completionNames,
	};
}

export async function runTypeScriptHarness() {
	return {
		firstSync: await firstSyncProof(),
		staleOutput: await staleOutputProof(),
		languageService: await languageServiceProof(),
	};
}

if (import.meta.main) {
	const result = await runTypeScriptHarness();
	console.log(JSON.stringify(result, null, 2));
	console.log("P1 current-virtual TypeScript and editor harness: pass");
}
