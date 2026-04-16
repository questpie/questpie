import { exec } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { promisify } from "node:util";

const execAsync = promisify(exec);

const ROOT_DIR = path.join(import.meta.dirname, "..");
const PUBLISH_SUMMARY_PATH = path.join(
	ROOT_DIR,
	".changeset",
	"publish-summary.json",
);
const DRY_RUN = process.env.GITHUB_RELEASE_DRY_RUN === "1";

interface PublishedPackageSummary {
	name: string;
	version: string;
	dir: string;
}

interface PublishSummary {
	packages: PublishedPackageSummary[];
	generatedAt: string;
}

function shellQuote(value: string): string {
	return `'${value.replace(/'/g, `'\\''`)}'`;
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function extractReleaseNotes(
	changelogPath: string,
	version: string,
	fallback: string,
): string {
	if (!fs.existsSync(changelogPath)) return fallback;

	const lines = fs.readFileSync(changelogPath, "utf8").split("\n");
	const versionHeader = new RegExp(`^##\\s+${escapeRegExp(version)}(?:\\s|$)`);
	const start = lines.findIndex((line) => versionHeader.test(line.trim()));
	if (start === -1) return fallback;

	let end = lines.length;
	for (let i = start + 1; i < lines.length; i++) {
		if (/^##\s+/.test(lines[i]?.trim() ?? "")) {
			end = i;
			break;
		}
	}

	const notes = lines.slice(start + 1, end).join("\n").trim();
	return notes || fallback;
}

async function releaseExists(tag: string): Promise<boolean> {
	try {
		await execAsync(`gh release view ${shellQuote(tag)} --json tagName`, {
			cwd: ROOT_DIR,
			env: { ...process.env },
		});
		return true;
	} catch {
		return false;
	}
}

async function createRelease(options: {
	tag: string;
	title: string;
	notes: string;
	latest?: boolean;
}): Promise<void> {
	if (await releaseExists(options.tag)) {
		console.log(`⏭️  Release ${options.tag} already exists`);
		return;
	}

	const latestFlag = options.latest ? " --latest" : "";
	const command =
		`gh release create ${shellQuote(options.tag)}` +
		` --title ${shellQuote(options.title)}` +
		` --notes ${shellQuote(options.notes)}` +
		latestFlag;

	if (DRY_RUN) {
		console.log(`[dry-run] ${command}`);
		return;
	}

	await execAsync(command, {
		cwd: ROOT_DIR,
		env: { ...process.env },
	});
	console.log(`✅ Created release ${options.tag}`);
}

async function main(): Promise<void> {
	if (!fs.existsSync(PUBLISH_SUMMARY_PATH)) {
		console.log("No publish summary found, skipping GitHub release creation.");
		return;
	}

	const summary = JSON.parse(
		fs.readFileSync(PUBLISH_SUMMARY_PATH, "utf8"),
	) as PublishSummary;

	if (!summary.packages.length) {
		console.log("Publish summary is empty, skipping GitHub release creation.");
		return;
	}

	for (const pkg of summary.packages) {
		const tag = `${pkg.name}@${pkg.version}`;
		const fallback = `Release ${tag}`;
		const notes = extractReleaseNotes(
			path.join(ROOT_DIR, pkg.dir, "CHANGELOG.md"),
			pkg.version,
			fallback,
		);
		await createRelease({
			tag,
			title: tag,
			notes,
		});
	}

	const rootPackage = summary.packages.find((pkg) => pkg.name === "questpie");
	if (!rootPackage) return;

	const rootTag = `v${rootPackage.version}`;
	const rootNotes = extractReleaseNotes(
		path.join(ROOT_DIR, rootPackage.dir, "CHANGELOG.md"),
		rootPackage.version,
		`Release ${rootTag}`,
	);

	await createRelease({
		tag: rootTag,
		title: rootTag,
		notes: rootNotes,
		latest: true,
	});
}

main().catch((error) => {
	console.error("Failed to create GitHub releases:", error);
	process.exit(1);
});
