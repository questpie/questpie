import { createRedactor } from "./redact.js";
import { withTimeout } from "./with-timeout.js";

const DEFAULT_READY_TIMEOUT_MS = 30_000;
const DEFAULT_POLL_INTERVAL_MS = 100;
const DEFAULT_REQUEST_TIMEOUT_MS = 2_000;
const DEFAULT_STOP_GRACE_MS = 5_000;
const DEFAULT_PORT_RELEASE_TIMEOUT_MS = 5_000;
const DEFAULT_MAX_LOG_LINES = 500;
const DEFAULT_MAX_LOG_LINE_CHARS = 4_096;
const DEFAULT_RESERVED_PORTS = [3_000, 6_007] as const;
const MAX_BOOT_ATTEMPTS = 3;
const ERROR_TAIL_LINES = 20;
const RESERVED_ENV_KEYS = new Set([
	"PORT",
	"APP_URL",
	"DATABASE_URL",
	"NODE_ENV",
]);

type ServerChild = ReturnType<typeof spawnChild>;

export interface ProductionServerReadinessOptions {
	/** Loopback-relative path, for example `/api/health`. */
	path: string;
	status?: number;
	timeoutMs?: number;
	pollIntervalMs?: number;
	requestTimeoutMs?: number;
}

export interface ProductionServerOptions {
	/** Caller-owned built server command. Use an absolute executable or pass PATH explicitly. */
	command: readonly [string, ...string[]];
	cwd: string;
	databaseUrl: string;
	/** Child environment built from scratch. Reserved harness keys are rejected. */
	env?: Readonly<Record<string, string>>;
	readiness: ProductionServerReadinessOptions;
	/** Exact values replaced in captured logs and rendered lifecycle errors. */
	secrets?: readonly string[];
	reservedPorts?: readonly number[];
	stopGraceMs?: number;
	portReleaseTimeoutMs?: number;
	maxLogLines?: number;
	maxLogLineChars?: number;
}

export interface ProductionServer {
	readonly port: number;
	readonly baseUrl: string;
	readonly databaseUrl: string;
	pid(): number | undefined;
	logTail(count?: number): readonly string[];
	stop(): Promise<void>;
	restart(): Promise<void>;
}

export type ProductionServerStartPhase = "spawn" | "early-exit" | "readiness";

export class ProductionServerStartError extends Error {
	constructor(
		public readonly phase: ProductionServerStartPhase,
		public readonly port: number | undefined,
		public readonly exitCode: number | null,
		public readonly logTail: readonly string[],
		cause?: unknown,
	) {
		const target = port === undefined ? "" : ` on port ${port}`;
		const detail =
			phase === "early-exit"
				? `Server${target} exited with code ${exitCode} before readiness`
				: phase === "readiness"
					? `Server${target} did not become ready before the timeout`
					: "Server process could not be spawned";
		const logs = logTail.length > 0 ? `\n${logTail.join("\n")}` : "";
		super(
			`${detail}. Verify the built server command, readiness path, and explicit child environment.${logs}`,
			{ cause },
		);
		this.name = "ProductionServerStartError";
	}
}

export class ProductionServerStopError extends Error {
	constructor(public readonly errors: readonly unknown[]) {
		super(`Failed to stop ${errors.length} production server resource(s)`);
		this.name = "ProductionServerStopError";
	}
}

interface LogSink {
	readonly maxLineChars: number;
	push(tag: "stdout" | "stderr", line: string): void;
	tail(count?: number): readonly string[];
}

interface BootedChild {
	child: ServerChild;
	drains: readonly Promise<void>[];
}

const liveChildren = new Set<ServerChild>();
let exitHookInstalled = false;

