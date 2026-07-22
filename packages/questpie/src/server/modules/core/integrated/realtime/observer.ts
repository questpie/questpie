import type { LoggerAdapter } from "#questpie/server/modules/core/integrated/logger/types.js";

import type { ClientCloseReason, DeliveryClass } from "./transport.js";

export type RealtimeObservation =
	| {
			type: "broker.lifecycle";
			state:
				| "connecting"
				| "connected"
				| "unavailable"
				| "failed"
				| "disconnected";
	  }
	| {
			type: "broker.publish";
			seam: "v2";
			outcome: "accepted" | "failed";
	  }
	| { type: "outbox.capture"; outcome: "accepted" | "failed" }
	| {
			type: "drain.completed";
			reason: "broker" | "poll" | "reconnect" | "startup";
			rows: number;
			seqDelta: number;
			lagMs: number;
			durationMs: number;
			healed: boolean;
	  }
	| {
			type: "drain.failed";
			reason: "broker" | "poll" | "reconnect" | "startup";
	  }
	| {
			type: "refresh.started";
			operation: "find" | "count" | "get";
			subscribers: number;
	  }
	| {
			type: "refresh.completed";
			operation: "find" | "count" | "get";
			subscribers: number;
			durationMs: number;
			frameBytes: number;
	  }
	| {
			type: "refresh.suppressed";
			operation: "find" | "count" | "get";
			subscribers: number;
	  }
	| {
			type: "refresh.failed";
			operation: "find" | "count" | "get";
			subscribers: number;
	  }
	| {
			type: "delta.emitted";
			operation: "insert" | "update" | "delete" | "up-to-date" | "snapshot";
			subscribers: number;
			frameBytes: number;
	  }
	| {
			type: "delta.suppressed";
			reason: "unchanged" | "noop";
	  }
	| {
			type: "delta.fallback_snapshot";
			reason:
				| "queue_overflow"
				| "row_cap"
				| "bulk_budget"
				| "dependency_change"
				| "processing_error"
				| "periodic";
	  }
	| {
			type: "delta.buffer";
			scope: "group" | "subscriber" | "writer";
			key: string;
			events: number;
			bytes: number;
	  }
	| {
			type: "sink.write";
			delivery: DeliveryClass;
			outcome: "accepted" | "busy" | "failed";
			bufferedBytes: number;
	  }
	| { type: "session.opened"; transport: "sse" | "shared-provider" }
	| {
			type: "session.closed";
			transport: "sse" | "shared-provider";
			reason: ClientCloseReason;
	  }
	| {
			type: "admission.rejected";
			reason:
				| "connection_limit"
				| "subscription_limit"
				| "query_limit"
				| "relation_depth"
				| "snapshot_bytes"
				| "access";
			resource?: string;
			operation?: "find" | "count" | "get";
			requestedLimit?: number;
			configuredLimit?: number;
			rolloutMode?: "v2";
	  }
	| {
			type: "topology.lifecycle";
			phase: "open" | "submit" | "reconcile" | "apply" | "lease" | "close";
			outcome:
				| "accepted"
				| "duplicate"
				| "stale"
				| "conflict"
				| "unsupported"
				| "invalid"
				| "unavailable"
				| "started"
				| "applied"
				| "failed"
				| "expired"
				| "fenced"
				| "closed";
			desiredRevision?: number;
			appliedRevision?: number;
	  }
	| {
			type: "resume";
			outcome: "replay" | "reset" | "current" | "gap" | "dedupe";
	  }
	| {
			type: "channel.security";
			verb:
				| "subscribe"
				| "publish"
				| "presence"
				| "origin"
				| "grant"
				| "revoke";
			outcome: "allowed" | "denied";
			reason: ChannelSecurityObservationReason;
	  };

export type ChannelSecurityObservationReason =
	| "allowed"
	| "access_denied"
	| "origin_denied"
	| "name_invalid"
	| "rate_limited"
	| "payload_invalid"
	| "presence_invalid"
	| "transport_unavailable"
	| "request_invalid"
	| "revoked"
	| "unknown";

export interface RealtimeObserver {
	record(event: RealtimeObservation): void;
}

export type RealtimeMetricsSnapshot = Readonly<{
	counters: Readonly<Record<string, number>>;
	gauges: Readonly<{
		activeSessions: number;
		bufferedBytes: number;
		deltaBufferedEvents: number;
		deltaBufferedBytes: number;
	}>;
}>;

type ObservationLogger = Pick<LoggerAdapter, "error" | "warn">;

type RealtimeObservabilityOptions = {
	observer?: RealtimeObserver;
	logger?: ObservationLogger;
	drainLagAlertMs?: number;
};

