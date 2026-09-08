type NativeQueryPackage = Readonly<{
	exports?: Readonly<Record<string, unknown>>;
	dependencies?: Readonly<Record<string, string>>;
	devDependencies?: Readonly<Record<string, string>>;
	optionalDependencies?: Readonly<Record<string, string>>;
	peerDependencies?: Readonly<Record<string, string>>;
	peerDependenciesMeta?: Readonly<
		Record<string, Readonly<{ optional?: boolean }>>
	>;
}>;

export function validateNativeQueryPackage(
	manifest: NativeQueryPackage,
	inspection: string,
): void {
	for (const [subpath, stem] of [
		["./react-query", "react-query/index"],
		["./internal/client-projection", "internal/client-projection"],
	] as const) {
		const target = manifest.exports?.[subpath];
		if (
			!target ||
			typeof target !== "object" ||
			Array.isArray(target) ||
			Object.keys(target).sort().join(",") !== "import,types" ||
			(target as Record<string, unknown>).types !== `./dist/${stem}.d.ts` ||
			(target as Record<string, unknown>).import !== `./dist/${stem}.js`
		)
			throw new Error(`questpie: missing or incompatible export ${subpath}`);
		for (const extension of ["d.ts", "js"]) {
			const path = `dist/${stem}.${extension}`;
			if (!inspection.includes(path))
				throw new Error(`questpie: tarball omits ${path}`);
		}
	}
	const license = "dist/react-query/THIRD-PARTY-LICENSE.txt";
	if (!inspection.includes(license))
		throw new Error(`questpie: tarball omits ${license}`);
	if (manifest.devDependencies?.["@noble/hashes"] !== "2.4.0")
		throw new Error(
			"questpie: bundled hashing requires the exact 2.4.0 build dependency",
		);
	if (
		manifest.peerDependencies?.["@tanstack/react-query"] !== "^5.102.8" ||
		manifest.peerDependenciesMeta?.["@tanstack/react-query"]?.optional !== true
	)
		throw new Error(
			"questpie: React Query must be the optional ^5.102.8 peer for ./react-query",
		);
	for (const dependency of Object.keys({
		...manifest.dependencies,
		...manifest.optionalDependencies,
	})) {
		if (
			[
				"react",
				"react-dom",
				"@tanstack/react-query",
				"@tanstack/query-core",
				"@noble/hashes",
			].includes(dependency)
		)
			throw new Error(
				`questpie: optional adapter owns forbidden core runtime dependency ${dependency}`,
			);
	}
	if (
		manifest.peerDependencies &&
		Object.hasOwn(manifest.peerDependencies, "@noble/hashes")
	)
		throw new Error("questpie: bundled hashing must not be a host peer");
}
