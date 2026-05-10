import { mkdir, cp, readdir, stat, rm } from "node:fs/promises";
import { join, dirname, relative } from "node:path";
import type { SessionStorageAdapter } from "../types/storage.js";

export function fsStorageAdapter(basePath: string): SessionStorageAdapter {
	return {
		async pull(key, localPath) {
			const src = join(basePath, key);
			const srcStat = await stat(src).catch(() => null);
			if (!srcStat) return;

			await mkdir(dirname(localPath), { recursive: true });
			if (srcStat.isDirectory()) {
				await cp(src, localPath, { recursive: true });
			} else {
				await cp(src, localPath);
			}
		},

		async push(localPath, key) {
			const dest = join(basePath, key);
			const localStat = await stat(localPath).catch(() => null);
			if (!localStat) return;

			await mkdir(dirname(dest), { recursive: true });
			if (localStat.isDirectory()) {
				await cp(localPath, dest, { recursive: true });
			} else {
				await cp(localPath, dest);
			}
		},

		async exists(key) {
			const target = join(basePath, key);
			return stat(target)
				.then(() => true)
				.catch(() => false);
		},

		async list(prefix) {
			const dir = join(basePath, prefix);
			const entries = await readdir(dir, { recursive: true }).catch(
				() => [] as string[],
			);
			return entries.map((e) => join(prefix, e));
		},

		async delete(key) {
			const target = join(basePath, key);
			await rm(target, { recursive: true, force: true });
		},
	};
}
