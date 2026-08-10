import { FatalGlobalHookError, onAfterCommit, withTransaction } from "questpie";
import type { RequestContextLogger } from "questpie/types";

import type { PersistedAuditEvent } from "../policy.js";
import { toCanonicalAuditEvent } from "../policy.js";
import {
	getAuditPersistence,
	getAuditSink,
	resolveAuditApp,
	type AuditCollectionWriter,
} from "./runtime.js";

export interface AuditOperationDetails {
	operation: string;
	resource: string;
}

type AuditRuntimeContext = {
	app?: unknown;
	db?: unknown;
	logger?: RequestContextLogger;
};

export function logAuditFailure(
	ctx: { logger?: RequestContextLogger },
	message: string,
	error: unknown,
	details: AuditOperationDetails,
): void {
	ctx.logger?.error?.(message, {
		error:
			error instanceof Error
				? { name: error.name, message: error.message }
				: { message: String(error) },
		...details,
	});
}

export function handleAuditFailure(
	ctx: AuditRuntimeContext,
	message: string,
	error: unknown,
	details: AuditOperationDetails,
	fatalTransition = false,
): void {
	if (getAuditPersistence(ctx) === "required") {
		throw fatalTransition ? new FatalGlobalHookError(error) : error;
	}
	logAuditFailure(ctx, message, error, details);
}

export async function persistAuditEvent(
	ctx: AuditRuntimeContext,
	auditCollection: AuditCollectionWriter,
	data: Record<string, unknown>,
	details: AuditOperationDetails,
): Promise<void> {
	const sink = getAuditSink(ctx);
	const deliver = async (stored: unknown): Promise<void> => {
		if (!sink) return;
		try {
			await sink.append(toCanonicalAuditEvent(stored as PersistedAuditEvent));
		} catch (error) {
			logAuditFailure(
				ctx,
				"[Audit] After-commit export failed:",
				error,
				details,
			);
		}
	};

	if (getAuditPersistence(ctx) === "required") {
		const stored = await auditCollection.create(data, {
			accessMode: "system",
			db: ctx.db,
		});
		onAfterCommit(() => deliver(stored));
		return;
	}

	const app = resolveAuditApp(ctx.app);
	onAfterCommit(async () => {
		try {
			if (!app?.db)
				throw new Error("Audit application database is unavailable");
			const stored = await withTransaction(app.db, (db) =>
				auditCollection.create(data, { accessMode: "system", db }),
			);
			await deliver(stored);
		} catch (error) {
			logAuditFailure(
				ctx,
				"[Audit] Best-effort persistence failed:",
				error,
				details,
			);
		}
	});
}
