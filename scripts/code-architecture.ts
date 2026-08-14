import { existsSync } from "node:fs";

interface ArchitectureRatchet {
	readonly format: "questpie.code-architecture-ratchet";
	readonly version: 1;
	readonly warningLines: number;
	readonly maximumLines: number;
	readonly legacy: Readonly<Record<string, number>>;
}

function fail(message: string): never {
	console.error(`architecture: ${message}`);
	process.exit(1);
}

const ratchet = (await Bun.file(
	"quality/code-architecture.json",
).json()) as ArchitectureRatchet;
if (
	ratchet.format !== "questpie.code-architecture-ratchet" ||
	ratchet.version !== 1 ||
	ratchet.warningLines >= ratchet.maximumLines
)
	fail("ratchet manifest is invalid");

const tracked = Bun.spawnSync(["git", "ls-files"]);
const untracked = Bun.spawnSync([
	"git",
	"ls-files",
	"--others",
	"--exclude-standard",
]);
if (tracked.exitCode !== 0 || untracked.exitCode !== 0)
	fail("cannot enumerate production TypeScript files");
const files = `${tracked.stdout.toString()}\n${untracked.stdout.toString()}`
	.trim()
	.split("\n")
	.filter(
		(path) =>
			/^(?:packages|apps)\/[^/]+\/src\/.+\.tsx?$/.test(path) &&
			existsSync(path),
	)
	.sort();
const failures: string[] = [];
for (const path of files) {
	const text = await Bun.file(path).text();
	const lines =
		(text.match(/\n/g)?.length ?? 0) +
		(text.length > 0 && !text.endsWith("\n") ? 1 : 0);
	const legacyMaximum = ratchet.legacy[path];
	if (legacyMaximum !== undefined) {
		if (lines > legacyMaximum)
			failures.push(
				`${path} grew from its ${legacyMaximum}-line legacy ceiling to ${lines}`,
			);
		if (lines <= ratchet.maximumLines)
			failures.push(
				`${path} reached ${lines} lines; remove its stale legacy entry`,
			);
	} else if (lines > ratchet.maximumLines)
		failures.push(`${path} has ${lines} lines, above ${ratchet.maximumLines}`);
	if (lines > ratchet.warningLines)
		console.warn(`architecture: review ${path} (${lines} lines)`);
}
for (const path of Object.keys(ratchet.legacy))
	if (!files.includes(path))
		failures.push(`${path} legacy entry has no tracked production file`);
if (failures.length > 0) fail(failures.join("\n"));
console.log(`architecture: PASS (${files.length} production TypeScript files)`);
