export function getEnv(name: string): string | undefined {
	if (
		typeof process === "undefined" ||
		!process.env ||
		typeof process.env !== "object"
	) {
		return undefined;
	}
	return process.env[name];
}

export function getNodeEnv(): string | undefined {
	return getEnv("NODE_ENV");
}
