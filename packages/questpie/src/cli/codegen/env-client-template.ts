/**
 * Client Env Module Generation
 *
 * For each consumer declared in `env.client.ts`, emits a
 * `.generated/env.client.<consumer>.ts` module that resolves the physical
 * (prefixed) vars with **literal** member expressions — the only form
 * bundlers (Metro, Vite, Next) statically inline. Server keys are physically
 * absent from these modules by construction.
 *
 * @example Generated output (expo consumer)
 * ```ts
 * import _envClient from "../env.client";
 * import { resolveClientEnv } from "questpie/env-client";
 *
 * export const env = resolveClientEnv(_envClient, {
 *   APP_URL: process.env.EXPO_PUBLIC_APP_URL,
 * }, "expo");
 * export type ClientEnv = typeof env;
 * ```
 */

import { readFile } from "node:fs/promises";

import {
	CLIENT_CONSUMER_PRESETS,
	resolveConsumer,
} from "#questpie/shared/env/client-env.js";
import type {
	ClientConsumer,
	ClientConsumerConfig,
} from "#questpie/shared/env/types.js";

import { importStatement, safeKey } from "./category-emit.js";
import type { DiscoveredFile } from "./types.js";

interface ClientEnvInfo {
	consumers: ClientConsumerConfig[];
	varNames: string[];
}

/**
 * Generate one client env module per declared consumer.
 * Returns `[]` (with a warning) when the definition cannot be read.
 *
 * `regenerateCommand` names the config that produced these files. They land
 * next to `index.ts`, which prints the same command, so the two have to agree.
 */
export async function generateClientEnvModules(
	file: DiscoveredFile,
	regenerateCommand = "questpie generate",
): Promise<Array<{ fileName: string; code: string }>> {
	const info = await loadClientEnvInfo(file);
	if (!info) return [];

	return info.consumers.map((consumer) => ({
		fileName: `env.client.${consumer.name}.ts`,
		code: renderClientEnvModule(
			file,
			consumer,
			info.varNames,
			regenerateCommand,
		),
	}));
}

/**
 * Read consumers + var names from `env.client.ts`.
 * Primary path: import the module (it is a zod-only leaf, cheap and
 * env-independent — same precedent as `extractModulePlugins` importing
 * `modules.ts`). Fallback: regex extraction over the source literal.
 */
async function loadClientEnvInfo(
	file: DiscoveredFile,
): Promise<ClientEnvInfo | null> {
	try {
		const mod = await import(/* @vite-ignore */ file.absolutePath);
		const def = mod.default;
		if (
			def &&
			Array.isArray(def.consumers) &&
			def.vars &&
			typeof def.vars === "object"
		) {
			return {
				consumers: (def.consumers as ClientConsumer[]).map(resolveConsumer),
				varNames: Object.keys(def.vars),
			};
		}
		console.warn(
			`⚠  ${file.source}: expected \`export default clientEnv({ consumers, vars })\` — skipping client env emission.`,
		);
		return null;
	} catch (error) {
		const fallback = await extractClientEnvInfoFromSource(file);
		if (fallback) {
			const reason = error instanceof Error ? error.message : String(error);
			console.warn(
				`⚠  ${file.source}: could not be imported (${reason}); using source-literal extraction for client env emission.`,
			);
			return fallback;
		}
		console.warn(
			`⚠  ${file.source}: could not read clientEnv definition — skipping client env emission.`,
		);
		return null;
	}
}

/**
 * Regex fallback: extract preset consumer names and `vars` keys from the
 * `clientEnv({ … })` source literal. Custom consumer objects are not
 * recoverable this way — only string presets are matched.
 */
async function extractClientEnvInfoFromSource(
	file: DiscoveredFile,
): Promise<ClientEnvInfo | null> {
	let source: string;
	try {
		source = String(await readFile(file.absolutePath, "utf-8"));
	} catch {
		return null;
	}

	const consumersMatch = source.match(/consumers\s*:\s*\[([^\]]*)\]/);
	if (!consumersMatch) return null;
	const consumers: ClientConsumerConfig[] = [];
	for (const literal of consumersMatch[1].matchAll(/["']([^"']+)["']/g)) {
		const name = literal[1];
		if (name in CLIENT_CONSUMER_PRESETS) {
			consumers.push(resolveConsumer(name as ClientConsumer));
		}
	}
	if (consumers.length === 0) return null;

	const varsStart = source.search(/vars\s*:\s*\{/);
	if (varsStart === -1) return null;
	const block = extractBalancedBlock(source, source.indexOf("{", varsStart));
	if (!block) return null;

	const varNames: string[] = [];
	for (const line of block.matchAll(
		/^\s*["']?([A-Z_][A-Z0-9_]*)["']?\s*:/gim,
	)) {
		varNames.push(line[1]);
	}
	if (varNames.length === 0) return null;

	return { consumers, varNames };
}

/** Return the contents of a balanced `{ … }` block starting at `openIndex`. */
function extractBalancedBlock(
	source: string,
	openIndex: number,
): string | null {
	if (source[openIndex] !== "{") return null;
	let depth = 0;
	for (let i = openIndex; i < source.length; i++) {
		if (source[i] === "{") depth++;
		else if (source[i] === "}") {
			depth--;
			if (depth === 0) return source.slice(openIndex + 1, i);
		}
	}
	return null;
}

/**
 * Render one generated client env module for a consumer.
 * Every var is a literal `<envObject>.<PREFIX><NAME>` member expression.
 */
function renderClientEnvModule(
	file: DiscoveredFile,
	consumer: ClientConsumerConfig,
	varNames: string[],
	regenerateCommand: string,
): string {
	const lines: string[] = [];
	lines.push("/* oxlint-disable */");
	lines.push("// AUTO-GENERATED by questpie codegen — DO NOT EDIT");
	lines.push(`// Regenerate with: ${regenerateCommand}`);
	lines.push("");
	lines.push(importStatement(file));
	lines.push('import { resolveClientEnv } from "questpie/env-client";');
	lines.push("");
	lines.push(
		`/** Typed client env for the ${consumer.name} consumer — server keys are physically absent. */`,
	);
	lines.push(`export const env = resolveClientEnv(${file.varName}, {`);
	for (const name of [...varNames].sort()) {
		lines.push(
			`\t${safeKey(name)}: ${consumer.envObject}.${consumer.prefix}${name},`,
		);
	}
	lines.push(`}, ${JSON.stringify(consumer.name)});`);
	lines.push("export type ClientEnv = typeof env;");
	lines.push("");
	return lines.join("\n");
}
