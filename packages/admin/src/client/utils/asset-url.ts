const STORAGE_FILE_PATH_PATTERN = /^\/api\/[^/]+\/files(?:\/|$)/;

function isStorageFilePath(pathname: string): boolean {
	return STORAGE_FILE_PATH_PATTERN.test(pathname);
}

function currentOrigin(): string | null {
	if (typeof window === "undefined" || !window.location?.origin) {
		return null;
	}
	return window.location.origin;
}

export function resolveAssetUrl(url: string | null | undefined): string | undefined {
	if (typeof url !== "string") return undefined;
	const trimmed = url.trim();
	if (!trimmed) return undefined;

	if (trimmed.startsWith("/")) {
		return trimmed;
	}

	const origin = currentOrigin();
	if (!origin) {
		return trimmed;
	}

	try {
		const parsed = new URL(trimmed);
		if (isStorageFilePath(parsed.pathname) && parsed.origin === origin) {
			return `${parsed.pathname}${parsed.search}${parsed.hash}`;
		}
	} catch {
		return trimmed;
	}

	return trimmed;
}
