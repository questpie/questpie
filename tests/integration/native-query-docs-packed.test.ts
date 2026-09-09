import { expect, test } from "bun:test";
import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import {
	prepareNativeQueryDocs,
	runNativeQueryDocs,
} from "../support/native-query-docs-consumer";

const repository = resolve(import.meta.dir, "../..");
const browser = process.env.QUESTPIE_NATIVE_DOCS_BROWSER === "1";

test(`the packed basic native tutorial executes generated types and ${browser ? "Firefox" : "React DOM"}`, async () => {
	const temporary = await mkdtemp(join(tmpdir(), "questpie-native-docs-"));
	try {
		const consumer = await prepareNativeQueryDocs(temporary);
		for (const [source, destination] of [
			["native-query-docs-browser.ts", "browser.ts"],
			["native-query-docs-browser-entry.ts", "browser-entry.ts"],
		] as const)
			await cp(
				join(repository, "tests/support", source),
				join(consumer, destination),
			);
		await runNativeQueryDocs(
			["bun", "node_modules/typescript/bin/tsc", "--project", "tsconfig.json"],
			consumer,
			temporary,
		);
		const report = JSON.parse(
			await runNativeQueryDocs(["bun", "browser.ts"], consumer, temporary),
		);
		expect(report).toEqual({
			scenario: browser
				? "packed-native-docs-firefox"
				: "packed-native-docs-dom",
			assertions: 37,
			mutations: 5,
		});
	} finally {
		await rm(temporary, { recursive: true, force: true });
	}
}, 120_000);
