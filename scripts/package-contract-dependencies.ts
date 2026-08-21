export type PackageDependencyManifest = Readonly<{
	name?: string;
	dependencies?: Readonly<Record<string, string>>;
}>;

export function embeddedProductionDependencies(
	manifests: readonly PackageDependencyManifest[],
): ReadonlyMap<string, string> {
	const dependencies = new Map<string, string>();
	for (const manifest of manifests) {
		for (const [name, specification] of Object.entries(
			manifest.dependencies ?? {},
		).sort(([left], [right]) => left.localeCompare(right))) {
			if (specification.startsWith("workspace:")) continue;
			const prior = dependencies.get(name);
			if (prior !== undefined && prior !== specification)
				throw new TypeError(
					`embedded production dependency ${name} has conflicting specifications ${prior} and ${specification}`,
				);
			dependencies.set(name, specification);
		}
	}
	return new Map(
		[...dependencies].sort(([left], [right]) => left.localeCompare(right)),
	);
}

export function validateEmbeddedProductionDependencies(
	publicDependencies: Readonly<Record<string, string>> | undefined,
	embeddedDependencies: ReadonlyMap<string, string>,
	publicName = "questpie",
): void {
	for (const [name, required] of embeddedDependencies) {
		const declared = publicDependencies?.[name];
		if (declared === undefined)
			throw new TypeError(
				`${publicName}: embedded production dependency ${name}@${required} is missing`,
			);
		if (declared !== required)
			throw new TypeError(
				`${publicName}: embedded production dependency ${name} requires ${required}, found ${declared}`,
			);
	}
}