export async function startProductionServer(
	options: ProductionServerOptions,
): Promise<ProductionServer> {
	validateOptions(options);
	const readyTimeoutMs = positive(
		options.readiness.timeoutMs ?? DEFAULT_READY_TIMEOUT_MS,
		"readiness.timeoutMs",
	);
	const pollIntervalMs = positive(
		options.readiness.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS,
		"readiness.pollIntervalMs",
	);
	const requestTimeoutMs = positive(
		options.readiness.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
		"readiness.requestTimeoutMs",
	);
	const stopGraceMs = positive(
		options.stopGraceMs ?? DEFAULT_STOP_GRACE_MS,
		"stopGraceMs",
	);
	const portReleaseTimeoutMs = positive(
		options.portReleaseTimeoutMs ?? DEFAULT_PORT_RELEASE_TIMEOUT_MS,
		"portReleaseTimeoutMs",
	);
	const sink = createLogSink(
		collectSecrets(options),
		positive(options.maxLogLines ?? DEFAULT_MAX_LOG_LINES, "maxLogLines"),
		positive(
			options.maxLogLineChars ?? DEFAULT_MAX_LOG_LINE_CHARS,
			"maxLogLineChars",
		),
	);
	const reservedPorts = new Set([
		...DEFAULT_RESERVED_PORTS,
		...(options.reservedPorts ?? []),
	]);

	const boot = async (
		fixedPort?: number,
	): Promise<BootedChild & { port: number }> => {
		for (let attempt = 1; attempt <= MAX_BOOT_ATTEMPTS; attempt += 1) {
			const port = fixedPort ?? allocatePort(reservedPorts);
			let booted: BootedChild;
			try {
				booted = bootChild(options, port, sink);
			} catch (cause) {
				throw new ProductionServerStartError(
					"spawn",
					port,
					null,
					sink.tail(),
					cause,
				);
			}

			const outcome = await awaitReadiness({
				booted,
				port,
				path: options.readiness.path,
				status: options.readiness.status ?? 200,
				readyTimeoutMs,
				pollIntervalMs,
				requestTimeoutMs,
			});
			if (outcome.kind === "ready") return { ...booted, port };

			await killFailedBoot(booted, port, portReleaseTimeoutMs);
			const logTail = sink.tail();
			const retryable =
				fixedPort === undefined &&
				outcome.kind === "early-exit" &&
				logTail.some((line) => line.includes("EADDRINUSE")) &&
				attempt < MAX_BOOT_ATTEMPTS;
			if (retryable) continue;
			if (outcome.kind === "early-exit") {
				throw new ProductionServerStartError(
					"early-exit",
					port,
					outcome.exitCode,
					logTail,
				);
			}
			throw new ProductionServerStartError("readiness", port, null, logTail);
		}
		throw new ProductionServerStartError("spawn", undefined, null, sink.tail());
	};

	const first = await boot();
	const port = first.port;
	const baseUrl = `http://127.0.0.1:${port}`;
	let current: BootedChild = first;
	let running = true;
	let stopPromise: Promise<void> | undefined;
	let restartPromise: Promise<void> | undefined;

	const stop = (): Promise<void> => {
		stopPromise ??= (async () => {
			if (!running) return;
			running = false;
			await stopChild(current, port, stopGraceMs, portReleaseTimeoutMs);
		})();
		return stopPromise;
	};

	const restart = (): Promise<void> => {
		restartPromise ??= (async () => {
			await stop();
			const next = await boot(port);
			current = next;
			running = true;
			stopPromise = undefined;
		})().finally(() => {
			restartPromise = undefined;
		});
		return restartPromise;
	};

	return {
		port,
		baseUrl,
		databaseUrl: options.databaseUrl,
		pid: () => (running ? current.child.pid : undefined),
		logTail: (count) => sink.tail(count),
		stop,
		restart,
	};
}

