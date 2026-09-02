import { expect, test } from "bun:test";
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";

const repositoryRoot = resolve(import.meta.dir, "../..");
const packageRoot = resolve(repositoryRoot, "packages/react");
const packageJson = JSON.parse(
	readFileSync(resolve(packageRoot, "package.json"), "utf8"),
) as {
	version: string;
	peerDependencies: Readonly<Record<string, string>>;
};

function run(command: readonly string[], cwd: string) {
	return Bun.spawnSync(command, {
		cwd,
		stderr: "pipe",
		stdout: "pipe",
	});
}

function writePeer(
	root: string,
	name: "questpie" | "react",
	version: string,
): void {
	const peerRoot = join(root, "node_modules", name);
	mkdirSync(peerRoot, { recursive: true });
	writeFileSync(
		join(peerRoot, "package.json"),
		JSON.stringify({ name, version, type: "module", exports: "./index.js" }),
	);
	writeFileSync(
		join(peerRoot, "index.js"),
		name === "react"
			? "export const useSyncExternalStore = (subscribe, getSnapshot) => getSnapshot();\n"
			: "export {};\n",
	);
}

function stageConsumer(
	root: string,
	tarball: string,
	reactVersion: string,
): void {
	mkdirSync(root, { recursive: true });
	const installed = join(root, "node_modules/@questpie/react");
	mkdirSync(installed, { recursive: true });
	const extract = run(
		["tar", "-xzf", tarball, "--strip-components=1", "-C", installed],
		root,
	);
	if (extract.exitCode !== 0)
		throw new Error(extract.stderr.toString() || "package extraction failed");
	writePeer(root, "questpie", packageJson.version);
	writePeer(root, "react", reactVersion);
	writeFileSync(
		join(root, "package.json"),
		JSON.stringify({
			name: "questpie-react-package-consumer",
			private: true,
			type: "module",
		}),
	);
}

test("packs an isolated React projection and exposes peer mismatches", () => {
	const temporary = mkdtempSync(join(tmpdir(), "questpie-react-package-"));
	try {
		const packed = run(
			[
				"bun",
				"pm",
				"pack",
				"--destination",
				temporary,
				"--ignore-scripts",
				"--quiet",
			],
			packageRoot,
		);
		expect(packed.exitCode).toBe(0);
		const tarball = resolve(temporary, packed.stdout.toString().trim());
		const listing = run(["tar", "-tzf", tarball], temporary);
		expect(listing.exitCode).toBe(0);
		expect(listing.stdout.toString()).toContain("package/dist/index.d.ts");
		expect(listing.stdout.toString()).toContain("package/dist/index.js");
		expect(listing.stdout.toString()).not.toContain("package/src/");

		const exactRoot = join(temporary, "exact");
		stageConsumer(exactRoot, tarball, "19.2.8");
		expect(
			run(
				[
					"bun",
					"-e",
					'import { useQueryResource } from "@questpie/react"; if (typeof useQueryResource !== "function") process.exit(1)',
				],
				exactRoot,
			).exitCode,
		).toBe(0);

		const mismatchRoot = join(temporary, "mismatch");
		stageConsumer(mismatchRoot, tarball, "18.3.1");
		const installedPeerRange = JSON.parse(
			readFileSync(
				join(mismatchRoot, "node_modules/@questpie/react/package.json"),
				"utf8",
			),
		).peerDependencies.react;
		expect(installedPeerRange).toBe("^19.2.0");
		expect(Bun.semver.satisfies("18.3.1", installedPeerRange)).toBe(false);
		expect(basename(tarball)).toBe(`questpie-react-${packageJson.version}.tgz`);
		expect(packageJson.peerDependencies).toEqual({
			questpie: packageJson.version,
			react: "^19.2.0",
		});
	} finally {
		rmSync(temporary, { force: true, recursive: true });
	}
}, 30_000);
