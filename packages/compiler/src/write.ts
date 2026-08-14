import {
	access,
	mkdir,
	mkdtemp,
	rename,
	rm,
	writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";

async function exists(path: string): Promise<boolean> {
	try {
		await access(path);
		return true;
	} catch {
		return false;
	}
}

export async function replaceGeneratedDirectory(
	outputDirectory: string,
	files: Readonly<Record<string, string>>,
): Promise<void> {
	const parent = dirname(outputDirectory);
	await mkdir(parent, { recursive: true });
	const candidate = await mkdtemp(
		join(parent, ".questpie-generated-candidate-"),
	);
	const backup = `${outputDirectory}.backup-${crypto.randomUUID()}`;
	let previousMoved = false;
	try {
		for (const [path, contents] of Object.entries(files)) {
			const target = join(candidate, path);
			await mkdir(dirname(target), { recursive: true });
			await writeFile(target, contents);
		}
		if (await exists(outputDirectory)) {
			await rename(outputDirectory, backup);
			previousMoved = true;
		}
		try {
			await rename(candidate, outputDirectory);
		} catch (error) {
			if (previousMoved) await rename(backup, outputDirectory);
			throw error;
		}
		if (previousMoved) await rm(backup, { force: true, recursive: true });
	} finally {
		await rm(candidate, { force: true, recursive: true });
	}
}
