import { route, routeApp } from "questpie";
import type {
	BindingErrorCode,
	BrokerRpcResponse,
	ExecutorService,
	SandboxBroker,
} from "questpie/executor";
import {
	BINDINGS_TOKEN_HEADER,
	snapshotBoundedBrokerValue,
} from "questpie/executor";

import {
	BROKER_MAX_REQUEST_WIRE_BYTES,
	brokerRequestWireCap,
	brokerResultValueCap,
	brokerResponseWireCap,
} from "../../../../../broker-wire.js";
import {
	handleSandboxCustomToolsRpc,
	type SandboxCustomToolsConfig,
} from "../../../../../custom-tools.js";

const MAX_METHOD_BYTES = 256;
const BINDING_ERROR_CODES = new Set<BindingErrorCode>([
	"bad_method",
	"bad_args",
	"unauthorized",
	"forbidden",
	"not_implemented",
	"execution_error",
]);

type BrokerPort = Pick<SandboxBroker, "handleRpc">;

function json(body: BrokerRpcResponse, status: number): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json" },
	});
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
): Promise<
	| { ok: true; value: unknown; bytes: number }
	| { ok: false; response: Response }
> {
	const contentLength = request.headers.get("content-length");
	if (
		contentLength !== null &&
		(!/^\d+$/.test(contentLength) ||
			Number(contentLength) > BROKER_MAX_REQUEST_WIRE_BYTES)
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
			if (size > BROKER_MAX_REQUEST_WIRE_BYTES) {
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
			bytes: size,
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

function invalidBrokerResult(): BrokerRpcResponse {
	return {
		ok: false,
		error: {
			code: "execution_error",
			message: "sandbox broker returned an invalid result",
			correlationId: crypto.randomUUID(),
		},
	};
}

function normalizeBrokerResult(
	method: string,
	value: unknown,
): BrokerRpcResponse | null {
	const maximumBytes = brokerResponseWireCap(method);
	const bounded = snapshotBoundedBrokerValue(value, maximumBytes);
	if (!bounded.ok || !bounded.value || Array.isArray(bounded.value))
		return null;
	const result = bounded.value as Record<string, unknown>;
	const resultKeys = Object.keys(result);
	if (result.ok === true) {
		if (
			resultKeys.length !== 2 ||
			!resultKeys.includes("ok") ||
			!resultKeys.includes("value")
		) {
			return null;
		}
		const normalizedValue = snapshotBoundedBrokerValue(
			result.value,
			brokerResultValueCap(method),
		);
		if (!normalizedValue.ok) return null;
		return { ok: true, value: normalizedValue.value };
	}
	if (
		result.ok !== false ||
		resultKeys.length !== 2 ||
		!resultKeys.includes("error") ||
		!result.error ||
		typeof result.error !== "object" ||
		Array.isArray(result.error)
	) {
		return null;
	}
	const error = result.error as Record<string, unknown>;
	const errorKeys = Object.keys(error);
	if (
		!errorKeys.every((key) =>
			["code", "message", "correlationId"].includes(key),
		) ||
		!errorKeys.includes("code") ||
		!errorKeys.includes("message") ||
		typeof error.code !== "string" ||
		!BINDING_ERROR_CODES.has(error.code as BindingErrorCode) ||
		typeof error.message !== "string" ||
		(error.correlationId !== undefined &&
			typeof error.correlationId !== "string")
	) {
		return null;
	}
	const correlationId =
		typeof error.correlationId === "string" &&
		/^[\w-]{1,128}$/.test(error.correlationId)
			? error.correlationId
			: undefined;
	if (error.code === "execution_error") {
		return {
			ok: false,
			error: {
				code: "execution_error",
				message: "sandbox binding operation failed",
				correlationId: correlationId ?? crypto.randomUUID(),
			},
		};
	}
	return {
		ok: false,
		error: {
			code: error.code as BindingErrorCode,
			message: error.message,
			...(correlationId ? { correlationId } : {}),
		},
	};
}

export async function handleSandboxBrokerRequest(
	request: Request,
	broker: BrokerPort,
	customTools?: {
		app: ReturnType<typeof routeApp>;
		config: SandboxCustomToolsConfig | undefined;
	},
): Promise<Response> {
	const decoded = await readBoundedJson(request);
	if (!decoded.ok) return decoded.response;
	const body = parseRequestBody(decoded.value);
	if (!body.ok) return body.response;
	if (decoded.bytes > brokerRequestWireCap(body.method)) {
		return errorResponse(
			413,
			"bad_args",
			"sandbox broker request body is too large",
		);
	}

	let result: BrokerRpcResponse;
	try {
		result = body.method.startsWith("tools.")
			? await handleSandboxCustomToolsRpc({
					app: customTools?.app as never,
					config: customTools?.config,
					token: request.headers.get(BINDINGS_TOKEN_HEADER),
					requestUrl: request.url,
					method: body.method,
					args: body.args,
					signal: request.signal,
				})
			: await broker.handleRpc(
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
	result = normalizeBrokerResult(body.method, result) ?? invalidBrokerResult();
	const status = result.ok
		? 200
		: result.error.code === "unauthorized"
			? 401
			: result.error.code === "forbidden"
				? 403
				: result.error.code === "not_implemented"
					? 501
					: result.error.code === "execution_error"
						? 500
						: 400;
	return json(result, status);
}

export const sandboxRpcRoute = route()
	.post()
	.raw()
	.access(true)
	.handler((ctx) => {
		const app = routeApp(ctx);
		const broker = (app.executor as ExecutorService | undefined)?.broker;
		if (!broker) {
			return errorResponse(
				503,
				"execution_error",
				"sandbox broker unavailable",
			);
		}
		return handleSandboxBrokerRequest(ctx.request, broker, {
			app,
			config: (
				app.state as {
					sandboxCustomTools?: SandboxCustomToolsConfig;
				}
			).sandboxCustomTools,
		});
	});

export default sandboxRpcRoute;
