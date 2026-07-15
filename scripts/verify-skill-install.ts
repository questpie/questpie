#!/usr/bin/env bun

import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";

import {
	getSkillsInstallArgs,
	QUESTPIE_SKILL_NAMES,
} from "../packages/create-questpie/src/skills.js";

const ROOT_DIR = resolve(import.meta.dir, "..");
const REQUIRED_REFERENCES = [
	"ai.md",
	"channels.md",
	"module-authoring.md",
	"openapi.md",
	"reactive-apps.md",
];

function inventory(root: string): Map<string, string> {
	const files = new Map<string, string>();
	const visit = (dir: string) => {
		for (const entry of readdirSync(dir, { withFileTypes: true })) {
			const path = join(dir, entry.name);
			if (entry.isDirectory()) visit(path);
			else if (entry.isFile()) {
				files.set(
					relative(root, path),
					createHash("sha256").update(readFileSync(path)).digest("hex"),
				);
			}
		}
	};
	visit(root);
	return files;
}

function assertEqualInventories(
	skill: string,
	canonical: Map<string, string>,
	installed: Map<string, string>,
) {
	const canonicalFiles = [...canonical.keys()].sort();
	const installedFiles = [...installed.keys()].sort();
	if (JSON.stringify(canonicalFiles) !== JSON.stringify(installedFiles)) {
		throw new Error(
			`${skill}: installed inventory differs from canonical inventory`,
		);
	}
	for (const [file, hash] of canonical) {
		if (installed.get(file) !== hash) {
			throw new Error(`${skill}: checksum mismatch for ${file}`);
		}
	}
}

const tempRoot = await mkdtemp(join(tmpdir(), "questpie-skills-parity-"));
try {
	await writeFile(join(tempRoot, "package.json"), '{"private":true}\n');

	const install = Bun.spawnSync({
		cmd: ["bunx", ...getSkillsInstallArgs(ROOT_DIR), "--agent", "codex"],
		cwd: tempRoot,
		stdout: "pipe",
		stderr: "pipe",
	});
	if (install.exitCode !== 0) {
		throw new Error(
			`skills install failed (${install.exitCode})\n${install.stderr.toString()}`,
		);
	}

	const lockPath = join(tempRoot, "skills-lock.json");
	if (!existsSync(lockPath))
		throw new Error("skills-lock.json was not created");
	const lock = JSON.parse(readFileSync(lockPath, "utf8")) as {
		skills?: Record<string, { computedHash?: string }>;
	};

	for (const skill of QUESTPIE_SKILL_NAMES) {
		const canonicalRoot = join(ROOT_DIR, "skills", skill);
		const installedRoot = join(tempRoot, ".agents", "skills", skill);
		if (!statSync(installedRoot).isDirectory()) {
			throw new Error(`${skill}: project-local install directory is missing`);
		}
		assertEqualInventories(
			skill,
			inventory(canonicalRoot),
			inventory(installedRoot),
		);
		if (!lock.skills?.[skill]?.computedHash) {
			throw new Error(`${skill}: skills-lock.json is missing computedHash`);
		}
	}

	for (const reference of REQUIRED_REFERENCES) {
		const installed = join(
			tempRoot,
			".agents",
			"skills",
			"questpie",
			"references",
			reference,
		);
		if (!existsSync(installed)) {
			throw new Error(`questpie: required reference missing: ${reference}`);
		}
	}

	console.log(
		`Verified disposable project install for ${QUESTPIE_SKILL_NAMES.join(", ")} with matching inventories, checksums, and lock hashes.`,
	);
} finally {
	await rm(tempRoot, { recursive: true, force: true });
}
