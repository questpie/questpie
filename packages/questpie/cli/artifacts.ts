import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

export async function committedArtifactDirectories(
	root: string,
	kind: "migrations" | "seeds",
): Promise<string[]> {
	const artifactsRoot = resolve(root, "questpie", kind);
	return (await readdir(artifactsRoot, { withFileTypes: true }))
		.filter((entry) => entry.isDirectory())
		.map((entry) => join(artifactsRoot, entry.name))
		.sort();
}

export async function loadGeneratedSchemaProjection(
	root: string,
): Promise<unknown> {
	return JSON.parse(
		await readFile(
			resolve(root, ".questpie/generated/schema-projection.json"),
			"utf8",
		),
	);
}

export function requestedPort(
	arguments_: readonly string[],
	environmentPort: string | undefined,
): number {
	let value = environmentPort ?? "3000";
	for (let index = 0; index < arguments_.length; index += 1) {
		const argument = arguments_[index]!;
		if (argument.startsWith("--port="))
			value = argument.slice("--port=".length);
		else if (argument === "--port") {
			value = arguments_[index + 1] ?? "";
			index += 1;
		}
	}
	if (value.trim().length === 0)
		throw new TypeError("port must be an integer between 0 and 65535");
	const port = Number(value);
	if (!Number.isSafeInteger(port) || port < 0 || port > 65_535)
		throw new TypeError("port must be an integer between 0 and 65535");
	return port;
}