function validateOptions(options: ProductionServerOptions): void {
	if (options.command.length === 0 || options.command.some((part) => !part)) {
		throw new TypeError(
			"command must contain a non-empty executable and arguments",
		);
	}
	if (!options.cwd) throw new TypeError("cwd is required");
	if (!options.databaseUrl) throw new TypeError("databaseUrl is required");
	if (
		!options.readiness.path.startsWith("/") ||
		options.readiness.path.startsWith("//")
	) {
		throw new TypeError("readiness.path must be a loopback-relative path");
	}
	for (const key of Object.keys(options.env ?? {})) {
		if (RESERVED_ENV_KEYS.has(key)) {
			throw new TypeError(`${key} is managed by the production server harness`);
		}
	}
	for (const port of options.reservedPorts ?? []) {
		if (!Number.isInteger(port) || port < 1 || port > 65_535) {
			throw new TypeError("reservedPorts must contain valid TCP ports");
		}
	}
	const status = options.readiness.status ?? 200;
	if (!Number.isInteger(status) || status < 100 || status > 599) {
		throw new TypeError("readiness.status must be a valid HTTP status");
	}
}

function positive(value: number, label: string): number {
	if (!Number.isFinite(value) || value <= 0) {
		throw new TypeError(`${label} must be a positive finite number`);
	}
	return value;
}

function collectSecrets(options: ProductionServerOptions): string[] {
	const values = new Set(
		[options.databaseUrl, ...(options.secrets ?? [])].filter(Boolean),
	);
	try {
		const url = new URL(options.databaseUrl);
		if (url.password) {
			values.add(url.password);
			try {
				values.add(decodeURIComponent(url.password));
			} catch {
				// The raw password and full URL are already covered.
			}
		}
	} catch {
		// A non-URL adapter value is still redacted as a whole.
	}
	return [...values].sort((left, right) => right.length - left.length);
}

function createLogSink(
	secrets: readonly string[],
	maxLines: number,
	maxLineChars: number,
): LogSink {
	const ring: string[] = [];
	const redact = createRedactor(secrets);
	return {
		maxLineChars,
		push(tag, line) {
			const bounded = line.slice(-maxLineChars);
			ring.push(`[${tag}] ${redact(bounded)}`);
			if (ring.length > maxLines) ring.splice(0, ring.length - maxLines);
		},
		tail(count = ERROR_TAIL_LINES) {
			return ring.slice(-Math.max(0, count));
		},
	};
}

function allocatePort(reserved: ReadonlySet<number>): number {
	for (let attempt = 0; attempt < 25; attempt += 1) {
		const probe = Bun.listen({
			hostname: "127.0.0.1",
			port: 0,
			socket: { data() {} },
		});
		const port = probe.port;
		probe.stop(true);
		if (!reserved.has(port)) return port;
	}
	throw new Error("Could not allocate a non-reserved loopback port");
}

function bootChild(
	options: ProductionServerOptions,
	port: number,
	sink: LogSink,
): BootedChild {
	installExitHook();
	const child = spawnChild(options, port);
	liveChildren.add(child);
	const drains = [
		teeStream(child.stdout, "stdout", sink),
		teeStream(child.stderr, "stderr", sink),
	];
	void child.exited.finally(() => liveChildren.delete(child));
	return { child, drains };
}

function spawnChild(options: ProductionServerOptions, port: number) {
	const baseUrl = `http://127.0.0.1:${port}`;
	return Bun.spawn([...options.command], {
		cwd: options.cwd,
		env: {
			...(options.env ?? {}),
			NODE_ENV: "production",
			PORT: String(port),
			APP_URL: baseUrl,
			DATABASE_URL: options.databaseUrl,
		},
		stdout: "pipe",
		stderr: "pipe",
	});
}

function installExitHook(): void {
	if (exitHookInstalled) return;
	exitHookInstalled = true;
	process.on("exit", () => {
		for (const child of liveChildren) {
			try {
				child.kill("SIGKILL");
			} catch {
				// Best-effort crash cleanup; the child may already be gone.
			}
		}
	});
}

async function teeStream(
	stream: ReadableStream<Uint8Array>,
	tag: "stdout" | "stderr",
	sink: LogSink,
): Promise<void> {
	const decoder = new TextDecoder();
	let pending = "";
	for await (const chunk of stream) {
		pending += decoder.decode(chunk, { stream: true });
		const lines = pending.split("\n");
		pending = lines.pop() ?? "";
		for (const line of lines) sink.push(tag, line);
		if (pending.length > sink.maxLineChars * 2) {
			pending = pending.slice(-sink.maxLineChars);
		}
	}
	pending += decoder.decode();
	if (pending) sink.push(tag, pending);
}

