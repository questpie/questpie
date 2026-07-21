import { createHash } from "node:crypto";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const denoPath = Bun.which("deno");
export const AGENT_ADMISSION_SECRET =
	"hreben-sandbox-runtime-admission-key-32-bytes-minimum";
export const AGENT_ADMISSION_KEY = {
	keyId: "sandbox-agent-v1",
	secret: new TextEncoder().encode(AGENT_ADMISSION_SECRET),
	instanceId: "sandbox_instance_test_01",
};

const SERVER_ENTRY = new URL("../src/sandbox-server.ts", import.meta.url)
	.pathname;
export const NON_AGENT_ADMISSION_SECRET =
	"hreben-sandbox-non-agent-service-key-32-bytes-minimum";

async function waitForListen(
	child: ReturnType<typeof Bun.spawn>,
): Promise<number> {
	const reader = child.stdout.getReader();
	const decoder = new TextDecoder();
	const deadline = Date.now() + 15_000;
	let output = "";
	while (Date.now() < deadline) {
		const { value, done } = await reader.read();
		if (done) break;
		output += decoder.decode(value, { stream: true });
		const match = output.match(/listening on :(\d+)/);
		if (match) {
			reader.releaseLock();
			return Number(match[1]);
		}
	}
	reader.releaseLock();
	throw new Error(`sandbox-server did not start; output:\n${output}`);
}

export class AgentWorkloadHttpServerFixture {
	private child: ReturnType<typeof Bun.spawn> | undefined;
	private outputPump: Promise<void> | undefined;
	private readonly outputLines: string[] = [];
	url = "";
	workRootBase = "";

	async start(): Promise<void> {
		if (!denoPath) return;
		this.workRootBase = await mkdtemp(
			join(tmpdir(), "qp-agent-workloads-test-"),
		);
		this.child = Bun.spawn(
			[
				denoPath,
				"run",
				"--allow-net",
				"--allow-env",
				"--allow-run",
				"--allow-read",
				`--allow-write=${this.workRootBase}`,
				SERVER_ENTRY,
			],
			{
				env: {
					...process.env,
					PORT: "0",
					SANDBOX_AGENT_ADMISSION_SECRET: AGENT_ADMISSION_SECRET,
					SANDBOX_AGENT_WORK_ROOT: this.workRootBase,
					SANDBOX_INSTANCE_ID: AGENT_ADMISSION_KEY.instanceId,
					SANDBOX_NON_AGENT_ADMISSION_SECRET: NON_AGENT_ADMISSION_SECRET,
				},
				stdout: "pipe",
				stderr: "pipe",
			},
		);
		const port = await waitForListen(this.child);
		this.url = `http://127.0.0.1:${port}`;
		this.outputPump = this.collectOutput();
	}

	private async collectOutput(): Promise<void> {
		if (!this.child) return;
		const reader = this.child.stdout.getReader();
		const decoder = new TextDecoder();
		let pending = "";
		try {
			while (true) {
				const { value, done } = await reader.read();
				if (done) break;
				pending += decoder.decode(value, { stream: true });
				let newline: number;
				while ((newline = pending.indexOf("\n")) !== -1) {
					this.outputLines.push(pending.slice(0, newline));
					pending = pending.slice(newline + 1);
				}
			}
			if (pending.length > 0) this.outputLines.push(pending);
		} finally {
			reader.releaseLock();
		}
	}

	async waitForAdmissionAudit(
		predicate: (event: Readonly<Record<string, unknown>>) => boolean,
	): Promise<Readonly<Record<string, unknown>>> {
		const deadline = Date.now() + 2_000;
		while (Date.now() < deadline) {
			for (const line of this.outputLines) {
				try {
					const event = JSON.parse(line) as Readonly<Record<string, unknown>>;
					if (predicate(event)) return event;
				} catch {
					// Non-JSON operational supervisor output is not an audit event.
				}
			}
			await Bun.sleep(10);
		}
		throw new Error("expected supervisor admission audit was not emitted");
	}

	async waitForOutputLine(
		predicate: (line: string) => boolean,
	): Promise<string> {
		const deadline = Date.now() + 2_000;
		while (Date.now() < deadline) {
			const line = this.outputLines.find(predicate);
			if (line) return line;
			await Bun.sleep(10);
		}
		throw new Error("expected supervisor output line was not emitted");
	}

	async stop(): Promise<void> {
		this.child?.kill();
		await this.child?.exited;
		await this.outputPump;
		if (this.workRootBase) {
			await rm(this.workRootBase, { recursive: true, force: true });
		}
	}
}

export async function waitForAgentWorkDirectory(
	path: string,
): Promise<string[]> {
	const deadline = Date.now() + 5_000;
	while (Date.now() < deadline) {
		try {
			const entries = await readdir(path);
			if (entries.length > 0) return entries;
		} catch {
			// The principal-derived directory is created immediately before spawn.
		}
		await Bun.sleep(10);
	}
	throw new Error(`sandbox work root was not created beneath ${path}`);
}

export function agentAdmissionClaims(expiresAt: string, source: string) {
	return {
		kind: "agent_workload_sandbox_admission" as const,
		version: 1 as const,
		admissionId: "admission_test_01",
		principalId: "principal_run_marketing_launch",
		runId: "run_marketing_launch",
		attemptId: "attempt_01",
		workRequestId: "request_marketing_launch",
		companyId: "company_hreben",
		anchorSpaceId: "space_marketing",
		agentActorId: "actor_autopilot",
		skillRevisionId: "skill_campaign_research_v3",
		executionPolicyRevisionId: "execution_policy_autopilot_v5",
		sourceSha256: createHash("sha256").update(source).digest("hex"),
		inputProjectionId: "projection_anchor_space_v1",
		grantEpoch: 7,
		revocationEpoch: 3,
		workerId: "worker_embedded_01",
		workerLeaseId: "lease_run_marketing_launch",
		workerLeaseEpoch: 11,
		supervisorInstanceId: AGENT_ADMISSION_KEY.instanceId,
		expiresAt,
	};
}

export function agentRequestBody(
	source: string,
	overrides: Readonly<Record<string, unknown>> = {},
): string {
	return JSON.stringify({
		mode: "agent_workload",
		source,
		input: null,
		capabilities: {
			net: [],
			import: [],
			timeoutMs: 5_000,
			memoryMb: 128,
		},
		...overrides,
	});
}

export function postAgentRequest(
	sandboxUrl: string,
	requestBody: string,
	admission?: string,
) {
	return fetch(`${sandboxUrl}/run`, {
		method: "POST",
		headers: {
			"content-type": "application/json",
			...(admission
				? { "x-questpie-agent-workload-admission": admission }
				: {}),
		},
		body: requestBody,
	});
}
