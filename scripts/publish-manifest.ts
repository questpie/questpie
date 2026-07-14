type DependencyMap = Record<string, string>;

type PublishManifest = {
	dependencies?: DependencyMap;
	optionalDependencies?: DependencyMap;
	peerDependencies?: DependencyMap;
};

export function replaceWorkspaceVersions(
	dependencies: DependencyMap | undefined,
	versions: ReadonlyMap<string, string>,
): DependencyMap | undefined {
	if (!dependencies) return dependencies;

	return Object.fromEntries(
		Object.entries(dependencies).map(([name, version]) => {
			if (!version.startsWith("workspace:")) return [name, version];

			const actualVersion = versions.get(name);
			if (!actualVersion) return [name, version];
			if (version === "workspace:~") return [name, `~${actualVersion}`];
			return [name, `^${actualVersion}`];
		}),
	);
}

export function assertNoWorkspaceProtocols(manifest: PublishManifest): void {
	const unresolved: string[] = [];

	for (const key of [
		"dependencies",
		"optionalDependencies",
		"peerDependencies",
	] as const) {
		for (const [name, version] of Object.entries(manifest[key] ?? {})) {
			if (version.startsWith("workspace:")) {
				unresolved.push(`${key}.${name}=${version}`);
			}
		}
	}

	if (unresolved.length > 0) {
		throw new Error(
			`Refusing to publish unresolved workspace protocols: ${unresolved.join(", ")}`,
		);
	}
}