async function awaitReadiness(input: {
	booted: BootedChild;
	port: number;
	path: string;
	status: number;
	readyTimeoutMs: number;
	pollIntervalMs: number;
	requestTimeoutMs: number;
}): Promise<
	| { kind: "ready" }
	| { kind: "early-exit"; exitCode: number | null }
	| { kind: "timeout" }
> {
	let exited = false;
	let exitCode: number | null = null;
	void input.booted.child.exited.then((code) => {
		exited = true;
		exitCode = code;
	});
	const deadline = Date.now() + input.readyTimeoutMs;
	while (Date.now() < deadline) {
		if (exited) return { kind: "early-exit", exitCode };
		try {
			const response = await fetch(
				`http://127.0.0.1:${input.port}${input.path}`,
				{ signal: AbortSignal.timeout(input.requestTimeoutMs) },
			);
			await response.arrayBuffer();
			if (response.status === input.status) return { kind: "ready" };
		} catch {
			// The process is still starting or not yet listening.
		}
		await Bun.sleep(input.pollIntervalMs);
	}
	if (exited) return { kind: "early-exit", exitCode };
	return { kind: "timeout" };
}

async function killFailedBoot(
	booted: BootedChild,
	port: number,
	portReleaseTimeoutMs: number,
): Promise<void> {
	try {
		booted.child.kill("SIGKILL");
	} catch {
		// Already exited.
	}
	await withTimeout(
		Promise.allSettled([booted.child.exited, ...booted.drains]),
		portReleaseTimeoutMs,
		"failed server process cleanup",
	);
	await waitForPortRelease(port, portReleaseTimeoutMs);
}

async function stopChild(
	booted: BootedChild,
	port: number,
	graceMs: number,
	portReleaseTimeoutMs: number,
): Promise<void> {
	const errors: unknown[] = [];
	try {
		booted.child.kill("SIGTERM");
	} catch {
		// Already exited; the exit promise remains authoritative.
	}
	const exitedGracefully = await settlesWithin(booted.child.exited, graceMs);
	if (!exitedGracefully) {
		try {
			booted.child.kill("SIGKILL");
		} catch {
			// Already exited between the grace timeout and escalation.
		}
	}
	try {
		await withTimeout(
			booted.child.exited,
			portReleaseTimeoutMs,
			"server process exit",
		);
	} catch (error) {
		errors.push(error);
	}
	try {
		await withTimeout(
			Promise.allSettled(booted.drains),
			portReleaseTimeoutMs,
			"server log drain",
		);
	} catch (error) {
		errors.push(error);
	}
	try {
		await waitForPortRelease(port, portReleaseTimeoutMs);
	} catch (error) {
		errors.push(error);
	}
	if (errors.length > 0) throw new ProductionServerStopError(errors);
}

async function settlesWithin(promise: Promise<unknown>, timeoutMs: number) {
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		return await Promise.race([
			promise.then(() => true),
			new Promise<false>((resolve) => {
				timer = setTimeout(() => resolve(false), timeoutMs);
			}),
		]);
	} finally {
		if (timer) clearTimeout(timer);
	}
}

async function waitForPortRelease(
	port: number,
	timeoutMs: number,
): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (await isTcpRefused(port)) {
			try {
				const probe = Bun.listen({
					hostname: "127.0.0.1",
					port,
					socket: { data() {} },
				});
				probe.stop(true);
				return;
			} catch {
				// The kernel has not released the bind yet.
			}
		}
		await Bun.sleep(20);
	}
	throw new Error(`Port ${port} was not released after ${timeoutMs}ms`);
}

async function isTcpRefused(port: number): Promise<boolean> {
	try {
		const socket = await Bun.connect({
			hostname: "127.0.0.1",
			port,
			socket: { data() {} },
		});
		socket.end();
		return false;
	} catch {
		return true;
	}
}
