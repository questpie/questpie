import { createHmac, timingSafeEqual } from "node:crypto";

import type { SQL } from "bun";

import { canonicalJsonLine, sha256Digest } from "../canonical-json";
import type { PostgresDatabase } from "../postgres";
import {
	acknowledgePostgresRetainedResult,
	prunePostgresLiveQueryRetention,
	readPostgresRetainedResult,
	type PostgresRetainedResultRow,
} from "./postgres-retention-database";

const digestPattern = /^[0-9a-f]{64}$/;
const identityPattern = /^[a-z][A-Za-z0-9]*(?:\.[a-z][A-Za-z0-9]*)*$/;
const retainedResultBytesLimit = 1_048_576;
const dependencyPlanBytesLimit = 262_144;
const retainedTokensPerPrincipal = 128;
const postgresBigintMaximum = 9_223_372_036_854_775_807n;
const postgresIntegerMaximum = 2_147_483_647;

type RetainedLiveQueryResetReason =
	| "authority-changed"
	| "deployment-changed"
	| "resume-unavailable";

export type RetainedLiveQueryBinding = Readonly<{
	applicationName: string;
	deploymentDigest: string;
	/** Digest of the Principal-scoped authority partition used for the 128-token budget. */
	authorityPartitionDigest: string;
	queryIdentity: string;
	inputDigest: string;
	wireVersion: number;
	retainedGeneration: bigint;
}>;

type RetainedLiveQueryLookupBinding = Omit<
	RetainedLiveQueryBinding,
	"retainedGeneration"
>;

export type RetainedLiveQueryCompleteResult = Readonly<{
	binding: RetainedLiveQueryBinding;
	resultBytes: Uint8Array;
	dependencyPlanBytes: Uint8Array;
}>;

type PostgresRetainedResult =
	| Readonly<{
			status: "available";
			resultBytes: Uint8Array;
			dependencyPlanBytes: Uint8Array;
			retainedGeneration: bigint;
	  }>
	| Readonly<{
			status: "unavailable";
			resetReason: RetainedLiveQueryResetReason;
	  }>;

type PostgresLiveQueryPruneResult = Readonly<{
	retainedResults: number;
	ledgerFacts: number;
}>;

type PostgresLiveQueryRetentionInput =
	| Readonly<{
			database: PostgresDatabase;
			sql?: never;
			hmacKey: Uint8Array;
	  }>
	| Readonly<{
			database?: never;
			sql: SQL;
			hmacKey: Uint8Array;
	  }>;

export type PostgresLiveQueryRetention = Readonly<{
	mint(result: RetainedLiveQueryCompleteResult): string;
	acknowledge(
		result: RetainedLiveQueryCompleteResult & Readonly<{ resumeToken: string }>,
	): Promise<void>;
	resume(
		input: Readonly<{
			binding: RetainedLiveQueryLookupBinding;
			resumeToken: string;
		}>,
	): Promise<PostgresRetainedResult>;
	prune(
		input: Readonly<{
			applicationName: string;
		}>,
	): Promise<PostgresLiveQueryPruneResult>;
}>;

type ResumeTokenPayloadV1 = Readonly<{
	application: string;
	authority: string;
	dependencies: string;
	deployment: string;
	generation: string;
	input: string;
	query: string;
	result: string;
	v: 1;
	wire: number;
}>;

function validDigest(value: string, label: string): string {
	if (!digestPattern.test(value)) throw new TypeError(`${label} is invalid`);
	return value;
}

function validIdentity(value: string, label: string): string {
	if (!identityPattern.test(value) || Buffer.byteLength(value) > 256)
		throw new TypeError(`${label} is invalid`);
	return value;
}

function validateBinding(binding: RetainedLiveQueryBinding): void {
	if (!binding || typeof binding !== "object" || Array.isArray(binding))
		throw new TypeError("retained Live Query binding is invalid");
	validIdentity(binding.applicationName, "application identity");
	validDigest(binding.deploymentDigest, "deployment digest");
	validDigest(binding.authorityPartitionDigest, "authority partition digest");
	validIdentity(binding.queryIdentity, "Query identity");
	validDigest(binding.inputDigest, "input digest");
	if (
		!Number.isSafeInteger(binding.wireVersion) ||
		binding.wireVersion <= 0 ||
		binding.wireVersion > postgresIntegerMaximum
	)
		throw new TypeError("wire version is invalid");
	if (
		binding.retainedGeneration <= 0n ||
		binding.retainedGeneration > postgresBigintMaximum
	)
		throw new TypeError("retained generation is invalid");
}

