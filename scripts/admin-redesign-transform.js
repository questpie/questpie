#!/usr/bin/env node
/**
 * Phase 2: Batch Mechanical Cleanup
 * Removes glass morphism patterns from all admin client files.
 *
 * Handles Tailwind variant prefixes (data-*:, supports-*:, hover:, dark:, etc.)
 * Does NOT touch general string formatting.
 */

const { readFileSync, writeFileSync } = require("node:fs");
const { execSync } = require("node:child_process");

const ROOT = "packages/admin/src/client";

const files = execSync(
	`find ${ROOT} -type f \\( -name "*.tsx" -o -name "*.ts" \\)`,
	{ encoding: "utf-8" },
)
	.trim()
	.split("\n")
	.filter(Boolean);

console.log(`Found ${files.length} files to scan`);

// Tailwind variant prefix pattern (captures optional chain of variant prefixes)
// e.g., "dark:hover:", "data-closed:", "supports-backdrop-filter:", etc.
const VARIANT_PREFIX = "(?:[a-zA-Z][\\w-]*(?:\\[[^\\]]*\\])?:)*";

let filesChanged = 0;

for (const file of files) {
	let content;
	try {
		content = readFileSync(file, "utf-8");
	} catch {
		continue;
	}

	const original = content;

	// 1. REMOVE: backdrop-blur variants WITH their variant prefixes
	// e.g., "supports-backdrop-filter:backdrop-blur-xs" -> removed entirely
	const blurRegex = new RegExp(
		`${VARIANT_PREFIX}backdrop-blur(?:-\\w+)?\\s*`,
		"g",
	);
	content = content.replace(blurRegex, "");

	// 2. REMOVE: zoom animations WITH their variant prefixes
	// e.g., "data-closed:zoom-out-95" -> removed entirely
	const zoomOutRegex = new RegExp(`${VARIANT_PREFIX}zoom-out-95\\s*`, "g");
	const zoomInRegex = new RegExp(`${VARIANT_PREFIX}zoom-in-95\\s*`, "g");
	content = content.replace(zoomOutRegex, "");
	content = content.replace(zoomInRegex, "");

	// 3. REMOVE: custom glow utilities WITH variant prefixes
	const glowRegex = new RegExp(`${VARIANT_PREFIX}glow-[\\w-]+\\s*`, "g");
	content = content.replace(glowRegex, "");

	// 4. REMOVE: ambient-beam WITH variant prefixes
	const ambientRegex = new RegExp(`${VARIANT_PREFIX}ambient-beam\\s*`, "g");
	content = content.replace(ambientRegex, "");

	// 5. REMOVE: bg-grid-quest WITH variant prefixes
	const gridRegex = new RegExp(`${VARIANT_PREFIX}bg-grid-quest\\s*`, "g");
	content = content.replace(gridRegex, "");

	// 6. REPLACE: bg-X/NN -> bg-X (semantic surface colors only)
	// WITH variant prefixes preserved: "dark:bg-muted/50" -> "dark:bg-muted"
	// Skip safe patterns via negative lookahead isn't needed — we explicitly list surface colors
	const surfaceColors =
		"card|input|popover|muted|background|sidebar|accent|secondary";
	const bgSurfaceRegex = new RegExp(
		`(${VARIANT_PREFIX})bg-(${surfaceColors})\\/\\d+`,
		"g",
	);
	content = content.replace(bgSurfaceRegex, "$1bg-$2");

	// 7. REPLACE: border-border/NN -> border-border (with variant prefixes)
	const borderBorderRegex = new RegExp(
		`(${VARIANT_PREFIX})border-border\\/\\d+`,
		"g",
	);
	content = content.replace(borderBorderRegex, "$1border-border");

	// 8. REPLACE: border-sidebar-border/NN -> border-sidebar-border (with variant prefixes)
	const sidebarBorderRegex = new RegExp(
		`(${VARIANT_PREFIX})border-sidebar-border\\/\\d+`,
		"g",
	);
	content = content.replace(sidebarBorderRegex, "$1border-sidebar-border");

	// 9. REPLACE: border-input/NN -> border-border (with variant prefixes)
	const borderInputRegex = new RegExp(
		`(${VARIANT_PREFIX})border-input\\/\\d+`,
		"g",
	);
	content = content.replace(borderInputRegex, "$1border-border");

	// 10. REPLACE: bg-border/NN -> bg-border (with variant prefixes)
	const bgBorderRegex = new RegExp(`(${VARIANT_PREFIX})bg-border\\/\\d+`, "g");
	content = content.replace(bgBorderRegex, "$1bg-border");

	if (content !== original) {
		writeFileSync(file, content);
		filesChanged++;
		console.log(`  Modified: ${file}`);
	}
}

console.log(`\nPhase 2 complete: ${filesChanged} files modified`);
