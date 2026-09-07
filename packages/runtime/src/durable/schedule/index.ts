import { canonicalMutationBytes } from "../../mutation/contract";
import type { PostgresTransactionRunner } from "../../postgres/contract";
import {
	scheduleDigest,
	scheduleTickIdentity,
	verifyStaticScheduleArtifact,
} from "./artifact";
import { evaluateLatestCronMatch } from "./calendar";
import {
	StaticScheduleFailure,
	type StaticScheduleAcceptance,
	type StaticScheduleActivationReceipt,
	type StaticScheduleHead,
} from "./contract";
import * as statements from "./statements";

export { verifyStaticScheduleArtifact } from "./artifact";
export { createStaticScheduleProducer } from "./producer";
export type {
	StaticJobScheduleArtifact,
	StaticJobSchedule,
	StaticScheduleAcceptance,
	StaticScheduleActivationReceipt,
} from "./contract";

function fail(): never {
	throw new StaticScheduleFailure("SCHEDULE_STATE_INVALID");
}
function revision(value: unknown): string {
	if (
		typeof value !== "string" ||
		!/^(?:0|[1-9][0-9]*)$/u.test(value) ||
		value.length > 19 ||
		BigInt(value) > 9223372036854775807n
	)
		fail();
	return value;
}
function instant(value: unknown): Date {
	if (
		!(value instanceof Date) ||
		!Number.isFinite(value.getTime()) ||
		value.getUTCFullYear() < 1 ||
		value.getUTCFullYear() > 9999
	)
		fail();
	return new Date(value);
}
function minute(value: Date): Date {
	return new Date(Math.floor(value.getTime() / 60000) * 60000);
}
function head(row: readonly unknown[] | undefined): StaticScheduleHead | null {
	if (!row) return null;
	if (row.length !== 3) fail();
	const currentRevision = revision(row[0]);
	if (currentRevision === "0") {
		if (row[1] !== null || row[2] !== null) fail();
		return null;
	}
	if (typeof row[1] !== "string" || !/^[a-f0-9]{64}$/u.test(row[1])) fail();
	return Object.freeze({
		revision: currentRevision,
		targetDigest: row[1],
		activatedAt: instant(row[2]).toISOString(),
	});
}

