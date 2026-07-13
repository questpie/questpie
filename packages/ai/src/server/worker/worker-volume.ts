import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export interface PreparedWorkerVolume {
	workerDir: string;
	volumeId: string;
}

export async function prepareWorkerVolume(
	workerDir: string,
): Promise<PreparedWorkerVolume> {
	await mkdir(join(workerDir, "worker"), { recursive: true });

	const volumeIdPath = join(workerDir, "worker", "volume-id");
	let volumeId = "";
	try {
		volumeId = (await readFile(volumeIdPath, "utf-8")).trim();
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
	}

	if (!volumeId) {
		volumeId = `vol_${randomUUID().slice(0, 12)}`;
		await writeFile(volumeIdPath, volumeId);
	}

	return { workerDir, volumeId };
}
