import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";

const proofRoot = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(proofRoot, "types");
const names = [
	"application.ts",
	"core.ts",
	"editor.ts",
	"generated-app.ts",
	"generated-package.ts",
	"negative.ts",
	"package-application.ts",
];
const files = names.map((name) => path.join(root, name));
const options = {
	strict: true,
	noEmit: true,
	target: ts.ScriptTarget.ES2022,
	module: ts.ModuleKind.ESNext,
	moduleResolution: ts.ModuleResolutionKind.Bundler,
	lib: ["lib.es2022.d.ts", "lib.dom.d.ts"],
	skipLibCheck: true,
};

const sha256 = (value) => createHash("sha256").update(value).digest("hex");

const markerPosition = (source, marker) => {
	const index = source.indexOf(marker);
	assert.ok(index >= 0, `missing ${marker}`);
	return index + marker.length;
};

const percentile = (values, fraction) => {
	const ordered = [...values].sort((left, right) => left - right);
	return ordered[Math.ceil(ordered.length * fraction) - 1];
};

const stressSource = (size) => {
	const roots = Array.from({ length: size }, (_, index) => {
		const suffix = index.toString().padStart(3, "0");
		return `  readonly group${suffix}: Readonly<{ readonly domain: Readonly<{ readonly operation${suffix}: (input: Readonly<{ id: string }>) => Promise<Readonly<{ ok: true }>> }> }>;`;
	}).join("\n");
	return `export interface StressActions {\n${roots}\n}\ndeclare const actions: StressActions;\nactions./*STRESS_ROOT*/ group000.domain./*STRESS_HOVER*/ operation000;\n`;
};

const measureStress = (size) => {
	const file = path.join(root, `.stress-${size}.ts`);
	const source = stressSource(size);
	const host = {
		getScriptFileNames: () => [file],
		getScriptVersion: () => "1",
		getScriptSnapshot: (name) => {
			const value = name === file ? source : ts.sys.readFile(name);
			return value === undefined
				? undefined
				: ts.ScriptSnapshot.fromString(value);
		},
		getCurrentDirectory: () => root,
		getCompilationSettings: () => options,
		getDefaultLibFileName: (value) => ts.getDefaultLibFilePath(value),
		fileExists: (name) => name === file || ts.sys.fileExists(name),
		readFile: (name) => (name === file ? source : ts.sys.readFile(name)),
		readDirectory: ts.sys.readDirectory,
	};
	const service = ts.createLanguageService(host, ts.createDocumentRegistry());
	assert.deepEqual(service.getSemanticDiagnostics(file), []);
	const completionPosition = markerPosition(source, "/*STRESS_ROOT*/");
	const hoverPosition = markerPosition(source, "/*STRESS_HOVER*/") + 1;
	const completions = service.getCompletionsAtPosition(
		file,
		completionPosition,
		{},
	);
	assert.equal(completions?.entries.length, size);
	for (let index = 0; index < 10; index += 1) {
		service.getCompletionsAtPosition(file, completionPosition, {});
		service.getQuickInfoAtPosition(file, hoverPosition);
	}
	const completionTimings = [];
	const hoverTimings = [];
	for (let index = 0; index < 100; index += 1) {
		let start = performance.now();
		service.getCompletionsAtPosition(file, completionPosition, {});
		completionTimings.push(performance.now() - start);
		start = performance.now();
		service.getQuickInfoAtPosition(file, hoverPosition);
		hoverTimings.push(performance.now() - start);
	}
	const completionP95Milliseconds = percentile(completionTimings, 0.95);
	const hoverP95Milliseconds = percentile(hoverTimings, 0.95);
	assert.ok(completionP95Milliseconds <= 100);
	assert.ok(hoverP95Milliseconds <= 100);
	return {
		operations: size,
		depth: 3,
		completionP95Milliseconds,
		hoverP95Milliseconds,
		declarationBytes: Buffer.byteLength(source),
		declarationDigest: sha256(source),
	};
};

const createService = async (base = root) => {
	const baseFiles = names.map((name) => path.join(base, name));
	const contents = new Map(
		await Promise.all(
			baseFiles.map(async (file) => [file, await readFile(file, "utf8")]),
		),
	);
	const host = {
		getScriptFileNames: () => baseFiles,
		getScriptVersion: () => "1",
		getScriptSnapshot: (file) => {
			const source = contents.get(file) ?? ts.sys.readFile(file);
			return source === undefined
				? undefined
				: ts.ScriptSnapshot.fromString(source);
		},
		getCurrentDirectory: () => base,
		getCompilationSettings: () => options,
		getDefaultLibFileName: (value) => ts.getDefaultLibFilePath(value),
		fileExists: ts.sys.fileExists,
		readFile: ts.sys.readFile,
		readDirectory: ts.sys.readDirectory,
	};
	return {
		contents,
		files: baseFiles,
		service: ts.createLanguageService(host, ts.createDocumentRegistry()),
	};
};

