import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type PackageRegistrationCheck = (name: string) => Promise<boolean>;

export function isNpmNotFoundError(error: unknown): boolean {
	if (!error || typeof error !== "object") return false;
	const output = `${"stdout" in error ? String(error.stdout ?? "") : ""}\n${
		"stderr" in error ? String(error.stderr ?? "") : ""
	}`;
	return /\bE404\b|404 Not Found/i.test(output);
}

export function npmViewMatchesPackage(
	stdout: string,
	expectedName: string,
): boolean {
	return JSON.parse(stdout.trim()) === expectedName;
}

export function npmViewMatchesVersion(
	stdout: string,
	expectedVersion: string,
): boolean {
	return JSON.parse(stdout.trim()) === expectedVersion;
}

export async function isNpmPackageRegistered(name: string): Promise<boolean> {
	try {
		const { stdout } = await execFileAsync(
			"npm",
			["view", name, "name", "--json"],
			{
				env: { ...process.env },
			},
		);
		return npmViewMatchesPackage(stdout, name);
	} catch (error) {
		if (isNpmNotFoundError(error)) return false;
		throw error;
	}
}

export async function isNpmPackageVersionPublished(
	name: string,
	version: string,
): Promise<boolean> {
	try {
		const { stdout } = await execFileAsync(
			"npm",
			["view", `${name}@${version}`, "version", "--json"],
			{
				env: { ...process.env },
			},
		);
		return npmViewMatchesVersion(stdout, version);
	} catch (error) {
		if (isNpmNotFoundError(error)) return false;
		throw error;
	}
}

export async function findUnregisteredPackages(
	names: Iterable<string>,
	check: PackageRegistrationCheck = isNpmPackageRegistered,
): Promise<string[]> {
	const packageNames = [...names];
	const registrations = await Promise.all(
		packageNames.map(async (name) => ({
			name,
			registered: await check(name),
		})),
	);
	return registrations
		.filter(({ registered }) => !registered)
		.map(({ name }) => name)
		.sort();
}

export async function assertPackagesRegistered(
	names: Iterable<string>,
	check: PackageRegistrationCheck = isNpmPackageRegistered,
): Promise<void> {
	const missing = await findUnregisteredPackages(names, check);
	if (missing.length === 0) return;

	throw new Error(
		[
			"Refusing to start a partial release.",
			"npm trusted publishing cannot create an unregistered package name.",
			`Bootstrap these packages with a maintainer token, configure their trusted publisher, and rerun the release: ${missing.join(", ")}`,
		].join(" "),
	);
}
