import type { SessionStorageAdapter } from "../types/storage.js";

export function noopStorageAdapter(): SessionStorageAdapter {
	return {
		async pull() {},
		async push() {},
		async exists() {
			return false;
		},
		async list() {
			return [];
		},
		async delete() {},
	};
}
