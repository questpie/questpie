// Local MVP smoke. Run while `bun run dev` is running in apps/autopilot.
import { app, createContext } from "#questpie";

import { workflowsFromContext } from "../src/questpie/server/lib/workflows";

const ctx = await createContext({ accessMode: "system" });

const appUrl = (process.env.APP_URL || "http://localhost:3000").replace(
	/\/$/,
	"",
);
const timeoutMs = Number(process.env.E2E_TIMEOUT_MS ?? 4 * 60 * 1000);
const pollMs = Number(process.env.E2E_POLL_MS ?? 4000);
const adminEmail = process.env.E2E_ADMIN_EMAIL ?? "info@questpie.com";
const adminPassword = process.env.E2E_ADMIN_PASSWORD ?? "admin123";
const skipChat = process.env.E2E_SKIP_CHAT === "1";

type Doc = Record<string, any>;

type RunEvidence = {
	label: string;
	taskId?: string;
	chatSessionId?: string;
	chatMessageId?: string;
	runId: string;
	status: string;
	runtime?: string | null;
	output?: string | null;
};

function log(...args: unknown[]) {
	console.log("[e2e]", ...args);
}

function fail(message: string): never {
	console.error("[e2e] FAIL:", message);
	process.exit(1);
}

function errorMessage(error: unknown) {
	return error instanceof Error ? error.message : String(error);
}

function docsOf(result: unknown): Doc[] {
	if (Array.isArray(result)) return result;
	if (
		result &&
		typeof result === "object" &&
		Array.isArray((result as any).docs)
	) {
		return (result as any).docs;
	}
	return [];
}

function sleep(ms: number) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function terminalFailure(status: unknown) {
	return status === "failed" || status === "cancelled";
}

function terminalSuccess(status: unknown) {
	return (
		status === "completed" ||
		status === "review" ||
		status === "approved" ||
		status === "done"
	);
}

function relationId(value: unknown) {
	if (typeof value === "string") return value;
	if (
		value &&
		typeof value === "object" &&
		typeof (value as any).id === "string"
	) {
		return (value as any).id as string;
	}
	return null;
}

async function latestRunForTask(taskId: string) {
	const runs = await ctx.collections.run_links.find({
		where: { task: taskId },
		limit: 5,
		orderBy: { createdAt: "desc" },
	});
	return docsOf(runs)[0] ?? null;
}

async function assistantOutput(chatSessionId: string | undefined) {
	if (!chatSessionId) return null;
	const messages = await ctx.collections.chat_messages.find({
		where: { chatSession: chatSessionId, role: "assistant" },
		limit: 1,
		orderBy: { createdAt: "desc" },
	});
	return docsOf(messages)[0]?.content ?? null;
}

async function pollTerminal(input: {
	label: string;
	taskId?: string;
	runId?: string;
	chatSessionId?: string;
	chatMessageId?: string;
}) {
	const deadline = Date.now() + timeoutMs;
	let last = "";
	let sawRun = false;

	while (Date.now() < deadline) {
		const task = input.taskId
			? await ctx.collections.tasks.findOne({ where: { id: input.taskId } })
			: null;
		const run = input.runId
			? await ctx.collections.run_links.findOne({ where: { id: input.runId } })
			: input.taskId
				? await latestRunForTask(input.taskId)
				: null;
		if (run) sawRun = true;

		const taskStatus = task?.status;
		const runStatus = run?.status;
		const output =
			(await assistantOutput(input.chatSessionId)) ??
			String(run?.summary ?? run?.error ?? "").slice(0, 240) ??
			null;
		const snapshot = JSON.stringify({
			label: input.label,
			task: taskStatus,
			run: runStatus,
			runtime: run?.runtime,
			output: output ? String(output).slice(0, 120) : null,
		});

		if (snapshot !== last) {
			log(new Date().toISOString(), snapshot);
			last = snapshot;
		}

		if (terminalFailure(taskStatus) || terminalFailure(runStatus)) {
			fail(`${input.label} reached failure state: ${snapshot}`);
		}

		if (run && (terminalSuccess(runStatus) || terminalSuccess(taskStatus))) {
			return {
				label: input.label,
				taskId: input.taskId,
				chatSessionId: input.chatSessionId,
				chatMessageId: input.chatMessageId,
				runId: run.id,
				status: String(runStatus ?? taskStatus),
				runtime: run.runtime ?? null,
				output,
			} satisfies RunEvidence;
		}

		await sleep(pollMs);
	}

	if (!sawRun) {
		fail(`${input.label} timed out before any run was created. Last: ${last}`);
	}
	fail(`${input.label} timed out before terminal result. Last: ${last}`);
}

async function commandExists(command: string) {
	const child = Bun.spawn(["sh", "-lc", `command -v ${command}`], {
		stdout: "ignore",
		stderr: "ignore",
	});
	return (await child.exited) === 0;
}

async function runTaskSmoke() {
	const task = await ctx.collections.tasks.create({
		title: "E2E smoke: reply with one sentence",
		description:
			'Reply with exactly one short sentence confirming you ran: "Autopilot e2e OK". Do not edit files.',
		type: "task",
		status: "pending",
		priority: "medium",
		scopeType: "company",
		createdBy: "e2e",
	});

	const workflow = await workflowsFromContext(ctx).trigger(
		"task-pipeline",
		{ taskId: task.id, runReason: "e2e", requestedBy: "e2e" },
		{ idempotencyKey: `task-pipeline:${task.id}` },
	);
	log("task flow started", {
		taskId: task.id,
		workflowInstanceId: workflow.instanceId,
		existingWorkflow: workflow.existing,
	});

	return pollTerminal({ label: "task", taskId: task.id });
}