function validateLookupBinding(binding: RetainedLiveQueryLookupBinding): void {
	if (
		Object.keys(binding).toSorted().join(",") !==
		"applicationName,authorityPartitionDigest,deploymentDigest,inputDigest,queryIdentity,wireVersion"
	)
		throw new TypeError("retained Live Query lookup binding keys are invalid");
	validateBinding({ ...binding, retainedGeneration: 1n });
}

function validateCompleteResult(result: RetainedLiveQueryCompleteResult): void {
	validateBinding(result.binding);
	if (!(result.resultBytes instanceof Uint8Array))
		throw new TypeError("retained result bytes are invalid");
	if (result.resultBytes.byteLength > retainedResultBytesLimit)
		throw new TypeError("retained result byte limit exceeded");
	if (!(result.dependencyPlanBytes instanceof Uint8Array))
		throw new TypeError("dependency plan bytes are invalid");
	if (result.dependencyPlanBytes.byteLength > dependencyPlanBytesLimit)
		throw new TypeError("dependency plan byte limit exceeded");
}

function tokenPayload(
	result: RetainedLiveQueryCompleteResult,
): ResumeTokenPayloadV1 {
	return Object.freeze({
		application: result.binding.applicationName,
		authority: result.binding.authorityPartitionDigest,
		dependencies: sha256Digest(result.dependencyPlanBytes),
		deployment: result.binding.deploymentDigest,
		generation: result.binding.retainedGeneration.toString(),
		input: result.binding.inputDigest,
		query: result.binding.queryIdentity,
		result: sha256Digest(result.resultBytes),
		v: 1,
		wire: result.binding.wireVersion,
	});
}

function exactPayload(value: unknown): ResumeTokenPayloadV1 | undefined {
	if (!value || typeof value !== "object" || Array.isArray(value)) return;
	const payload = value as Readonly<Record<string, unknown>>;
	if (
		Object.keys(payload).sort().join(",") !==
			"application,authority,dependencies,deployment,generation,input,query,result,v,wire" ||
		payload.v !== 1 ||
		typeof payload.application !== "string" ||
		typeof payload.authority !== "string" ||
		typeof payload.dependencies !== "string" ||
		typeof payload.deployment !== "string" ||
		typeof payload.generation !== "string" ||
		typeof payload.input !== "string" ||
		typeof payload.query !== "string" ||
		typeof payload.result !== "string" ||
		typeof payload.wire !== "number"
	)
		return;
	try {
		if (!/^[1-9][0-9]*$/.test(payload.generation)) return;
		const generation = BigInt(payload.generation);
		const binding = {
			applicationName: payload.application,
			deploymentDigest: payload.deployment,
			authorityPartitionDigest: payload.authority,
			queryIdentity: payload.query,
			inputDigest: payload.input,
			wireVersion: payload.wire,
			retainedGeneration: generation,
		};
		validateBinding(binding);
		validDigest(payload.dependencies, "dependency digest");
		validDigest(payload.result, "result digest");
		return payload as ResumeTokenPayloadV1;
	} catch {
		return;
	}
}

function payloadMatchesBinding(
	payload: ResumeTokenPayloadV1,
	binding: RetainedLiveQueryBinding,
): boolean {
	return (
		payload.application === binding.applicationName &&
		payload.deployment === binding.deploymentDigest &&
		payload.authority === binding.authorityPartitionDigest &&
		payload.query === binding.queryIdentity &&
		payload.input === binding.inputDigest &&
		payload.wire === binding.wireVersion &&
		payload.generation === binding.retainedGeneration.toString()
	);
}

function payloadMatchesLookupBinding(
	payload: ResumeTokenPayloadV1,
	binding: RetainedLiveQueryLookupBinding,
): boolean {
	return (
		payload.application === binding.applicationName &&
		payload.deployment === binding.deploymentDigest &&
		payload.authority === binding.authorityPartitionDigest &&
		payload.query === binding.queryIdentity &&
		payload.input === binding.inputDigest &&
		payload.wire === binding.wireVersion
	);
}

function unavailableResetReason(
	payload: ResumeTokenPayloadV1 | undefined,
	binding: RetainedLiveQueryLookupBinding,
): RetainedLiveQueryResetReason {
	if (
		!payload ||
		payload.application !== binding.applicationName ||
		payload.query !== binding.queryIdentity ||
		payload.input !== binding.inputDigest ||
		payload.wire !== binding.wireVersion
	)
		return "resume-unavailable";
	if (payload.deployment !== binding.deploymentDigest)
		return "deployment-changed";
	if (payload.authority !== binding.authorityPartitionDigest)
		return "authority-changed";
	return "resume-unavailable";
}