function metricKey(event: RealtimeObservation): string {
	switch (event.type) {
		case "broker.lifecycle":
			return `${event.type}|state=${event.state}`;
		case "broker.publish":
			return `${event.type}|outcome=${event.outcome}|seam=${event.seam}`;
		case "outbox.capture":
			return `${event.type}|outcome=${event.outcome}`;
		case "drain.completed":
			return `${event.type}|healed=${event.healed}|reason=${event.reason}`;
		case "drain.failed":
			return `${event.type}|reason=${event.reason}`;
		case "refresh.started":
		case "refresh.completed":
		case "refresh.suppressed":
		case "refresh.failed":
			return `${event.type}|operation=${event.operation}`;
		case "delta.emitted":
			return `${event.type}|operation=${event.operation}`;
		case "delta.suppressed":
			return `${event.type}|reason=${event.reason}`;
		case "delta.fallback_snapshot":
			return `${event.type}|reason=${event.reason}`;
		case "delta.buffer":
			return `${event.type}|scope=${event.scope}`;
		case "sink.write":
			return `${event.type}|delivery=${event.delivery}|outcome=${event.outcome}`;
		case "session.opened":
			return `${event.type}|transport=${event.transport}`;
		case "session.closed":
			return `${event.type}|reason=${event.reason}|transport=${event.transport}`;
		case "admission.rejected":
			return `${event.type}|reason=${event.reason}|resource=${event.resource ?? "unknown"}|rollout_mode=${event.rolloutMode ?? "v2"}`;
		case "topology.lifecycle":
			return `${event.type}|outcome=${event.outcome}|phase=${event.phase}`;
		case "resume":
			return `${event.type}|outcome=${event.outcome}`;
		case "channel.security":
			return `${event.type}|outcome=${event.outcome}|reason=${event.reason}|verb=${event.verb}`;
	}
}

function alertLevel(
	event: RealtimeObservation,
	drainLagAlertMs: number,
): "error" | "warn" | null {
	if (
		(event.type === "broker.publish" && event.outcome === "failed") ||
		(event.type === "outbox.capture" && event.outcome === "failed") ||
		event.type === "drain.failed" ||
		event.type === "refresh.failed" ||
		(event.type === "sink.write" && event.outcome === "failed") ||
		(event.type === "topology.lifecycle" && event.outcome === "failed")
	) {
		return "error";
	}
	if (
		event.type === "admission.rejected" ||
		(event.type === "topology.lifecycle" &&
			(event.outcome === "conflict" ||
				event.outcome === "unsupported" ||
				event.outcome === "invalid" ||
				event.outcome === "unavailable" ||
				event.outcome === "expired" ||
				event.outcome === "fenced")) ||
		(event.type === "channel.security" && event.outcome === "denied") ||
		(event.type === "session.closed" && event.reason !== "normal") ||
		(event.type === "drain.completed" && event.lagMs > drainLagAlertMs)
	) {
		return "warn";
	}
	return null;
}

/** Non-throwing observation fan-out plus stable in-memory metric primitives. */
export class RealtimeObservability implements RealtimeObserver {
	private readonly counters = new Map<string, number>();
	private activeSessions = 0;
	private bufferedBytes = 0;
	private readonly deltaBuffers = new Map<
		string,
		{ events: number; bytes: number }
	>();

	constructor(private readonly options: RealtimeObservabilityOptions = {}) {}

	private increment(key: string, value = 1): void {
		this.counters.set(key, (this.counters.get(key) ?? 0) + value);
	}

	record(event: RealtimeObservation): void {
		const key = metricKey(event);
		this.increment(key);
		if (event.type === "drain.completed") {
			this.increment(`drain.rows|reason=${event.reason}`, event.rows);
			this.increment(`drain.seq_delta|reason=${event.reason}`, event.seqDelta);
			if (event.healed) this.increment("drain.poll_healing");
		}
		if (event.type === "refresh.completed") {
			this.increment(
				`refresh.subscriber_deliveries|operation=${event.operation}`,
				event.subscribers,
			);
		}
		if (event.type === "session.opened") this.activeSessions += 1;
		if (event.type === "session.closed") {
			this.activeSessions = Math.max(0, this.activeSessions - 1);
		}
		if (event.type === "sink.write") {
			this.bufferedBytes = Math.max(0, event.bufferedBytes);
		}
		if (event.type === "delta.buffer") {
			if (event.events === 0 && event.bytes === 0) {
				this.deltaBuffers.delete(event.key);
			} else {
				this.deltaBuffers.set(event.key, {
					events: Math.max(0, event.events),
					bytes: Math.max(0, event.bytes),
				});
			}
		}

		try {
			this.options.observer?.record(event);
		} catch {
			// An observer is diagnostic-only and cannot break realtime delivery.
		}

		const level = alertLevel(
			event,
			this.options.drainLagAlertMs ?? Number.POSITIVE_INFINITY,
		);
		if (!level) return;
		try {
			this.options.logger?.[level]("[Realtime] observation", {
				realtime: event,
			});
		} catch {
			// Logger adapters are also outside the delivery path.
		}
	}

	snapshot(): RealtimeMetricsSnapshot {
		let deltaBufferedEvents = 0;
		let deltaBufferedBytes = 0;
		for (const buffer of this.deltaBuffers.values()) {
			deltaBufferedEvents += buffer.events;
			deltaBufferedBytes += buffer.bytes;
		}
		return {
			counters: Object.fromEntries(this.counters),
			gauges: {
				activeSessions: this.activeSessions,
				bufferedBytes: this.bufferedBytes,
				deltaBufferedEvents,
				deltaBufferedBytes,
			},
		};
	}
}

export function realtimeOperation(
	operation: "find" | "count" | "get" | undefined,
): "find" | "count" | "get" {
	return operation === "count" || operation === "get" ? operation : "find";
}
