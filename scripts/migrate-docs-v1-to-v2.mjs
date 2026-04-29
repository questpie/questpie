#!/usr/bin/env node
/**
 * Migrates V1 field syntax to V2 chain syntax across docs files.
 *
 * V1: f.text({ required: true, maxLength: 255 })
 * V2: f.text(255).required()
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DOCS_DIR = path.join(__dirname, "..", "apps", "docs", "content", "docs");

// All docs files that might contain V1 syntax
const FILES = [
	"index.mdx",
	"start-here/index.mdx",
	"start-here/first-app.mdx",
	"start-here/installation.mdx",
	"backend/index.mdx",
	"backend/data-modeling/fields.mdx",
	"backend/data-modeling/collections.mdx",
	"backend/data-modeling/globals.mdx",
	"backend/data-modeling/localization.mdx",
	"backend/data-modeling/relations.mdx",
	"backend/rules/validation.mdx",
	"backend/architecture/single-source-of-truth.mdx",
	"backend/architecture/codegen.mdx",
	"backend/business-logic/services.mdx",
	"workspace/blocks/defining-blocks.mdx",
	"workspace/blocks/prefetch.mdx",
	"workspace/media.mdx",
	"extend/building-a-module.mdx",
	"extend/building-a-plugin.mdx",
	"extend/custom-fields.mdx",
	"extend/registries.mdx",
	"frontend/type-inference.mdx",
	"examples/barbershop.mdx",
	"production/database.mdx",
	"production/storage.mdx",
	"reference/field-api.mdx",
];

let totalChanges = 0;

function migrate(content, filePath) {
	let result = content;
	const original = content;

	// =============================================
	// 1. f.richText({ ... }) → f.textarea()...
	//    f.richText() → f.textarea()
	// =============================================
	result = result.replace(
		/f\.richText\(\s*\{([^}]*)\}\s*\)/g,
		(match, opts) => {
			const chain = parseOptsToChain(opts);
			return `f.textarea()${chain}`;
		},
	);
	result = result.replace(/f\.richText\(\)/g, "f.textarea()");

	// =============================================
	// 2. f.text({ required: true, maxLength: 255 }) → f.text(255).required()
	// =============================================
	result = result.replace(/f\.text\(\s*\{([^}]*)\}\s*\)/g, (match, opts) => {
		// Check for virtual — handle separately
		if (opts.includes("virtual")) return match;
		const parsed = parseOpts(opts);
		let factory = "f.text()";
		if (parsed.maxLength) {
			factory = `f.text(${parsed.maxLength})`;
		}
		const chain = buildChain(parsed, ["maxLength"]);
		return `${factory}${chain}`;
	});

	// =============================================
	// 3. f.textarea({ ... }) → f.textarea()...
	// =============================================
	result = result.replace(
		/f\.textarea\(\s*\{([^}]*)\}\s*\)/g,
		(match, opts) => {
			const chain = parseOptsToChain(opts);
			return `f.textarea()${chain}`;
		},
	);

	// =============================================
	// 4. f.email({ ... }) → f.email()...
	// =============================================
	result = result.replace(/f\.email\(\s*\{([^}]*)\}\s*\)/g, (match, opts) => {
		const chain = parseOptsToChain(opts);
		return `f.email()${chain}`;
	});

	// =============================================
	// 5. f.url({ ... }) → f.url()...
	// =============================================
	result = result.replace(/f\.url\(\s*\{([^}]*)\}\s*\)/g, (match, opts) => {
		const chain = parseOptsToChain(opts);
		return `f.url()${chain}`;
	});

	// =============================================
	// 6. f.number({ min: 0, max: 100, ... }) → f.number().min(0).max(100)...
	// =============================================
	result = result.replace(/f\.number\(\s*\{([^}]*)\}\s*\)/g, (match, opts) => {
		const parsed = parseOpts(opts);
		let chain = "";
		if (parsed.required === "true") chain += ".required()";
		if (parsed.min !== undefined) chain += `.min(${parsed.min})`;
		if (parsed.max !== undefined) chain += `.max(${parsed.max})`;
		if (parsed.default !== undefined) chain += `.default(${parsed.default})`;
		if (parsed.defaultValue !== undefined)
			chain += `.default(${parsed.defaultValue})`;
		if (parsed.label) chain += `.label(${parsed.label})`;
		if (parsed.description) chain += `.description(${parsed.description})`;
		if (parsed.localized === "true") chain += ".localized()";
		return `f.number()${chain}`;
	});

	// =============================================
	// 7. f.boolean({ default: false, required: true }) → f.boolean().default(false).required()
	// =============================================
	result = result.replace(/f\.boolean\(\s*\{([^}]*)\}\s*\)/g, (match, opts) => {
		const parsed = parseOpts(opts);
		let chain = "";
		if (parsed.default !== undefined) chain += `.default(${parsed.default})`;
		if (parsed.defaultValue !== undefined)
			chain += `.default(${parsed.defaultValue})`;
		if (parsed.required === "true") chain += ".required()";
		if (parsed.label) chain += `.label(${parsed.label})`;
		if (parsed.localized === "true") chain += ".localized()";
		return `f.boolean()${chain}`;
	});

	// =============================================
	// 8. f.select({ options: [...], ... }) → f.select([...]).required()...
	//    Handle both single-line and multi-line
	// =============================================
	result = result.replace(
		/f\.select\(\s*\{([\s\S]*?)\}\s*\)(?=[\s,;\n)\]])/g,
		(match, opts) => {
			const optionsMatch = opts.match(/options\s*:\s*(\[[\s\S]*?\])/);
			if (!optionsMatch) return match;

			const options = optionsMatch[1];
			const remaining = opts
				.replace(/options\s*:\s*\[[\s\S]*?\]\s*,?/, "")
				.trim();
			const parsed = parseOpts(remaining);

			let chain = "";
			if (parsed.required === "true") chain += ".required()";
			if (parsed.default !== undefined) chain += `.default(${parsed.default})`;
			if (parsed.defaultValue !== undefined)
				chain += `.default(${parsed.defaultValue})`;
			if (parsed.label) chain += `.label(${parsed.label})`;
			if (parsed.localized === "true") chain += ".localized()";

			return `f.select(${options})${chain}`;
		},
	);

	// =============================================
	// 9. f.relation({ to: "users", ... }) → f.relation("users")...
	// =============================================
	// Handle multi-line relation definitions
	result = result.replace(
		/f\.relation\(\s*\{([\s\S]*?)\}\s*\)/g,
		(match, opts) => {
			const parsed = parseOpts(opts);
			if (!parsed.to) return match; // not a standard relation, skip (e.g. polymorphic)

			const target = parsed.to;
			let chain = "";
			if (parsed.required === "true") chain += ".required()";

			// manyToMany (through implies it)
			if (parsed.through) {
				const m2mOpts = [`through: ${parsed.through}`];
				if (parsed.sourceField)
					m2mOpts.push(`sourceField: ${parsed.sourceField}`);
				if (parsed.targetField)
					m2mOpts.push(`targetField: ${parsed.targetField}`);
				chain += `.manyToMany({ ${m2mOpts.join(", ")} })`;
			} else if (parsed.hasMany === "true") {
				const hasManyOpts = [];
				if (parsed.foreignKey)
					hasManyOpts.push(`foreignKey: ${parsed.foreignKey}`);
				chain += `.hasMany({ ${hasManyOpts.join(", ")} })`;
			}

			if (parsed.onDelete) chain += `.onDelete(${parsed.onDelete})`;
			if (parsed.label) chain += `.label(${parsed.label})`;

			return `f.relation(${target})${chain}`;
		},
	);

	// =============================================
	// 10. f.date({ ... }) → f.date()...
	// =============================================
	result = result.replace(/f\.date\(\s*\{([^}]*)\}\s*\)/g, (match, opts) => {
		return `f.date()${parseOptsToChain(opts)}`;
	});

	// =============================================
	// 11. f.datetime({ ... }) → f.datetime()...
	// =============================================
	result = result.replace(
		/f\.datetime\(\s*\{([^}]*)\}\s*\)/g,
		(match, opts) => {
			return `f.datetime()${parseOptsToChain(opts)}`;
		},
	);

	// =============================================
	// 12. f.time({ ... }) → f.time()...
	// =============================================
	result = result.replace(/f\.time\(\s*\{([^}]*)\}\s*\)/g, (match, opts) => {
		return `f.time()${parseOptsToChain(opts)}`;
	});

	// =============================================
	// 13. f.blocks({ ... }) → f.blocks()...
	// =============================================
	result = result.replace(/f\.blocks\(\s*\{([^}]*)\}\s*\)/g, (match, opts) => {
		const parsed = parseOpts(opts);
		let chain = "";
		if (parsed.localized === "true") chain += ".localized()";
		return `f.blocks()${chain}`;
	});

	// =============================================
	// 14. f.json({ ... }) → f.json()...
	// =============================================
	result = result.replace(/f\.json\(\s*\{([^}]*)\}\s*\)/g, (match, opts) => {
		return `f.json()${parseOptsToChain(opts)}`;
	});

	// =============================================
	// 15. Fix inline text references
	// =============================================
	result = result.replace(/`f\.richText\(\)`/g, "`f.textarea()`");
	result = result.replace(/\| `f\.richText\(\)` \|/g, "| `f.textarea()` |");

	// =============================================
	// 16. f.array({ of: ..., maxItems: N }) → ....array().maxItems(N)
	//     f.array({ of: ... }) → ....array()
	//     Handle simple single-line cases
	// =============================================
	// Simple: f.array({ of: f.text() })
	result = result.replace(
		/f\.array\(\s*\{\s*of\s*:\s*(f\.\w+\([^)]*\))\s*\}\s*\)/g,
		(match, inner) => {
			return `${inner}.array()`;
		},
	);
	// With maxItems: f.array({ of: f.text(), maxItems: 10 })
	result = result.replace(
		/f\.array\(\s*\{\s*of\s*:\s*(f\.\w+\([^)]*\))\s*,\s*maxItems\s*:\s*(\d+)\s*\}\s*\)/g,
		(match, inner, maxItems) => {
			return `${inner}.array().maxItems(${maxItems})`;
		},
	);

	if (result !== original) {
		const changes = countDiffs(original, result);
		totalChanges += changes;
		console.log(`  ${filePath}: ${changes} line(s) changed`);
	}

	return result;
}

function parseOpts(optsStr) {
	const result = {};
	const pairs = optsStr.matchAll(
		/(\w+)\s*:\s*("[^"]*"|'[^']*'|\d+|true|false|[^,}\s]+)/g,
	);
	for (const [, key, value] of pairs) {
		result[key] = value;
	}
	return result;
}

function parseOptsToChain(optsStr) {
	const parsed = parseOpts(optsStr);
	return buildChain(parsed, []);
}

function buildChain(parsed, skip) {
	let chain = "";
	if (parsed.required === "true" && !skip.includes("required"))
		chain += ".required()";
	if (parsed.default !== undefined && !skip.includes("default"))
		chain += `.default(${parsed.default})`;
	if (parsed.defaultValue !== undefined && !skip.includes("defaultValue"))
		chain += `.default(${parsed.defaultValue})`;
	if (parsed.label && !skip.includes("label"))
		chain += `.label(${parsed.label})`;
	if (parsed.description && !skip.includes("description"))
		chain += `.description(${parsed.description})`;
	if (parsed.localized === "true" && !skip.includes("localized"))
		chain += ".localized()";
	if (parsed.input === '"optional"' && !skip.includes("input"))
		chain += ".inputOptional()";
	return chain;
}

function countDiffs(a, b) {
	const aLines = a.split("\n");
	const bLines = b.split("\n");
	let diffs = 0;
	const maxLen = Math.max(aLines.length, bLines.length);
	for (let i = 0; i < maxLen; i++) {
		if (aLines[i] !== bLines[i]) diffs++;
	}
	return diffs;
}

// Main
console.log("Migrating V1 → V2 field syntax in docs...\n");

for (const file of FILES) {
	const filePath = path.join(DOCS_DIR, file);
	if (!fs.existsSync(filePath)) {
		continue;
	}
	const content = fs.readFileSync(filePath, "utf-8");
	const migrated = migrate(content, file);
	if (migrated !== content) {
		fs.writeFileSync(filePath, migrated);
	}
}

console.log(`\nDone. ${totalChanges} total line(s) changed.`);
