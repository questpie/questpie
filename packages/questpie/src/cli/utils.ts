import { isAbsolute, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import type { SeedCategory } from "../server/seed/types.js";

const SEED_CATEGORIES: readonly SeedCategory[] = ["required", "dev", "test"];

export function resolveCliPath(path: string, cwd = process.cwd()): string {
	const trimmed = path.trim();
	if (!trimmed) {
		throw new Error("Path must not be empty");
	}
	return isAbsolute(trimmed) ? trimmed : resolve(cwd, trimmed);
}

export function toFileImportSpecifier(path: string): string {
	return pathToFileURL(path).href;
}

export function parseCsvOption(value?: string): string[] | undefined {
	if (value === undefined) return undefined;

	const items = value
		.split(",")
		.map((item) => item.trim())
		.filter(Boolean);

	return items.length > 0 ? items : undefined;
}

export function parseSeedCategoryOption(
	value?: string,
): SeedCategory[] | undefined {
	const categories = parseCsvOption(value);
	if (!categories) return undefined;

	for (const category of categories) {
		if (!SEED_CATEGORIES.includes(category as SeedCategory)) {
			throw new Error(
				`Invalid seed category "${category}". Expected one of: ${SEED_CATEGORIES.join(", ")}`,
			);
		}
	}

	return categories as SeedCategory[];
}

export function parsePositiveIntegerOption(
	value: string | undefined,
	optionName: string,
): number | undefined {
	if (value === undefined) return undefined;

	const trimmed = value.trim();
	if (!/^\d+$/.test(trimmed)) {
		throw new Error(`${optionName} must be a positive integer`);
	}

	const parsed = Number.parseInt(trimmed, 10);
	if (!Number.isSafeInteger(parsed) || parsed < 1) {
		throw new Error(`${optionName} must be a positive integer`);
	}

	return parsed;
}
