import { execFile } from "node:child_process";
import { lstat, readdir, readFile } from "node:fs/promises";
import { extname, resolve } from "node:path";
import { promisify } from "node:util";

import { ApiError } from "questpie/errors";

const execFileAsync = promisify(execFile);

const BLOCKED_SEGMENTS = new Set([
	".git",
	".worktrees",
	"node_modules",
	"dist",
	"build",
	"coverage",
]);

const TEXT_EXTENSIONS = new Set([
	".css",
	".diff",
	".html",
	".js",
	".json",
	".jsx",
	".md",
	".mjs",
	".patch",
	".sql",
	".ts",
	".tsx",
	".txt",
	".xml",
	".yaml",
	".yml",
]);

export function normalizeWorkspacePath(path?: string | null): string {
	return (path ?? "").replace(/\/+/g, "/").replace(/^\/|\/$/g, "");
}

export function resolveWorkspacePath(root: string, path?: string | null) {
	const relativePath = normalizeWorkspacePath(path);
	const target = resolve(root, relativePath);
	const resolvedRoot = resolve(root);
	if (target !== resolvedRoot && !target.startsWith(`${resolvedRoot}/`)) {
		throw ApiError.forbidden({
			operation: "read",
			resource: "workspace",
			reason: "Path traversal is not allowed",
		});
	}

	for (const segment of relativePath.split("/").filter(Boolean)) {
		if (BLOCKED_SEGMENTS.has(segment) || /^\.env($|\.)/.test(segment)) {
			throw ApiError.forbidden({
				operation: "read",
				resource: "workspace",
				reason: `Access to ${segment} is blocked`,
			});
		}
	}

	return { target, relativePath };
}

function contentType(path: string) {
	const ext = extname(path).toLowerCase();
	if (ext === ".md") return "text/markdown";
	if (ext === ".json") return "application/json";
	if (ext === ".yaml" || ext === ".yml") return "application/yaml";
	if (ext === ".html" || ext === ".htm") return "text/html";
	if (ext === ".css") return "text/css";
	if (ext === ".js" || ext === ".jsx" || ext === ".mjs")
		return "text/javascript";
	if (ext === ".ts" || ext === ".tsx") return "text/typescript";
	if (ext === ".diff" || ext === ".patch") return "text/x-diff";
	return TEXT_EXTENSIONS.has(ext) ? "text/plain" : "application/octet-stream";
}

export async function listWorkspace(root: string, path?: string | null) {
	const { target, relativePath } = resolveWorkspacePath(root, path);
	const stat = await lstat(target).catch(() => null);
	if (!stat) throw ApiError.notFound("Workspace path", relativePath);
	if (!stat.isDirectory()) {
		throw ApiError.badRequest("Workspace list path must be a directory");
	}

	const entries = await readdir(target, { withFileTypes: true });
	return entries
		.filter(
			(entry) => !entry.name.startsWith(".") || entry.name === ".changeset",
		)
		.filter((entry) => !BLOCKED_SEGMENTS.has(entry.name))
		.map((entry) => ({
			name: entry.name,
			path: relativePath ? `${relativePath}/${entry.name}` : entry.name,
			type: entry.isDirectory() ? "directory" : "file",
		}));
}

export async function readWorkspace(root: string, path: string) {
	const { target, relativePath } = resolveWorkspacePath(root, path);
	if (!relativePath)
		throw ApiError.badRequest("Workspace read path is required");
	const stat = await lstat(target).catch(() => null);
	if (!stat) throw ApiError.notFound("Workspace path", relativePath);
	if (!stat.isFile())
		throw ApiError.badRequest("Workspace read path must be a file");

	const content = await readFile(target);
	const mimeType = contentType(relativePath);
	const isText =
		mimeType.startsWith("text/") ||
		mimeType.includes("json") ||
		mimeType.includes("yaml");
	return {
		path: relativePath,
		contentType: mimeType,
		size: stat.size,
		isText,
		content: isText ? content.toString("utf8") : content.toString("base64"),
		encoding: isText ? "utf8" : "base64",
	};
}

export async function diffWorkspace(
	root: string,
	path?: string | null,
	includeDirty = true,
) {
	const { relativePath } = resolveWorkspacePath(root, path);
	const args = ["diff", "--numstat"];
	if (!includeDirty) args.push("HEAD");
	if (relativePath) args.push("--", relativePath);

	const [{ stdout: diff }, { stdout: nameStatus }, { stdout: head }] =
		await Promise.all([
			execFileAsync(
				"git",
				["-C", root, "diff", "--", relativePath].filter(Boolean),
			),
			execFileAsync(
				"git",
				["-C", root, "diff", "--name-status", "--", relativePath].filter(
					Boolean,
				),
			),
			execFileAsync("git", ["-C", root, "rev-parse", "--abbrev-ref", "HEAD"]),
		]);
	const stats = await execFileAsync("git", ["-C", root, ...args]).catch(() => ({
		stdout: "",
	}));
	const files = nameStatus
		.trim()
		.split("\n")
		.filter(Boolean)
		.map((line) => {
			const [status, filePath, oldPath] = line.split("\t");
			return {
				path: filePath ?? "",
				status: status ?? "M",
				oldPath: oldPath || undefined,
			};
		});
	const totals = String(stats.stdout)
		.trim()
		.split("\n")
		.filter(Boolean)
		.reduce(
			(acc, line) => {
				const [insertions, deletions] = line.split("\t");
				acc.insertions += Number(insertions) || 0;
				acc.deletions += Number(deletions) || 0;
				return acc;
			},
			{ filesChanged: files.length, insertions: 0, deletions: 0 },
		);

	return {
		base: "HEAD",
		head: head.trim() || "working-tree",
		files,
		stats: totals,
		diff,
	};
}
