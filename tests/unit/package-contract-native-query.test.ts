import { expect, test } from "bun:test";

import { validateNativeQueryPackage } from "../../scripts/package-contract-native-query";

function manifest() {
	return {
		exports: {
			"./react-query": {
				types: "./dist/react-query/index.d.ts",
				import: "./dist/react-query/index.js",
			},
			"./internal/client-projection": {
				types: "./dist/internal/client-projection.d.ts",
				import: "./dist/internal/client-projection.js",
			},
		} as Record<string, unknown>,
		dependencies: {} as Record<string, string>,
		devDependencies: { "@noble/hashes": "2.4.0" } as Record<string, string>,
		optionalDependencies: {} as Record<string, string>,
		peerDependencies: { "@tanstack/react-query": "^5.102.8" } as Record<
			string,
			string
		>,
		peerDependenciesMeta: {
			"@tanstack/react-query": { optional: true },
		} as Record<string, { optional: boolean }>,
	};
}

const archive = [
	"dist/react-query/index.js",
	"dist/react-query/index.d.ts",
	"dist/react-query/THIRD-PARTY-LICENSE.txt",
	"dist/internal/client-projection.js",
	"dist/internal/client-projection.d.ts",
].join("\n");

test("native Query packaging requires the real optional entry and neutral scope bridge", () => {
	expect(() => validateNativeQueryPackage(manifest(), archive)).not.toThrow();
	for (const subpath of ["./react-query", "./internal/client-projection"]) {
		const candidate = manifest();
		delete candidate.exports[subpath];
		expect(() => validateNativeQueryPackage(candidate, archive)).toThrow(
			"missing or incompatible export",
		);
	}
});

test("native entries cannot forward to the old React hook or publish conditional fallbacks", () => {
	for (const target of [
		{ types: "./dist/react.d.ts", import: "./dist/react.js" },
		{
			types: "./dist/react-query/index.d.ts",
			import: "./dist/react-query/index.js",
			default: "./dist/react.js",
		},
		"./dist/react-query/index.js",
	]) {
		const candidate = manifest();
		candidate.exports["./react-query"] = target;
		expect(() => validateNativeQueryPackage(candidate, archive)).toThrow(
			"missing or incompatible export",
		);
	}
});

test("the archive must contain both new declarations, both runtime entries, and bundled third-party license", () => {
	for (const entry of archive.split("\n")) {
		const incomplete = archive
			.split("\n")
			.filter((path) => path !== entry)
			.join("\n");
		expect(() => validateNativeQueryPackage(manifest(), incomplete)).toThrow(
			`tarball omits ${entry}`,
		);
	}
});

test("native Query is an optional supported peer rather than a mandatory core dependency", () => {
	for (const range of [undefined, "*", "^4.0.0", "^5.0.0"]) {
		const candidate = manifest();
		if (range === undefined)
			delete candidate.peerDependencies["@tanstack/react-query"];
		else candidate.peerDependencies["@tanstack/react-query"] = range;
		expect(() => validateNativeQueryPackage(candidate, archive)).toThrow(
			"optional ^5.102.8 peer",
		);
	}
	const candidate = manifest();
	candidate.peerDependenciesMeta["@tanstack/react-query"] = { optional: false };
	expect(() => validateNativeQueryPackage(candidate, archive)).toThrow(
		"optional ^5.102.8 peer",
	);
	delete candidate.peerDependenciesMeta["@tanstack/react-query"];
	expect(() => validateNativeQueryPackage(candidate, archive)).toThrow(
		"optional ^5.102.8 peer",
	);
});

test("core does not acquire runtime UI dependencies or a host-owned hash implementation", () => {
	for (const dependency of [
		"react",
		"react-dom",
		"@tanstack/react-query",
		"@tanstack/query-core",
		"@noble/hashes",
	]) {
		for (const field of ["dependencies", "optionalDependencies"] as const) {
			const candidate = manifest();
			candidate[field][dependency] = "1.0.0";
			expect(() => validateNativeQueryPackage(candidate, archive)).toThrow(
				"core runtime dependency",
			);
		}
	}
	const candidate = manifest();
	candidate.peerDependencies["@noble/hashes"] = "2.4.0";
	expect(() => validateNativeQueryPackage(candidate, archive)).toThrow(
		"hashing must not be a host peer",
	);
});

test("bundled hashing keeps its exact audited build dependency", () => {
	for (const version of [undefined, "*", "^2.4.0", "2.3.0"]) {
		const candidate = manifest();
		if (version === undefined)
			delete candidate.devDependencies["@noble/hashes"];
		else candidate.devDependencies["@noble/hashes"] = version;
		expect(() => validateNativeQueryPackage(candidate, archive)).toThrow(
			"exact 2.4.0 build dependency",
		);
	}
});
