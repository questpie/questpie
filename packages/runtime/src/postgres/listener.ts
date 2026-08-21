import { Client } from "pg";

import { QuestpiePostgresError, type PostgresDatabase } from "./contract";
import { postgresFailure } from "./errors";

const channelBrand: unique symbol = Symbol("questpie.postgres.channel");

export type PostgresChannel = string & { readonly [channelBrand]: true };

export type PostgresReconcileReason =
	| "startup"
	| "notification"
	| "reconnect"
	| "periodic";

export interface PostgresListener {
	facts(): Readonly<{
		state: "starting" | "healthy" | "degraded" | "closing" | "closed";
		generation: number;
		reconnects: number;
		lastReconciledAt: number | null;
	}>;
	requestReconcile(): void;
	close(input: Readonly<{ deadlineAt: number }>): Promise<void>;
}

export function definePostgresChannel(name: string): PostgresChannel {
	if (!/^[a-z][a-z0-9_]{0,62}$/u.test(name))
		throw new TypeError("invalid PostgreSQL listener channel");
	return name as PostgresChannel;
}

export async function createPostgresListener(
	input: Readonly<{
		directConnectionUrl: string;
		channel: PostgresChannel;
		database: PostgresDatabase;
		fallbackIntervalMs: number;
		reconcile(
			input: Readonly<{
				reason: PostgresReconcileReason;
				database: PostgresDatabase;
				signal: AbortSignal;
			}>,
		): Promise<void>;
	}>,
): Promise<PostgresListener> {
	if (
		typeof input.directConnectionUrl !== "string" ||
		input.directConnectionUrl.length === 0 ||
		!Number.isSafeInteger(input.fallbackIntervalMs) ||
		input.fallbackIntervalMs <= 0
	)
		throw new QuestpiePostgresError({
			code: "configuration",
			phase: "connect",
		});
	try {
		const url = new URL(input.directConnectionUrl);
		if (url.protocol !== "postgres:" && url.protocol !== "postgresql:")
			throw new TypeError("invalid PostgreSQL listener protocol");
	} catch (error) {
		throw new QuestpiePostgresError({
			code: "configuration",
			phase: "connect",
			cause: error,
		});
	}

	let state: "starting" | "healthy" | "degraded" | "closing" | "closed" =
		"starting";
	let generation = 0;
	let reconnects = 0;
	let lastReconciledAt: number | null = null;
	let client: Client | undefined;
	let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
	let reconnectAttempt = 0;
	let establishingClient: Client | undefined;
	let inFlight: Promise<void> | undefined;
	let queuedReason: PostgresReconcileReason | undefined;
	const controller = new AbortController();
	const stopped = (): boolean => state === "closing" || state === "closed";

	const reconcile = (reason: PostgresReconcileReason): Promise<void> => {
		if (stopped()) return Promise.resolve();
		if (inFlight) {
			queuedReason = reason;
			return inFlight;
		}
		const run = (async () => {
			let next: PostgresReconcileReason | undefined = reason;
			while (next && !stopped()) {
				queuedReason = undefined;
				await input.reconcile({
					reason: next,
					database: input.database,
					signal: controller.signal,
				});
				lastReconciledAt = Date.now();
				next = queuedReason;
			}
		})();
		inFlight = run.finally(() => {
			inFlight = undefined;
		});
		return inFlight;
	};

	const scheduleReconnect = (): void => {
		if (state === "closing" || state === "closed" || reconnectTimer) return;
		state = "degraded";
		const delay = Math.min(1_000, 25 * 2 ** Math.min(reconnectAttempt, 5));
		reconnectAttempt += 1;
		reconnectTimer = setTimeout(
			() => {
				reconnectTimer = undefined;
				void establish("reconnect").catch(scheduleReconnect);
			},
			Math.floor(Math.random() * delay),
		);
		reconnectTimer.unref?.();
	};

	const establish = async (reason: "startup" | "reconnect"): Promise<void> => {
		if (state === "closing" || state === "closed") return;
		let candidate: Client;
		try {
			candidate = new Client({
				connectionString: input.directConnectionUrl,
				application_name: "questpie-realtime-listener",
				connectionTimeoutMillis: 1_000,
			});
		} catch (error) {
			throw postgresFailure({ error, phase: "connect" });
		}
		establishingClient = candidate;
		let lost = false;
		let failurePhase: "connect" | "listen" | "reconcile" = "connect";
		const connectionLost = (): void => {
			if (lost) return;
			lost = true;
			if (client === candidate) client = undefined;
			scheduleReconnect();
		};
		candidate.on("error", connectionLost);
		candidate.on("end", connectionLost);
		candidate.on("notification", () => {
			void reconcile("notification").catch(() => {});
		});
		try {
			await candidate.connect();
			if (stopped()) throw controller.signal.reason;
			failurePhase = "listen";
			await candidate.query("BEGIN");
			await candidate.query(`LISTEN "${input.channel}"`);
			await candidate.query("COMMIT");
			if (stopped()) throw controller.signal.reason;
			client = candidate;
			establishingClient = undefined;
			generation += 1;
			if (reason === "reconnect") reconnects += 1;
			failurePhase = "reconcile";
			await reconcile(reason);
			if (stopped()) throw controller.signal.reason;
			reconnectAttempt = 0;
			state = "healthy";
		} catch (error) {
			if (client === candidate) client = undefined;
			if (establishingClient === candidate) establishingClient = undefined;
			if (!lost) await candidate.end().catch(() => {});
			throw postgresFailure({
				error,
				phase: failurePhase,
				signal: controller.signal,
				overridePhase: failurePhase === "reconcile",
			});
		}
	};

	const periodic = setInterval(() => {
		void reconcile("periodic").catch(() => {});
	}, input.fallbackIntervalMs);
	periodic.unref?.();

	try {
		await establish("startup");
	} catch (error) {
		clearInterval(periodic);
		state = "closed";
		throw error;
	}

	return Object.freeze({
		facts() {
			return Object.freeze({ state, generation, reconnects, lastReconciledAt });
		},
		requestReconcile() {
			void reconcile("notification").catch(() => {});
		},
		async close(closeInput: Readonly<{ deadlineAt: number }>) {
			if (state === "closed") return;
			state = "closing";
			controller.abort(
				new DOMException("PostgreSQL listener stopped", "AbortError"),
			);
			clearInterval(periodic);
			if (reconnectTimer) clearTimeout(reconnectTimer);
			const activeClient = client;
			const startingClient = establishingClient;
			client = undefined;
			establishingClient = undefined;
			const remaining = Math.max(0, closeInput.deadlineAt - Date.now());
			let timer: ReturnType<typeof setTimeout> | undefined;
			try {
				await Promise.race([
					Promise.allSettled([
						inFlight,
						activeClient?.end(),
						startingClient?.end(),
					]),
					new Promise<void>((resolve) => {
						timer = setTimeout(resolve, remaining);
					}),
				]);
			} finally {
				if (timer) clearTimeout(timer);
				state = "closed";
			}
		},
	});
}
