import { execSync } from "node:child_process";
import pc from "picocolors";

export function slugify(str: string): string {
	return str
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-|-$/g, "");
}

export function toDbName(str: string): string {
	return str
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "_")
		.replace(/^_|_$/g, "");
}

export function isValidPackageName(name: string): boolean {
	return /^(?:@[a-z0-9-*~][a-z0-9-*._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/.test(
		name,
	);
}

export function generatePassword(length = 24): string {
	const chars =
		"abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
	let result = "";
	const randomBytes = new Uint8Array(length);
	crypto.getRandomValues(randomBytes);
	for (let i = 0; i < length; i++) {
		result += chars[randomBytes[i] % chars.length];
	}
	return result;
}

export function isGitInstalled(): boolean {
	try {
		execSync("git --version", { stdio: "ignore" });
		return true;
	} catch {
		return false;
	}
}

export function gitInit(cwd: string): void {
	execSync("git init", { cwd, stdio: "ignore" });
	execSync("git add -A", { cwd, stdio: "ignore" });
	execSync('git commit -m "Initial commit from create-questpie"', {
		cwd,
		stdio: "ignore",
	});
}

export function installDependencies(
	cwd: string,
	packageManager: "bun" | "npm" | "pnpm" | "yarn",
): void {
	const cmd =
		packageManager === "npm" ? "npm install" : `${packageManager} install`;
	execSync(cmd, { cwd, stdio: "inherit" });
}

export function detectPackageManager(): "bun" | "npm" | "pnpm" | "yarn" {
	const userAgent = process.env.npm_config_user_agent;
	if (userAgent) {
		if (userAgent.startsWith("bun")) return "bun";
		if (userAgent.startsWith("pnpm")) return "pnpm";
		if (userAgent.startsWith("yarn")) return "yarn";
	}
	return "bun";
}

export const label = {
	info: (msg: string) => `${pc.cyan("ℹ")} ${msg}`,
	success: (msg: string) => `${pc.green("✓")} ${msg}`,
	warn: (msg: string) => `${pc.yellow("⚠")} ${msg}`,
	error: (msg: string) => `${pc.red("✗")} ${msg}`,
};
