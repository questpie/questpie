import { ApiError } from "questpie/errors";

import { relationId } from "./records";

type WorkerAuthContext = Questpie.AppContext & { request: Request };
type WorkerRecord = { id: string } & Record<string, unknown>;

export function asWorkerRecord(worker: unknown): WorkerRecord {
	if (
		worker &&
		typeof worker === "object" &&
		typeof (worker as { id?: unknown }).id === "string"
	) {
		return worker as WorkerRecord;
	}
	throw ApiError.unauthorized("Invalid worker credential");
}

function isLoopbackHost(value: string | null) {
	return (
		value === "localhost" ||
		value === "127.0.0.1" ||
		value === "::1" ||
		value === "[::1]"
	);
}

export function workerSecretFromRequest(request: Request) {
	const direct = request.headers.get("x-worker-secret")?.trim();
	if (direct) return direct;

	const authorization = request.headers.get("authorization");
	const match = authorization?.match(/^Bearer\s+(.+)$/i);
	return match?.[1]?.trim() || null;
}

export function isLocalDevWorkerRequest(request: Request) {
	if (process.env.NODE_ENV === "production") return false;
	if (request.headers.get("x-local-dev") !== "true") return false;

	const forwardedFor = request.headers.get("x-forwarded-for");
	if (forwardedFor) {
		return isLoopbackHost(forwardedFor.split(",")[0]?.trim() ?? null);
	}

	try {
		return isLoopbackHost(new URL(request.url).hostname);
	} catch {
		return false;
	}
}

function assertWorkerMatch(workerId: string, bodyWorkerId?: string | null) {
	if (!bodyWorkerId || bodyWorkerId === workerId) return;
	throw ApiError.forbidden({
		operation: "update",
		resource: "workers",
		reason: `Authenticated as ${workerId} but body worker id is ${bodyWorkerId}`,
	});
}

export async function authenticatedWorker(
	ctx: WorkerAuthContext,
	bodyWorkerId?: string | null,
) {
	const secret = workerSecretFromRequest(ctx.request);
	if (secret) {
		const worker = asWorkerRecord(
			await ctx.services.workerManager.requireWorker(secret),
		);
		assertWorkerMatch(worker.id, bodyWorkerId);
		return worker;
	}

	if (isLocalDevWorkerRequest(ctx.request)) {
		if (!bodyWorkerId) {
			throw ApiError.badRequest(
				"workerId is required for local dev worker calls",
			);
		}
		return { id: bodyWorkerId };
	}

	throw ApiError.unauthorized(
		"Worker authentication required (X-Worker-Secret or Authorization: Bearer)",
	);
}

export async function authorizeWorkerOrSession(ctx: WorkerAuthContext) {
	if (ctx.session?.user) return { kind: "session" as const };

	const secret = workerSecretFromRequest(ctx.request);
	if (secret) {
		const worker = asWorkerRecord(
			await ctx.services.workerManager.requireWorker(secret),
		);
		return { kind: "worker" as const, worker };
	}

	if (isLocalDevWorkerRequest(ctx.request))
		return { kind: "localDev" as const };

	throw ApiError.unauthorized(
		"Authentication required (session, X-Worker-Secret, or Authorization: Bearer)",
	);
}

export async function authenticatedRunWorker(
	ctx: WorkerAuthContext,
	runId: string,
	bodyWorkerId?: string | null,
) {
	const secret = workerSecretFromRequest(ctx.request);
	if (secret) {
		const worker = asWorkerRecord(
			await ctx.services.workerManager.requireWorker(secret),
		);
		assertWorkerMatch(worker.id, bodyWorkerId);
		const { run, lease } = await ctx.services.workerManager.requireActiveLease(
			worker.id,
			runId,
		);
		return { worker, run, lease, localDev: false };
	}

	if (!isLocalDevWorkerRequest(ctx.request)) {
		throw ApiError.unauthorized(
			"Worker authentication required (X-Worker-Secret or Authorization: Bearer)",
		);
	}

	const run = await ctx.collections.runs.findOne({ where: { id: runId } });
	if (!run) throw ApiError.notFound("Run", runId);

	const workerId = bodyWorkerId ?? relationId(run.worker) ?? "local-dev";
	return { worker: { id: workerId }, run, lease: null, localDev: true };
}
