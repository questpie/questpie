import { expect, test } from "bun:test";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { importPb05FileBackedModule } from "../support/pb05-file-backed-module";

async function withOwnerRoot(
	use: (ownerRoot: string) => Promise<void>,
): Promise<void> {
	const ownerRoot = await mkdtemp(join(tmpdir(), "questpie-pb05-module-test-"));
	try {
		await use(ownerRoot);
	} finally {
		await rm(ownerRoot, { force: true, recursive: true });
	}
}

test("a large compiled owner module imports from a bounded file path", async () => {
	await withOwnerRoot(async (ownerRoot) => {
		const payload = "x".repeat(256 * 1_024);
		const loaded = await importPb05FileBackedModule<
			Readonly<{ payload: string }>
		>({
			ownerRoot,
			moduleBytes: new Blob([
				`export const payload = ${JSON.stringify(payload)};`,
			]),
		});
		expect(loaded.payload).toBe(payload);
		expect(await readdir(ownerRoot)).toEqual([]);
	});
});

test("a failed module evaluation removes its owned file and directory", async () => {
	await withOwnerRoot(async (ownerRoot) => {
		await expect(
			importPb05FileBackedModule({
				ownerRoot,
				moduleBytes: new Blob([
					'throw new Error("PB-05 synthetic import failure");',
				]),
			}),
		).rejects.toThrow("PB-05 synthetic import failure");
		expect(await readdir(ownerRoot)).toEqual([]);
	});
});