export async function runTypeScriptProof() {
	const { contents, service } = await createService();
	const diagnostics = files.flatMap((file) =>
		service.getSemanticDiagnostics(file),
	);
	assert.deepEqual(
		diagnostics.map((item) =>
			ts.flattenDiagnosticMessageText(item.messageText, "\n"),
		),
		[],
	);

	const editorPath = path.join(root, "editor.ts");
	const editor = contents.get(editorPath);
	const probes = [
		{
			marker: "/*ACTION_ROOT*/",
			expected: ["a", "constructor", "delivery", "prototype", "then"],
		},
		{ marker: "/*ACTION_MEMBER*/", expected: ["sendMessage"] },
		{ marker: "/*MUTATION_ROOT*/", expected: ["messages"] },
		{ marker: "/*MUTATION_MEMBER*/", expected: ["recordDelivery"] },
	];
	const completions = {};
	for (const probe of probes) {
		const result = service.getCompletionsAtPosition(
			editorPath,
			markerPosition(editor, probe.marker),
			{},
		);
		const actual = (result?.entries ?? []).map((entry) => entry.name).sort();
		assert.deepEqual(actual, [...probe.expected].sort());
		completions[probe.marker] = actual;
	}

	const hoverPosition = markerPosition(editor, "/*HOVER*/") + 1;
	const hover = service.getQuickInfoAtPosition(editorPath, hoverPosition);
	const hoverText = ts.displayPartsToString(hover?.displayParts ?? []);
	assert.match(hoverText, /sendMessage/);
	assert.match(hoverText, /providerMessageId/);

	const completionPosition = markerPosition(editor, "/*ACTION_ROOT*/");
	for (let index = 0; index < 10; index += 1) {
		service.getCompletionsAtPosition(editorPath, completionPosition, {});
		service.getQuickInfoAtPosition(editorPath, hoverPosition);
	}
	const completionTimings = [];
	const hoverTimings = [];
	for (let index = 0; index < 100; index += 1) {
		let start = performance.now();
		service.getCompletionsAtPosition(editorPath, completionPosition, {});
		completionTimings.push(performance.now() - start);
		start = performance.now();
		service.getQuickInfoAtPosition(editorPath, hoverPosition);
		hoverTimings.push(performance.now() - start);
	}
	const completionP95Milliseconds = percentile(completionTimings, 0.95);
	const hoverP95Milliseconds = percentile(hoverTimings, 0.95);
	assert.ok(completionP95Milliseconds <= 100);
	assert.ok(hoverP95Milliseconds <= 100);

	const generatedNames = ["generated-app.ts", "generated-package.ts"];
	const generatedSources = await Promise.all(
		generatedNames.map(async (name) => readFile(path.join(root, name), "utf8")),
	);
	const declarationBytes = (
		await Promise.all(generatedNames.map((name) => stat(path.join(root, name))))
	).reduce((total, item) => total + item.size, 0);
	const declarations = generatedSources.join("\n");
	const projection = JSON.parse(
		await readFile(path.join(proofRoot, "PROJECTION.json"), "utf8"),
	);
	const appSource = ts.createSourceFile(
		"generated-app.ts",
		generatedSources[0],
		ts.ScriptTarget.Latest,
		true,
	);
	const projectedLeaves = (interfaceName) => {
		const declaration = appSource.statements.find(
			(statement) =>
				ts.isInterfaceDeclaration(statement) &&
				statement.name.text === interfaceName,
		);
		assert.ok(declaration && ts.isInterfaceDeclaration(declaration));
		const leaves = [];
		const visit = (members, prefix = []) => {
			for (const member of members) {
				assert.ok(ts.isPropertySignature(member));
				assert.ok(member.name && ts.isIdentifier(member.name));
				const name = member.name.text;
				const type = member.type;
				const nested =
					type &&
					ts.isTypeReferenceNode(type) &&
					ts.isIdentifier(type.typeName) &&
					type.typeName.text === "Readonly" &&
					type.typeArguments?.[0] &&
					ts.isTypeLiteralNode(type.typeArguments[0])
						? type.typeArguments[0]
						: undefined;
				if (nested) visit(nested.members, [...prefix, name]);
				else leaves.push([...prefix, name].join("."));
			}
		};
		visit(declaration.members);
		return leaves.sort();
	};
	assert.deepEqual(
		projectedLeaves("GeneratedActions"),
		projection.action.map((item) => item.name).sort(),
	);
	assert.deepEqual(
		projectedLeaves("GeneratedMutations"),
		projection.mutation.map((item) => item.name).sort(),
	);
	const stress = {
		small: measureStress(50),
		large: measureStress(500),
	};
	assert.ok(declarationBytes + stress.large.declarationBytes <= 262_144);
	assert.doesNotMatch(declarations, /declare\s+global/);
	assert.doesNotMatch(declarations, /"delivery\.sendMessage"/);
	assert.doesNotMatch(generatedSources[1], /delivery/);

	const conflictPath = path.join(root, "namespaced-conflict.ts");
	const conflictSource = await readFile(
		path.join(root, "namespaced-conflict.fixture.txt"),
		"utf8",
	);
	const conflictHost = ts.createCompilerHost(options);
	const readConflictSource = conflictHost.getSourceFile.bind(conflictHost);
	conflictHost.fileExists = (file) =>
		file === conflictPath || ts.sys.fileExists(file);
	conflictHost.readFile = (file) =>
		file === conflictPath ? conflictSource : ts.sys.readFile(file);
	conflictHost.getSourceFile = (file, languageVersion) =>
		file === conflictPath
			? ts.createSourceFile(file, conflictSource, languageVersion, true)
			: readConflictSource(file, languageVersion);
	const conflictProgram = ts.createProgram(
		[
			path.join(root, "core.ts"),
			path.join(root, "generated-app.ts"),
			conflictPath,
		],
		options,
		conflictHost,
	);
	const conflictDiagnostics = ts
		.getPreEmitDiagnostics(conflictProgram)
		.filter((item) => item.file?.fileName.endsWith("namespaced-conflict.ts"));
	assert.ok(conflictDiagnostics.some((item) => item.code === 2300));

	const applicationSource = await readFile(
		path.join(root, "application.ts"),
		"utf8",
	);
	assert.match(
		applicationSource,
		/import \{ codec, defineCollection, defineContext, defineSeed \}/,
	);
	assert.match(applicationSource, /import \{ defineReaction \}/);
	assert.doesNotMatch(applicationSource, /\bas\s+define/);

	const unifiedStructural = await readFile(
		path.join(root, "unified-structural.ts"),
		"utf8",
	);
	const unifiedGenerated = await readFile(
		path.join(root, "unified-generated.ts"),
		"utf8",
	);
	assert.match(unifiedStructural, /\.\/unified-generated/);
	assert.match(unifiedGenerated, /\.\/generated-app/);

	const relocated = path.join(proofRoot, ".relocated-types");
	await rm(relocated, { recursive: true, force: true });
	await mkdir(relocated, { recursive: true });
	await Promise.all(
		names.map(async (name) =>
			writeFile(relocated + `/${name}`, await readFile(path.join(root, name))),
		),
	);
	try {
		const relocatedService = await createService(relocated);
		const relocatedDiagnostics = relocatedService.files.flatMap((file) =>
			relocatedService.service.getSemanticDiagnostics(file),
		);
		assert.deepEqual(relocatedDiagnostics, []);
	} finally {
		await rm(relocated, { recursive: true, force: true });
	}

	return {
		typeScript: ts.version,
		completions,
		hover: hoverText,
		completionP95Milliseconds,
		hoverP95Milliseconds,
		declarationBytes,
		declarationDigest: sha256(declarations),
		stress,
		maximumMeasuredDeclarationBytes:
			declarationBytes + stress.large.declarationBytes,
		factorySelection: "defineKind",
		namespacedMixedImportRequiresAlias: true,
		namespacedMixedImportDiagnostic: 2300,
		unifiedNamespaceCreatesGeneratedStructuralDependency: true,
		packageIsolation: true,
		flatCallSurfaceAbsent: true,
		prototypeSensitiveSegmentsTyped: true,
		thenNamespaceTypedWithoutThenableLeaf: true,
		relocation: true,
		ambientRegistry: false,
	};
}

if (import.meta.main)
	console.log(JSON.stringify(await runTypeScriptProof(), null, 2));
