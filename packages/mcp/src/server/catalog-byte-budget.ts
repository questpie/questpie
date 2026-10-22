import { Buffer } from "node:buffer";

import type { ListToolsResult } from "@modelcontextprotocol/sdk/types.js";

const HARD_CATALOG_BYTES = 100_000;

export function resolveMcpCatalogByteLimit(value?: number): number {
	if (value === undefined) return HARD_CATALOG_BYTES;
	if (
		!Number.isSafeInteger(value) ||
		value <= 0 ||
		value > HARD_CATALOG_BYTES
	) {
		throw new Error(
			"Invalid MCP execution limit: maxCatalogBytes must be an integer from 1 to 100000 (exclusive byte threshold)",
		);
	}
	return value;
}

export function assertMcpCatalogByteBudget(
	result: ListToolsResult,
	maxCatalogBytes?: number,
): void {
	const maximum = resolveMcpCatalogByteLimit(maxCatalogBytes);
	// SDK 1.32.1 lists all enabled tools at once. Reject paging rather than
	// treating one page as proof that the whole catalog fits.
	if (result.nextCursor !== undefined) {
		throw new Error(
			"MCP catalog byte budget requires a complete tools/list result; disable catalog pagination",
		);
	}
	// Measure the final result, including wrapper metadata, after schema diet
	// and visibility projection. The transport's JSON-RPC envelope is excluded.
	const measured = Buffer.byteLength(JSON.stringify(result), "utf8");
	if (measured < maximum) return;
	const contributors = result.tools
		.map((tool) => ({
			name: tool.name.slice(0, 64).replace(/[^\w.-]/g, "?"),
			bytes: Buffer.byteLength(JSON.stringify(tool), "utf8"),
		}))
		.sort((a, b) => b.bytes - a.bytes)
		.slice(0, 5)
		.map((tool) => `${tool.name}=${tool.bytes}`)
		.join(", ");
	throw new Error(
		`MCP catalog byte budget exceeded: ${measured} UTF-8 bytes; must be < ${maximum}. ` +
			`Largest tools (bytes): ${contributors || "none (wrapper metadata)"}. ` +
			"Reduce advertised schemas/descriptions/metadata or explicitly narrow the released catalog. No tools were dropped.",
	);
}
