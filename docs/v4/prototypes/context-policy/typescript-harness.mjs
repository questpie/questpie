import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";

import ts from "typescript";

const proofRoot = path.dirname(new URL(import.meta.url).pathname);
const typesRoot = path.join(proofRoot, "types");
const files = [
	"framework.ts",
	"collections.ts",
	"application.ts",
	"generated-consumer.ts",
	"editor.ts",
	"generated/app.ts",
	"generated/client.ts",
].map((file) => path.join(typesRoot, file));

const compilerOptions = {
	strict: true,
	noEmit: true,
	target: ts.ScriptTarget.ES2022,
	module: ts.ModuleKind.ESNext,
	moduleResolution: ts.ModuleResolutionKind.Bundler,
	skipLibCheck: true,
	baseUrl: typesRoot,
	paths: {
		questpie: ["framework.ts"],
		"#questpie/app": ["generated/app.ts"],
		"#questpie/client": ["generated/client.ts"],
	},
};

function percentile(values, fraction) {
	const ordered = [...values].sort((left, right) => left - right);
	return ordered[Math.ceil(ordered.length * fraction) - 1];
}

function markerPosition(source, marker) {
	const index = source.indexOf(marker);
	assert.ok(index >= 0, `Missing marker ${marker}`);
	return index + marker.length;
}

function hoverPosition(source, marker, token) {
	const markerIndex = source.indexOf(marker);
	assert.ok(markerIndex >= 0, `Missing marker ${marker}`);
	const tokenIndex = source.lastIndexOf(token, markerIndex);
	assert.ok(tokenIndex >= 0, `Missing hover token ${token}`);
	return tokenIndex + Math.floor(token.length / 2);
}

export async function runTypeScriptHarness() {
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
	const editorPath = path.join(typesRoot, "editor.ts");
	const editor = contents.get(editorPath);
	const probes = [
		{
			name: "message",
			marker: "/*MESSAGE_COMPLETION*/",
			expected: [
				"authorId",
				"body",
				"channelId",
				"companyId",
				"createdAt",
				"id",
				"moderationNote",
			],
		},
		{
			name: "channel",
			marker: "/*CHANNEL_COMPLETION*/",
			expected: ["id", "name", "spaceId", "visibility"],
		},
		{
			name: "principal",
			marker: "/*PRINCIPAL_COMPLETION*/",
			expected: ["id", "kind"],
		},
	];
	const completionResults = {};
	for (const probe of probes) {
		const result = service.getCompletionsAtPosition(
			editorPath,
			markerPosition(editor, probe.marker),
			{},
		);
		const names = (result?.entries ?? [])
			.map((entry) => entry.name)
			.filter((name) => probe.expected.includes(name))
			.sort();
		assert.deepEqual(names, [...probe.expected].sort());
		completionResults[probe.name] = names;
	}

	const hoverProbes = [
		{
			name: "messageChannelId",
			marker: "/*MESSAGE_HOVER*/",
			token: "channelId",
			expected: "Operand<string>",
		},
		{
			name: "channelSpaceId",
			marker: "/*CHANNEL_HOVER*/",
			token: "spaceId",
			expected: "Operand<string>",
		},
		{
			name: "tenantId",
			marker: "/*TENANT_HOVER*/",
			token: "id",
			expected: "Operand<string>",
		},
	];
	const hoverResults = {};
	for (const probe of hoverProbes) {
		const info = service.getQuickInfoAtPosition(
			editorPath,
			hoverPosition(editor, probe.marker, probe.token),
		);
		const display = ts.displayPartsToString(info?.displayParts);
		assert.ok(display.includes(probe.expected), `${probe.name}: ${display}`);
		hoverResults[probe.name] = display;
	}

	const completionPosition = markerPosition(editor, "/*MESSAGE_COMPLETION*/");
	const hoverAt = hoverPosition(editor, "/*MESSAGE_HOVER*/", "channelId");
	for (let index = 0; index < 10; index += 1) {
		service.getCompletionsAtPosition(editorPath, completionPosition, {});
		service.getQuickInfoAtPosition(editorPath, hoverAt);
	}
	const completionTimes = [];
	const hoverTimes = [];
	for (let index = 0; index < 100; index += 1) {
		let started = performance.now();
		service.getCompletionsAtPosition(editorPath, completionPosition, {});
		completionTimes.push(performance.now() - started);
		started = performance.now();
		service.getQuickInfoAtPosition(editorPath, hoverAt);
		hoverTimes.push(performance.now() - started);
	}
	const semanticDiagnostics = files.flatMap((file) =>
		service.getSemanticDiagnostics(file),
	);
	assert.deepEqual(
		semanticDiagnostics.map((item) =>
			ts.flattenDiagnosticMessageText(item.messageText, "\n"),
		),
		[],
	);

	const languageService = {
		completionP95Milliseconds: percentile(completionTimes, 0.95),
		hoverP95Milliseconds: percentile(hoverTimes, 0.95),
		warmRequestsPerProbe: 100,
		completionResults,
		hoverResults,
	};
	assert.ok(languageService.completionP95Milliseconds <= 100);
	assert.ok(languageService.hoverP95Milliseconds <= 100);
	return languageService;
}

if (import.meta.main) {
	console.log(JSON.stringify(await runTypeScriptHarness(), null, 2));
	console.log("P2 Policy editor proof: pass");
}
