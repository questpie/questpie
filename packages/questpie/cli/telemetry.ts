import { pathToFileURL } from "node:url";

export type RequestedTelemetry = "opentelemetry" | null;
export type LoadedTelemetry = Readonly<{
	observability: unknown;
	close(): Promise<void>;
}>;

function unavailable(): never {
	throw new TypeError("QP-START-004 telemetryUnavailable");
}

function invalidConfiguration(path: string): never {
	throw new TypeError(`QP-START-004 telemetryInvalidConfiguration: ${path}`);
}

export function requestedTelemetry(
	arguments_: readonly string[],
): RequestedTelemetry {
	const telemetry = arguments_.filter((argument) =>
		argument.startsWith("--telemetry"),
	);
	if (telemetry.length === 0) return null;
	if (telemetry.length !== 1 || telemetry[0] !== "--telemetry=opentelemetry")
		return unavailable();
	return "opentelemetry";
}

function invalidConfigurationPath(error: unknown): string | null {
	let message: unknown;
	try {
		message = (error as Readonly<{ message?: unknown }> | null)?.message;
	} catch {
		return null;
	}
	if (typeof message !== "string") return null;
	const match =
		/^QP-OTEL-001 invalidConfiguration: ((?:input(?:\.[A-Za-z0-9_]+)+)|(?:environment\.OTEL_[A-Z0-9_]+))$/u.exec(
			message,
		);
	return match?.[1] ?? null;
}

export async function loadOpenTelemetry(
	applicationRoot: string,
): Promise<LoadedTelemetry> {
	let create: unknown;
	try {
		const entry = Bun.resolveSync("@questpie/opentelemetry", applicationRoot);
		const module = (await import(
			`${pathToFileURL(entry).href}?questpie-start=${crypto.randomUUID()}`
		)) as Readonly<{ createOpenTelemetry?: unknown }>;
		create = module.createOpenTelemetry;
	} catch {
		return unavailable();
	}
	if (typeof create !== "function") return unavailable();
	let observability: unknown;
	try {
		observability = await Reflect.apply(create, undefined, []);
	} catch (error) {
		const path = invalidConfigurationPath(error);
		if (path !== null) return invalidConfiguration(path);
		return unavailable();
	}
	let close: unknown;
	try {
		close = (observability as Readonly<{ close?: unknown }> | null)?.close;
	} catch {
		return unavailable();
	}
	if (typeof close !== "function") return unavailable();
	return Object.freeze({
		observability,
		close: async () => {
			await Reflect.apply(close, observability, []);
		},
	});
}

export async function createTelemetryApplication<Application>(
	telemetry: LoadedTelemetry,
	create: (observability: unknown) => Promise<Application>,
): Promise<Application> {
	try {
		return await create(telemetry.observability);
	} catch (error) {
		let incompatible = false;
		try {
			incompatible =
				error instanceof TypeError &&
				error.message === "Runtime observation handle is incompatible";
		} catch {
			// A hostile thrown value is an App creation failure, not adapter evidence.
		}
		try {
			await telemetry.close();
		} catch {
			// App creation remains the primary startup failure.
		}
		if (incompatible) return unavailable();
		throw error;
	}
}

type Closeable = Readonly<{ close(): Promise<void> }>;

export function createStartShutdown(
	input: Readonly<{
		application: Closeable;
		stopIngress(): void;
		telemetry: LoadedTelemetry | null;
	}>,
): () => Promise<void> {
	let closing: Promise<void> | undefined;
	return () => {
		closing ??= (async () => {
			let failed = false;
			let failure: unknown;
			try {
				input.stopIngress();
			} catch (error) {
				failed = true;
				failure = error;
			}
			try {
				await input.application.close();
			} catch (error) {
				if (!failed) {
					failed = true;
					failure = error;
				}
			}
			try {
				await input.telemetry?.close();
			} catch (error) {
				if (!failed) {
					failed = true;
					failure = error;
				}
			}
			if (failed) throw failure;
		})();
		return closing;
	};
}