function bytes(value: unknown): Uint8Array | undefined {
	return value instanceof Uint8Array ? new Uint8Array(value) : undefined;
}

export function createPostgresLiveQueryRetention(
	input: PostgresLiveQueryRetentionInput,
): PostgresLiveQueryRetention {
	if (!(input.hmacKey instanceof Uint8Array) || input.hmacKey.byteLength < 32)
		throw new TypeError("resume-token HMAC key must contain at least 32 bytes");
	const hmacKey = new Uint8Array(input.hmacKey);
	const sign = (body: string): Buffer =>
		createHmac("sha256", hmacKey).update(body).digest();
	const mint = (result: RetainedLiveQueryCompleteResult): string => {
		validateCompleteResult(result);
		const body = Buffer.from(canonicalJsonLine(tokenPayload(result))).toString(
			"base64url",
		);
		return `${body}.${sign(body).toString("base64url")}`;
	};
	const decode = (token: string): ResumeTokenPayloadV1 | undefined => {
		if (typeof token !== "string" || token.length > 4096) return;
		const parts = token.split(".");
		if (parts.length !== 2 || !parts[0] || !parts[1]) return;
		let actualSignature: Buffer;
		try {
			actualSignature = Buffer.from(parts[1], "base64url");
		} catch {
			return;
		}
		const expectedSignature = sign(parts[0]);
		if (
			actualSignature.byteLength !== expectedSignature.byteLength ||
			!timingSafeEqual(actualSignature, expectedSignature)
		)
			return;
		try {
			const decoded = JSON.parse(
				Buffer.from(parts[0], "base64url").toString("utf8"),
			) as unknown;
			const payload = exactPayload(decoded);
			if (!payload) return;
			if (
				Buffer.from(canonicalJsonLine(payload)).toString("base64url") !==
				parts[0]
			)
				return;
			return payload;
		} catch {
			return;
		}
	};

	return Object.freeze({
		mint,
		async acknowledge(result) {
			validateCompleteResult(result);
			const payload = decode(result.resumeToken);
			if (
				!payload ||
				!payloadMatchesBinding(payload, result.binding) ||
				payload.result !== sha256Digest(result.resultBytes) ||
				payload.dependencies !== sha256Digest(result.dependencyPlanBytes)
			)
				throw new TypeError(
					"resume token does not bind the acknowledged result",
				);
			const tokenDigest = sha256Digest(result.resumeToken);
			if (input.database !== undefined)
				return acknowledgePostgresRetainedResult(
					input.database,
					result,
					tokenDigest,
				);
			await input.sql.begin(async (transaction) => {
				await transaction`
					select pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
					  ${`questpie-retained-result-v1:${result.binding.applicationName}:${result.binding.authorityPartitionDigest}`},
					  0
					))
				`;
				await transaction`
					delete from questpie_internal.retained_live_query_results
					where application_name = ${result.binding.applicationName}
					  and authority_partition_digest = ${result.binding.authorityPartitionDigest}
					  and expires_at <= transaction_timestamp()
				`;
				const inserted = await transaction<{ tokenDigest: string }[]>`
					insert into questpie_internal.retained_live_query_results
					(application_name, token_digest, authority_partition_digest, deployment_digest,
					 query_identity, input_digest, wire_version, retained_generation, result_bytes,
					 dependency_plan_bytes)
					values (${result.binding.applicationName}, ${tokenDigest},
					 ${result.binding.authorityPartitionDigest}, ${result.binding.deploymentDigest},
					 ${result.binding.queryIdentity}, ${result.binding.inputDigest},
					 ${result.binding.wireVersion}, ${result.binding.retainedGeneration},
					 ${result.resultBytes}, ${result.dependencyPlanBytes})
					on conflict (application_name, token_digest) do update
					set token_digest = excluded.token_digest
					where retained_live_query_results.authority_partition_digest = excluded.authority_partition_digest
					  and retained_live_query_results.deployment_digest = excluded.deployment_digest
					  and retained_live_query_results.query_identity = excluded.query_identity
					  and retained_live_query_results.input_digest = excluded.input_digest
					  and retained_live_query_results.wire_version = excluded.wire_version
					  and retained_live_query_results.retained_generation = excluded.retained_generation
					  and retained_live_query_results.result_bytes = excluded.result_bytes
					  and retained_live_query_results.dependency_plan_bytes = excluded.dependency_plan_bytes
					returning token_digest as "tokenDigest"
				`;
				if (inserted.length !== 1 || inserted[0]?.tokenDigest !== tokenDigest)
					throw new TypeError("retained result identity conflicts");
				await transaction`
					with evicted as (
					  select token_digest
					  from questpie_internal.retained_live_query_results
					  where application_name = ${result.binding.applicationName}
					    and authority_partition_digest = ${result.binding.authorityPartitionDigest}
					  order by created_at desc, token_digest desc
					  offset ${retainedTokensPerPrincipal}
					)
					delete from questpie_internal.retained_live_query_results retained
					using evicted
					where retained.application_name = ${result.binding.applicationName}
					  and retained.token_digest = evicted.token_digest
				`;
			});
		},
		async resume({ binding, resumeToken }) {
			validateLookupBinding(binding);
			const candidateToken = typeof resumeToken === "string" ? resumeToken : "";
			const payload = decode(candidateToken);
			const row =
				input.database !== undefined
					? await readPostgresRetainedResult(
							input.database,
							binding,
							sha256Digest(candidateToken),
						)
					: (
							await input.sql<PostgresRetainedResultRow[]>`
				select deployment_digest as "deploymentDigest",
				       authority_partition_digest as "authorityPartitionDigest",
				       query_identity as "queryIdentity", input_digest as "inputDigest",
				       wire_version as "wireVersion", retained_generation as "retainedGeneration",
				       result_bytes as "resultBytes", dependency_plan_bytes as "dependencyPlanBytes"
				from questpie_internal.retained_live_query_results
				where application_name = ${binding.applicationName}
				  and token_digest = ${sha256Digest(candidateToken)}
				  and deployment_digest = ${binding.deploymentDigest}
				  and authority_partition_digest = ${binding.authorityPartitionDigest}
				  and query_identity = ${binding.queryIdentity}
				  and input_digest = ${binding.inputDigest}
				  and wire_version = ${binding.wireVersion}
				  and expires_at > transaction_timestamp()
			`
						)[0];
			const resultBytes = bytes(row?.resultBytes);
			const dependencyPlanBytes = bytes(row?.dependencyPlanBytes);
			if (
				!payload ||
				!payloadMatchesLookupBinding(payload, binding) ||
				!row ||
				!resultBytes ||
				!dependencyPlanBytes ||
				row.deploymentDigest !== binding.deploymentDigest ||
				row.authorityPartitionDigest !== binding.authorityPartitionDigest ||
				row.queryIdentity !== binding.queryIdentity ||
				row.inputDigest !== binding.inputDigest ||
				row.wireVersion !== binding.wireVersion ||
				BigInt(row.retainedGeneration) !== BigInt(payload.generation) ||
				payload.result !== sha256Digest(resultBytes) ||
				payload.dependencies !== sha256Digest(dependencyPlanBytes)
			)
				return Object.freeze({
					status: "unavailable" as const,
					resetReason: unavailableResetReason(payload, binding),
				});
			return Object.freeze({
				status: "available" as const,
				resultBytes,
				dependencyPlanBytes,
				retainedGeneration: BigInt(row.retainedGeneration),
			});
		},
		async prune({ applicationName }) {
			validIdentity(applicationName, "application identity");
			if (input.database !== undefined)
				return prunePostgresLiveQueryRetention(input.database, applicationName);
			return input.sql.begin(async (transaction) => {
				const [retained] = await transaction<{ count: number }[]>`
					with deleted as (
					  delete from questpie_internal.retained_live_query_results
					  where application_name = ${applicationName}
					    and expires_at <= transaction_timestamp()
					  returning 1
					)
					select count(*)::integer as count from deleted
				`;
				const [ledger] = await transaction<{ count: number }[]>`
					with minimum as (
					  select min(xid_horizon) as horizon
					  from questpie_internal.reconciliation_consumers
					  where application_name = ${applicationName}
					), deleted as (
					  delete from questpie_internal.change_ledger facts using minimum
					  where facts.application_name = ${applicationName}
					    and facts.transaction_id < minimum.horizon
					  returning 1
					)
					select count(*)::integer as count from deleted
				`;
				return Object.freeze({
					retainedResults: retained?.count ?? 0,
					ledgerFacts: ledger?.count ?? 0,
				});
			});
		},
	});
}
