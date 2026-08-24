import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

export async function importPb05FileBackedModule<Module>(
	input: Readonly<{
		ownerRoot: string;
		moduleBytes: Blob;
	}>,
): Promise<Module> {
	const outputRoot = await mkdtemp(
		join(input.ownerRoot, ".questpie-pb05-owner-bundle-"),
	);
	let loaded: Module;
	try {
		const modulePath = join(outputRoot, `owner-${crypto.randomUUID()}.mjs`);
		await Bun.write(modulePath, input.moduleBytes);
		loaded = (await import(pathToFileURL(modulePath).href)) as Module;
	} catch (primary) {
		try {
			await rm(outputRoot, { force: true, recursive: true });
		} catch (cleanup) {
			console.error(
				"PB-05 suppressed file-backed module cleanup failure",
				cleanup,
			);
		}
		throw primary;
	}
	await rm(outputRoot, { force: true, recursive: true });
	return loaded;
}