/** One PostgreSQL owner serializes deployment activation and ordinary Job acceptance. */
export function createPostgresStaticSchedules(
	input: Readonly<{
		database: PostgresTransactionRunner;
		artifact: unknown;
		bindings: Readonly<{
			application: string;
			compilerRuntimeBuildDigest: string;
			jobProjectionDigest: string;
		}>;
		accept: StaticScheduleAcceptance;
	}>,
) {
	const artifact = verifyStaticScheduleArtifact(input.artifact, input.bindings);
	const application = artifact.application;
	const catalogJson = new TextDecoder().decode(
		canonicalMutationBytes({ application, schedules: artifact.schedules }),
	);
	return Object.freeze({
		async activate(
			request: Readonly<{ expectedRevision: string; signal?: AbortSignal }>,
		): Promise<StaticScheduleActivationReceipt> {
			const expectedRevision = revision(request.expectedRevision);
			const signal = AbortSignal.any([
				request.signal ?? new AbortController().signal,
				AbortSignal.timeout(10000),
			]);
			signal.throwIfAborted();
			const requestIdentity = scheduleDigest(
				"questpie-schedule-activation-v1",
				{ application, expectedRevision, targetDigest: artifact.digest },
			);
			return input.database.transaction({
				mode: { isolation: "readCommitted", access: "readWrite" },
				control: { signal },
				use: async (transaction) => {
					await transaction.execute(statements.headCreate, [application]);
					const current = head(
						(await transaction.execute(statements.headLock, [application]))[0],
					);
					const historical = (
						await transaction.execute(statements.activationRead, [
							application,
							requestIdentity,
						])
					)[0];
					if (historical) {
						if (
							!current ||
							historical.length !== 4 ||
							historical[0] !== expectedRevision ||
							historical[1] !== artifact.digest ||
							revision(historical[2]) !==
								(BigInt(expectedRevision) + 1n).toString() ||
							BigInt(historical[2] as string) > BigInt(current.revision)
						)
							fail();
						const stored = (
							await transaction.execute(statements.catalogRead, [
								application,
								artifact.digest,
							])
						)[0];
						if (stored?.[0] !== catalogJson) fail();
						return Object.freeze({
							requestIdentity,
							acceptedRevision: historical[2] as string,
							targetDigest: artifact.digest,
							activatedAt: instant(historical[3]).toISOString(),
							currentHead: current,
							replayed: true,
						});
					}
					if ((current?.revision ?? "0") !== expectedRevision)
						throw new StaticScheduleFailure(
							"SCHEDULE_ACTIVATION_STALE",
							current
								? {
										revision: current.revision,
										targetDigest: current.targetDigest,
									}
								: undefined,
						);
					if (expectedRevision === "9223372036854775807")
						throw new StaticScheduleFailure("SCHEDULE_REVISION_OVERFLOW");
					const observed = instant(
						(await transaction.execute(statements.clockRead, []))[0]?.[0],
					);
					const activatedAt = observed.toISOString();
					const acceptedRevision = (BigInt(expectedRevision) + 1n).toString();
					await transaction.execute(statements.catalogInsert, [
						application,
						artifact.digest,
						catalogJson,
					]);
					if (
						(
							await transaction.execute(statements.catalogRead, [
								application,
								artifact.digest,
							])
						)[0]?.[0] !== catalogJson
					)
						fail();
					const previous = new Map(
						(
							await transaction.execute(statements.frontierRead, [application])
						).map((row) => [row[0], row]),
					);
					await transaction.execute(statements.frontiersDelete, [application]);
					for (const schedule of artifact.schedules) {
						const prior = previous.get(schedule.jobIdentity);
						const frontier =
							prior?.[1] === schedule.programDigest
								? instant(prior[2])
								: minute(observed);
						await transaction.execute(statements.frontierInsert, [
							application,
							schedule.jobIdentity,
							schedule.programDigest,
							frontier,
						]);
					}
					await transaction.execute(statements.headUpdate, [
						application,
						acceptedRevision,
						artifact.digest,
						observed,
					]);
					await transaction.execute(statements.activationInsert, [
						application,
						requestIdentity,
						expectedRevision,
						artifact.digest,
						acceptedRevision,
						observed,
					]);
					signal.throwIfAborted();
					const currentHead = Object.freeze({
						revision: acceptedRevision,
						targetDigest: artifact.digest,
						activatedAt,
					});
					return Object.freeze({
						requestIdentity,
						acceptedRevision,
						targetDigest: artifact.digest,
						activatedAt,
						currentHead,
						replayed: false,
					});
				},
			});
		},
		async reconcile(request: Readonly<{ signal?: AbortSignal }> = {}) {
			const signal = AbortSignal.any([
				request.signal ?? new AbortController().signal,
				AbortSignal.timeout(10000),
			]);
			signal.throwIfAborted();
			return input.database.transaction({
				mode: { isolation: "readCommitted", access: "readWrite" },
				control: { signal },
				use: async (transaction) => {
					const current = head(
						(await transaction.execute(statements.headLock, [application]))[0],
					);
					if (!current || current.targetDigest !== artifact.digest)
						return Object.freeze({
							status: "inactive" as const,
							accepted: 0,
							examined: 0,
						});
					const observedAt = instant(
						(await transaction.execute(statements.clockRead, []))[0]?.[0],
					);
					const observedMinute = minute(observedAt);
					if (
						(
							await transaction.execute(statements.catalogRead, [
								application,
								artifact.digest,
							])
						)[0]?.[0] !== catalogJson
					)
						fail();
					const frontiers = await transaction.execute(statements.frontierRead, [
						application,
					]);
					if (frontiers.length !== artifact.schedules.length) fail();
					let accepted = 0;
					for (const [index, schedule] of artifact.schedules.entries()) {
						const row = frontiers[index]!;
						if (
							row.length !== 3 ||
							row[0] !== schedule.jobIdentity ||
							row[1] !== schedule.programDigest
						)
							fail();
						const frontier = instant(row[2]);
						const { match } = evaluateLatestCronMatch(
							schedule.cron,
							frontier,
							observedMinute,
						);
						if (match) {
							const existing = await transaction.execute(statements.tickRead, [
								application,
								schedule.jobIdentity,
								match,
							]);
							if (existing.length === 0) {
								signal.throwIfAborted();
								const tickId = scheduleTickIdentity(
									application,
									schedule.jobIdentity,
									match,
								);
								const receipt = await input.accept(
									Object.freeze({
										transaction,
										schedule,
										tickId,
										scheduledMinute: match,
										observedAt,
										signal,
									}),
								);
								if (
									receipt.resource !== schedule.jobIdentity ||
									!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u.test(
										receipt.runId,
									)
								)
									fail();
								await transaction.execute(statements.tickInsert, [
									application,
									schedule.jobIdentity,
									match,
									current.revision,
									schedule.programDigest,
									receipt.runId,
									observedAt,
								]);
								accepted++;
							}
						}
						await transaction.execute(statements.frontierUpdate, [
							application,
							schedule.jobIdentity,
							observedMinute,
						]);
					}
					signal.throwIfAborted();
					return Object.freeze({
						status: "active" as const,
						accepted,
						examined: artifact.schedules.length,
					});
				},
			});
		},
	});
}
