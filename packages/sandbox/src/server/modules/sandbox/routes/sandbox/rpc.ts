import { route, routeApp } from "questpie";
import type {
	BrokerRpcResponse,
	ExecutorService,
	SandboxBroker,
} from "questpie/executor";
import { BINDINGS_TOKEN_HEADER } from "questpie/executor";

const MAX_BROKER_BODY_BYTES = 64 * 1024;
const MAX_METHOD_BYTES = 256;

type BrokerPort = Pick<SandboxBroker, "handleRpc">;

function json(body: BrokerRpcResponse, status: number): Response {
	return Response.json(body, { status });
}

function errorResponse(
	status: number,
	code: "bad_args" | "bad_method" | "execution_error",
	message: string,
): Response {
	return json({ ok: false, error: { code, message } }, status);
}

async function readBoundedJson(
	request: Request,
): Promise<{ ok: true; value: unknown } | { ok: false; response: Response }> {
	const contentLength = request.headers.get("content-length");
	if (
		contentLength !== null &&
		(!/^\d+$/.test(contentLength) ||
			Number(contentLength) > MAX_BROKER_BODY_BYTES)
	) {
		return {
			ok: false,
			response: errorResponse(
				413,
				"bad_args",
				"sandbox broker request body is too large",
			),
		};
	}
	if (!request.body) {
		return {
			ok: false,
			response: errorResponse(400, "bad_args", "invalid JSON body"),
		};
	}
	const reader = request.body.getReader();
	const chunks: Uint8Array[] = [];
	let size = 0;
	try {
		while (true) {
			const part = await reader.read();
			if (part.done) break;
			size += part.value.byteLength;
			if (size > MAX_BROKER_BODY_BYTES) {
				await reader.cancel();
				return {
					ok: false,
					response: errorResponse(
						413,
						"bad_args",
						"sandbox broker request body is too large",
					),
				};
			}
			chunks.push(part.value);
		}
	} catch {
		return {
			ok: false,
			response: errorResponse(400, "bad_args", "invalid JSON body"),
		};
	}
	const bytes = new Uint8Array(size);
	let offset = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, offset);
		offset += chunk.byteLength;
	}
	try {
		return {
			ok: true,
			value: JSON.parse(
				new TextDecoder("utf-8", { fatal: true }).decode(bytes),
			),
		};
	} catch {
		return {
			ok: false,
			response: errorResponse(400, "bad_args", "invalid JSON body"),
		};
	}
}

function parseRequestBody(
	value: unknown,
):
	| { ok: true; method: string; args: unknown }
	| { ok: false; response: Response } {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		return {
			ok: false,
			response: errorResponse(400, "bad_args", "invalid request body"),
		};
	}
	const body = value as Record<string, unknown>;
	if (Object.keys(body).some((key) => key !== "method" && key !== "args")) {
		return {
			ok: false,
			response: errorResponse(400, "bad_args", "invalid request body"),
		};
	}
	if (
		typeof body.method !== "string" ||
		body.method.length === 0 ||
		new TextEncoder().encode(body.method).byteLength > MAX_METHOD_BYTES
	) {
		return {
			ok: false,
			response: errorResponse(400, "bad_method", "invalid method"),
		};
	}
	return { ok: true, method: body.method, args: body.args };
}

export async function handleSandboxBrokerRequest(
	request: Request,
	broker: BrokerPort,
): Promise<Response> {
	const decoded = await readBoundedJson(request);
	if (!decoded.ok) return decoded.response;
	const body = parseRequestBody(decoded.value);
	if (!body.ok) return body.response;

	let result: BrokerRpcResponse;
	try {
		result = await broker.handleRpc(
			request.headers.get(BINDINGS_TOKEN_HEADER),
			body.method,
			body.args,
		);
	} catch {
		return errorResponse(
			500,
			"execution_error",
			"sandbox broker request failed",
		);
	}
	const status = result.ok
		? 200
		: result.error.code === "unauthorized"
			? 401
			: result.error.code === "forbidden"
				? 403
				: result.error.code === "not_implemented"
					? 501
					: 400;
	return json(result, status);
}

export const sandboxRpcRoute = route()
	.post()
	.raw()
	.access(true)
	.handler((ctx) => {
		const broker = (routeApp(ctx).executor as ExecutorService | undefined)
			?.broker;
		if (!broker) {
			return errorResponse(
				503,
				"execution_error",
				"sandbox broker unavailable",
			);
		}
		return handleSandboxBrokerRequest(ctx.request, broker);
	});

export default sandboxRpcRoute;
