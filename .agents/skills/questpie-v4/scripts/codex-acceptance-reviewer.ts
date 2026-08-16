import {
	existsSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import {
	ACCEPTANCE_REVIEW_PROFILE_V2,
	type AcceptanceReviewerTransport,
} from "./acceptance-review-protocol";

const CODEX_VERSION = "codex-cli 0.147.0";
const CODEX_PATH = resolve("node_modules/.bin/codex");

export function createAcceptanceResponseSchema(
	request: Parameters<AcceptanceReviewerTransport>[0],
) {
	return {
		$schema: "https://json-schema.org/draft/2020-12/schema",
		type: "object",
		additionalProperties: false,
		required: [
			"protocolVersion",
			"axis",
			"model",
			"effort",
			"requestId",
			"packetDigest",
			"reviewedHead",
			"diffBase",
			"verdict",
			"findings",
		],
		properties: {
			protocolVersion: { type: "integer", const: 2 },
			axis: { type: "string", const: request.axis },
			model: {
				type: "string",
				const: ACCEPTANCE_REVIEW_PROFILE_V2.model,
			},
			effort: {
				type: "string",
				const: ACCEPTANCE_REVIEW_PROFILE_V2.effort,
			},
			requestId: { type: "string", const: request.requestId },
			packetDigest: { type: "string", const: request.packetDigest },
			reviewedHead: { type: "string", const: request.reviewedHead },
			diffBase: { type: "string", const: request.diffBase },
			verdict: { type: "string", enum: ["PASS", "BLOCKED"] },
			findings: { type: "string", minLength: 1 },
		},
	};
}

function verifyCodexBinary(): void {
	if (!existsSync(CODEX_PATH))
		throw new Error("pinned Codex executable is not installed");
	const version = Bun.spawnSync([CODEX_PATH, "--version"], {
		stdout: "pipe",
		stderr: "pipe",
	});
	if (
		version.exitCode !== 0 ||
		version.stdout.toString().trim() !== CODEX_VERSION
	)
		throw new Error(`require exact ${CODEX_VERSION}`);
}

export function createCodexAcceptanceReviewer(): AcceptanceReviewerTransport {
	verifyCodexBinary();
	return async (request) => {
		const directory = mkdtempSync(
			join(tmpdir(), "questpie-acceptance-review-"),
		);
		const schemaPath = join(directory, "response-schema.json");
		const responsePath = join(directory, "response.json");
		try {
			writeFileSync(
				schemaPath,
				`${JSON.stringify(createAcceptanceResponseSchema(request), null, 2)}\n`,
			);
			const child = Bun.spawn(
				[
					CODEX_PATH,
					"exec",
					"--ephemeral",
					"--ignore-user-config",
					"--ignore-rules",
					"--strict-config",
					"--skip-git-repo-check",
					"--sandbox",
					"read-only",
					"--model",
					ACCEPTANCE_REVIEW_PROFILE_V2.model,
					"-c",
					`model_reasoning_effort=${JSON.stringify(
						ACCEPTANCE_REVIEW_PROFILE_V2.effort,
					)}`,
					"-c",
					'approval_policy="never"',
					"--json",
					"--output-schema",
					schemaPath,
					"--output-last-message",
					responsePath,
					"-C",
					directory,
					"-",
				],
				{ stdin: "pipe", stdout: "pipe", stderr: "pipe" },
			);
			child.stdin.write(request.prompt);
			child.stdin.end();

			const completed = await Promise.race([
				child.exited.then((exitCode) => ({ exitCode, timedOut: false })),
				Bun.sleep(request.timeoutMs).then(() => ({
					exitCode: -1,
					timedOut: true,
				})),
			]);
			if (completed.timedOut) child.kill();
			const events = await new Response(child.stdout).text();
			const stderr = await new Response(child.stderr).text();
			return {
				exitCode: completed.exitCode,
				timedOut: completed.timedOut,
				stderr: stderr.trim(),
				events: events.trim(),
				finalResponse: existsSync(responsePath)
					? readFileSync(responsePath, "utf8").trim()
					: "",
			};
		} finally {
			rmSync(directory, { recursive: true, force: true });
		}
	};
}
