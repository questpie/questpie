import { ApiError } from "questpie";

export function getAiServices(ctx: unknown) {
	const services = (ctx as any).services;
	return {
		workerManager: services.workerManager as any,
	};
}

export function workerSecretFromRequest(request: Request): string | null {
	const direct = request.headers.get("x-worker-secret")?.trim();
	if (direct) return direct;
	const authorization = request.headers.get("authorization");
	const match = authorization?.match(/^Bearer\s+(.+)$/i);
	return match?.[1]?.trim() || null;
}

export async function authenticateWorker(
	ctx: unknown,
): Promise<{ id: string }> {
	const secret = workerSecretFromRequest((ctx as any).request);
	if (!secret) throw ApiError.unauthorized();
	const { workerManager } = getAiServices(ctx);
	const worker = await workerManager.authenticate(secret);
	if (!worker) throw ApiError.unauthorized();
	return worker;
}
