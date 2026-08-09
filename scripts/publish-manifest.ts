type DependencyMap = Record<string, string>;

export type PublishManifest = Record<string, unknown> & {
	dependencies?: DependencyMap;
	optionalDependencies?: DependencyMap;
	peerDependencies?: DependencyMap;
	publishConfig?: Record<string, unknown>;
};

const PUBLISH_CONFIG_METADATA_KEYS = new Set(["access", "registry", "tag"]);

export type PreparedPublishManifest<TManifest extends PublishManifest> = {
	manifest: TManifest;
	appliedPublishConfigKeys: string[];
	resolvedWorkspaceSections: ("dependencies" | "peerDependencies")[];
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

/** Build the exact manifest shape passed to npm by the release workflow. */
export function preparePublishManifest<TManifest extends PublishManifest>(
	source: TManifest,
	versions: ReadonlyMap<string, string>,
): PreparedPublishManifest<TManifest> {
	const manifest = structuredClone(source);
	const appliedPublishConfigKeys: string[] = [];
	const resolvedWorkspaceSections: PreparedPublishManifest<TManifest>["resolvedWorkspaceSections"] =
		[];

	for (const [key, value] of Object.entries(manifest.publishConfig ?? {})) {
		if (PUBLISH_CONFIG_METADATA_KEYS.has(key)) continue;
		manifest[key] = value;
		appliedPublishConfigKeys.push(key);
	}

	for (const key of ["dependencies", "peerDependencies"] as const) {
		const dependencies = manifest[key];
		if (!dependencies) continue;
		if (
			Object.values(dependencies).some((value) =>
				value.startsWith("workspace:"),
			)
		) {
			manifest[key] = replaceWorkspaceVersions(dependencies, versions);
			resolvedWorkspaceSections.push(key);
		}
	}

	assertNoWorkspaceProtocols(manifest);
	return {
		manifest,
		appliedPublishConfigKeys,
		resolvedWorkspaceSections,
	};
}