function cookiesFromSetCookie(header: string | null) {
	if (!header) return "";
	return header
		.split(/,\s*(?=[^;,]+=)/)
		.map((value) => value.split(";")[0]?.trim())
		.filter(Boolean)
		.join("; ");
}

async function signIn() {
	let response: Response;
	try {
		response = await fetch(`${appUrl}/api/auth/sign-in/email`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ email: adminEmail, password: adminPassword }),
		});
	} catch (error) {
		log("HTTP/session smoke skipped: app URL is not reachable", {
			appUrl,
			error: error instanceof Error ? error.message : String(error),
		});
		return null;
	}

	const text = await response.text();
	if (!response.ok) {
		log("HTTP/session smoke skipped: sign-in failed", {
			status: response.status,
			body: text.slice(0, 300),
		});
		return null;
	}

	const body = JSON.parse(text) as { user?: { id?: string } };
	const cookie = cookiesFromSetCookie(response.headers.get("set-cookie"));
	if (!cookie || !body.user?.id) {
		log("HTTP/session smoke skipped: sign-in did not return cookie/user id");
		return null;
	}
	return { cookie, userId: body.user.id };
}

async function postJson(path: string, cookie: string, body: unknown) {
	const response = await fetch(`${appUrl}${path}`, {
		method: "POST",
		headers: {
			"content-type": "application/json",
			cookie,
		},
		body: JSON.stringify(body),
	});
	const text = await response.text();
	if (!response.ok) {
		fail(`${path} returned ${response.status}: ${text.slice(0, 500)}`);
	}
	return JSON.parse(text) as Doc;
}

async function runChatSmoke(auth: { cookie: string; userId: string } | null) {
	if (skipChat) {
		log("chat flow skipped by E2E_SKIP_CHAT=1");
		return null;
	}
	if (!auth) return null;

	const result = await postJson("/api/chat", auth.cookie, {
		content:
			'Reply with exactly one short sentence confirming chat ran: "Autopilot chat e2e OK".',
		metadata: { source: "e2e-run" },
	});
	const sessionId = String(
		result.session?.id ?? result.message?.chatSession ?? "",
	);
	const messageId = String(result.message?.id ?? "");
	const runId = String(result.runId ?? result.run?.id ?? "");
	if (!sessionId || !messageId || !runId) {
		fail(
			`chat flow did not return session/message/run ids: ${JSON.stringify(result)}`,
		);
	}
	log("chat flow started", { sessionId, messageId, runId });
	return pollTerminal({
		label: "chat",
		runId,
		chatSessionId: sessionId,
		chatMessageId: messageId,
	});
}

async function runAgentPrincipalSmoke(
	auth: { cookie: string; userId: string } | null,
) {
	if (!auth) return null;

	let apiKey: { id: string; key: string };
	try {
		apiKey = await (app.auth.api as any).createApiKey({
			body: {
				name: `e2e-agent-${Date.now()}`,
				userId: auth.userId,
			},
		});
	} catch (error) {
		fail(
			`agent/MCP principal smoke could not create a Better Auth API key. ` +
				`Ensure database migrations are applied (bun run --cwd apps/autopilot migrate). ${errorMessage(error)}`,
		);
	}
	const session = await app.auth.api.getSession({
		headers: new Headers({ "x-api-key": apiKey.key }),
	});
	if (session?.user.id !== auth.userId) {
		fail("API-key principal did not resolve to the signed-in user");
	}

	const response = await fetch(`${appUrl}/api/mcp`, {
		method: "POST",
		headers: {
			accept: "application/json, text/event-stream",
			"content-type": "application/json",
			"x-api-key": apiKey.key,
		},
		body: JSON.stringify({
			jsonrpc: "2.0",
			id: 1,
			method: "initialize",
			params: {
				protocolVersion: "2025-06-18",
				capabilities: {},
				clientInfo: { name: "autopilot-e2e", version: "1.0.0" },
			},
		}),
	});
	const text = await response.text();
	if (!response.ok) {
		fail(
			`MCP API-key principal initialize failed ${response.status}: ${text.slice(0, 500)}`,
		);
	}
	log("agent/MCP principal smoke passed", {
		userId: auth.userId,
		apiKeyId: apiKey.id,
		mcpStatus: response.status,
	});
	return {
		userId: auth.userId,
		apiKeyId: apiKey.id,
		mcpStatus: response.status,
	};
}

log("assumptions", {
	appUrl,
	timeoutMs,
	adminEmail,
	codexAvailable: await commandExists("codex"),
	claudeAvailable: await commandExists("claude"),
});

const taskEvidence = await runTaskSmoke();
const auth = await signIn();
const chatEvidence = await runChatSmoke(auth);
const principalEvidence = await runAgentPrincipalSmoke(auth);

log("PASS", {
	task: taskEvidence,
	chat: chatEvidence,
	principal: principalEvidence,
});
process.exit(0);
