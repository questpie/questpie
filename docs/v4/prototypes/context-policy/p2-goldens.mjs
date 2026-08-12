import assert from "node:assert/strict";
import { createHash } from "node:crypto";

// P2 extends these exact accepted bytes. It never regenerates or interprets
// the fixed foundational and P1 artifacts.
export const FIXED_DIGESTS = Object.freeze({
	schema: "9d757239d4033d042b741b410df593420e14216ae1147173e0f75b2afd5a7033",
	data: "0d5af01332f05f1c4a02cf543c0d242f450adfd378ac455f218df876038c9b4f",
	structuralQuery:
		"a8512fb577f3c4dd653d714f5191f1311788237e9f5d81813bd24c7452f57ac1",
	p1Executable:
		"c806791a7522305ed2f2554613eb06fc331528501c31fc5e5f106753b2a0a644",
	p1AppContract:
		"d6052edc32d5a9218f242d724c7b47dd0ea543857d57fe5f47bc625fb307b7ca",
	p1RuntimeBuild:
		"ff060e1cf02fb28830e8fee2aa89a90bfe777468e7e84bbbe6a31b81cea3db19",
});

function compareAscii(left, right) {
	return left < right ? -1 : left > right ? 1 : 0;
}

function canonicalValue(value) {
	if (Array.isArray(value)) return value.map(canonicalValue);
	if (value && typeof value === "object") {
		return Object.fromEntries(
			Object.keys(value)
				.sort(compareAscii)
				.map((key) => [key, canonicalValue(value[key])]),
		);
	}
	return value;
}

export function canonicalBytes(value) {
	return `${JSON.stringify(canonicalValue(value))}\n`;
}

export function canonicalDigest(domain, value) {
	return createHash("sha256")
		.update(domain)
		.update(canonicalBytes(value))
		.digest("hex");
}

function path(...segments) {
	assert.ok(segments.length > 0);
	assert.ok(segments.every((segment) => typeof segment === "string"));
	return segments;
}

function field(scope, collection, fieldPath, codec) {
	return { kind: "field", scope, collection, path: fieldPath, codec };
}

function fact(source, fieldPath, codec) {
	return { kind: "executionFact", source, path: fieldPath, codec };
}

function literal(codec, value) {
	return { kind: "literal", codec, value };
}

function equal(left, right) {
	assert.equal(left.codec, right.codec);
	return { kind: "equal", left, right };
}

function oneOf(operand, values) {
	const canonicalValues = [...new Set(values)].sort(compareAscii);
	return {
		kind: "in",
		operand,
		values: canonicalValues.map((value) => literal(operand.codec, value)),
	};
}

function and(...items) {
	return { kind: "and", items };
}

function or(...items) {
	return { kind: "or", items };
}

function exists(collection, scope, predicate) {
	return {
		kind: "exists",
		collection,
		scope,
		semantics: "policyEvidenceBooleanOnly",
		targetDisclosurePolicy: "notApplied",
		predicate,
	};
}

function authorityIs(kind) {
	return {
		kind: "equal",
		left: fact("authority", path("kind"), "authority"),
		right: literal("authority", kind),
	};
}

const principalId = fact("principal", path("id"), "text");
const tenantId = fact("tenant", path("id"), "text");

const messageReadRows = exists(
	"collection:channels",
	"channel",
	and(
		equal(
			field("channel", "collection:channels", path("id"), "text"),
			field("row", "collection:messages", path("channelId"), "text"),
		),
		exists(
			"collection:spaces",
			"space",
			and(
				equal(
					field("space", "collection:spaces", path("id"), "text"),
					field("channel", "collection:channels", path("spaceId"), "text"),
				),
				exists(
					"collection:companies",
					"company",
					and(
						equal(
							field("company", "collection:companies", path("id"), "text"),
							field("space", "collection:spaces", path("companyId"), "text"),
						),
						equal(
							field("company", "collection:companies", path("id"), "text"),
							tenantId,
						),
						exists(
							"collection:memberships",
							"companyMembership",
							and(
								equal(
									field(
										"companyMembership",
										"collection:memberships",
										path("companyId"),
										"text",
									),
									field("company", "collection:companies", path("id"), "text"),
								),
								equal(
									field(
										"companyMembership",
										"collection:memberships",
										path("principalId"),
										"text",
									),
									principalId,
								),
								equal(
									field(
										"companyMembership",
										"collection:memberships",
										path("scopeKey"),
										"text",
									),
									literal("text", "company"),
								),
								equal(
									field(
										"companyMembership",
										"collection:memberships",
										path("status"),
										"text",
									),
									literal("text", "active"),
								),
							),
						),
					),
				),
			),
		),
		or(
			equal(
				field("channel", "collection:channels", path("visibility"), "text"),
				literal("text", "company"),
			),
			exists(
				"collection:memberships",
				"channelMembership",
				and(
					equal(
						field(
							"channelMembership",
							"collection:memberships",
							path("companyId"),
							"text",
						),
						field("row", "collection:messages", path("companyId"), "text"),
					),
					equal(
						field(
							"channelMembership",
							"collection:memberships",
							path("principalId"),
							"text",
						),
						principalId,
					),
					equal(
						field(
							"channelMembership",
							"collection:memberships",
							path("scopeKey"),
							"text",
						),
						field("channel", "collection:channels", path("id"), "text"),
					),
					equal(
						field(
							"channelMembership",
							"collection:memberships",
							path("status"),
							"text",
						),
						literal("text", "active"),
					),
				),
			),
		),
	),
);

const updateRows = and(
	equal(
		field("current", "collection:messages", path("companyId"), "text"),
		tenantId,
	),
	or(
		equal(
			field("current", "collection:messages", path("authorId"), "text"),
			principalId,
		),
		exists(
			"collection:memberships",
			"writeMembership",
			and(
				equal(
					field(
						"writeMembership",
						"collection:memberships",
						path("companyId"),
						"text",
					),
					field("current", "collection:messages", path("companyId"), "text"),
				),
				equal(
					field(
						"writeMembership",
						"collection:memberships",
						path("principalId"),
						"text",
					),
					principalId,
				),
				equal(
					field(
						"writeMembership",
						"collection:memberships",
						path("scopeKey"),
						"text",
					),
					literal("text", "company"),
				),
				equal(
					field(
						"writeMembership",
						"collection:memberships",
						path("status"),
						"text",
					),
					literal("text", "active"),
				),
				oneOf(
					field(
						"writeMembership",
						"collection:memberships",
						path("role"),
						"text",
					),
					["moderator", "admin", "owner"],
				),
			),
		),
	),
);

const candidateInvariant = and(
	equal(
		field("candidate", "collection:messages", path("companyId"), "text"),
		field("current", "collection:messages", path("companyId"), "text"),
	),
	equal(
		field("candidate", "collection:messages", path("channelId"), "text"),
		field("current", "collection:messages", path("channelId"), "text"),
	),
	equal(
		field("candidate", "collection:messages", path("authorId"), "text"),
		field("current", "collection:messages", path("authorId"), "text"),
	),
);

export const contextProjection = Object.freeze({
	format: "questpie.context-projection",
	version: 1,
	identity: "context:app",
	owner: "context:app",
	input: {
		kind: "object",
		properties: { companyId: { kind: "uuid" } },
		required: ["companyId"],
		additionalProperties: false,
	},
	resolved: {
		tenant: { id: { kind: "uuid" } },
		values: {
			selectedMembershipPrincipalId: { kind: "uuid" },
			selectedMembershipScope: { kind: "text", maximumLength: 200 },
			selectedRole: {
				kind: "enum",
				values: ["admin", "member", "moderator", "owner"],
			},
		},
		immutable: true,
	},
	resolution: {
		frequency: "oncePerRootExecution",
		concurrentConsumers: "coalesced",
		failureOrder: "beforePolicyAndHandler",
		nested: "inheritExactResolvedContext",
		services: "executionScopedSeparateLifetime",
	},
});

export const bootstrapProjection = Object.freeze({
	format: "questpie.context-bootstrap-plan",
	version: 1,
	context: "context:app",
	capabilities: ["getByExactKey"],
	readOnly: true,
	limits: {
		maximumReads: 4,
		maximumConcurrentReads: 2,
		maximumSelectedFieldsPerRead: 16,
		maximumRowsPerRead: 1,
		maximumDurationMilliseconds: 250,
	},
	reads: [
		{
			collection: "collection:memberships",
			keyPaths: [["companyId"], ["principalId"], ["scopeKey"]],
			selectedPaths: [
				["companyId"],
				["principalId"],
				["role"],
				["scopeKey"],
				["status"],
			],
			result: "zeroOrOne",
		},
	],
	forbiddenCapabilities: [
		"allCollections",
		"database",
		"queue",
		"rawSql",
		"services",
		"systemAuthority",
		"write",
	],
	deadlineAware: true,
	cancellationAware: true,
});

export const messagePolicyProgram = Object.freeze({
	format: "questpie.policy-program",
	version: 1,
	identity: "policy:messages.default",
	target: "collection:messages",
	attachment: { kind: "default", requiredForNormalDataAccess: true },
	limits: {
		maximumExistsDepth: 4,
		maximumNodes: 128,
		maximumEvidenceCollections: 8,
		maximumFieldRules: 32,
		maximumSqlBytes: 65_536,
	},
	operations: {
		read: {
			admission: { kind: "authenticated" },
			rows: messageReadRows,
		},
		create: {
			admission: { kind: "authenticated" },
			candidate: { kind: "sameRelationalScopeAsRead" },
		},
		update: {
			admission: { kind: "authenticated" },
			current: updateRows,
			candidate: candidateInvariant,
		},
		delete: {
			admission: { kind: "authenticated" },
			current: updateRows,
		},
	},
	fields: {
		callerInput: {
			create: [{ path: ["moderationNote"], when: authorityIs("system") }],
			update: [
				{
					path: ["body"],
					when: equal(
						field("current", "collection:messages", path("authorId"), "text"),
						principalId,
					),
				},
				{ path: ["moderationNote"], when: authorityIs("system") },
			],
			suppliedPathsOnly: true,
		},
		selectedOutput: [
			{
				path: ["moderationNote"],
				when: equal(
					field("row", "collection:messages", path("authorId"), "text"),
					principalId,
				),
				deniedEncoding: "omitProperty",
			},
		],
	},
	phaseOrder: {
		root: ["decodeContextInput", "resolveContext", "admission", "handler"],
		keyedRead: ["admission", "sqlScopedLookup", "selectedOutput"],
		createPolicyBoundary: [
			"admission",
			"suppliedCallerFieldAuthority",
			"candidateAuthority",
		],
		updatePolicyBoundary: [
			"admission",
			"sqlScopedCurrentRowLock",
			"recheckCurrentRelationalEvidenceAfterWait",
			"suppliedCallerFieldAuthority",
			"candidateAuthority",
			"selectedOutput",
		],
	},
});

export const archivePolicyProgram = Object.freeze({
	format: "questpie.policy-program",
	version: 1,
	identity: "policy:archiveRecords.default",
	target: "collection:archiveRecords",
	primaryKeyPaths: [["archiveCode"], ["catalogueNumber"]],
	idFieldRequired: false,
	rowRule: {
		kind: "or",
		items: [
			{
				kind: "equal",
				left: field("row", "collection:archiveRecords", ["visibility"], "text"),
				right: literal("text", "public"),
			},
			exists(
				"collection:researchPermits",
				"permit",
				and(
					equal(
						field(
							"permit",
							"collection:researchPermits",
							["programmeCode"],
							"text",
						),
						tenantId,
					),
					equal(
						field(
							"permit",
							"collection:researchPermits",
							["archiveCode"],
							"text",
						),
						field("row", "collection:archiveRecords", ["archiveCode"], "text"),
					),
					equal(
						field(
							"permit",
							"collection:researchPermits",
							["principalId"],
							"text",
						),
						principalId,
					),
					equal(
						field("permit", "collection:researchPermits", ["status"], "text"),
						literal("text", "active"),
					),
				),
			),
		],
	},
});

function inspectExpression(expression, state, depth = 0) {
	state.nodes += 1;
	assert.ok(state.nodes <= 128, "Policy node limit exceeded");
	if (expression.kind === "exists") {
		state.maximumExistsDepth = Math.max(state.maximumExistsDepth, depth + 1);
		assert.ok(depth + 1 <= 4, "Policy exists depth exceeded");
		state.collections.add(expression.collection);
		assert.equal(expression.semantics, "policyEvidenceBooleanOnly");
		assert.equal(expression.targetDisclosurePolicy, "notApplied");
		inspectExpression(expression.predicate, state, depth + 1);
		return;
	}
	if (expression.kind === "and" || expression.kind === "or") {
		assert.ok(expression.items.length >= 2);
		for (const item of expression.items) inspectExpression(item, state, depth);
		return;
	}
	if (expression.kind === "equal") {
		assert.equal(expression.left.codec, expression.right.codec);
		for (const operand of [expression.left, expression.right]) {
			if (operand.kind === "field") {
				assert.ok(Array.isArray(operand.path) && operand.path.length > 0);
				state.fieldReads.add(`${operand.collection}:${operand.path.join("/")}`);
			}
			if (operand.kind === "executionFact") {
				state.executionFacts.add(`${operand.source}:${operand.path.join("/")}`);
			}
		}
		return;
	}
	if (expression.kind === "in") {
		assert.deepEqual(
			expression.values.map((item) => item.value),
			[...new Set(expression.values.map((item) => item.value))].sort(
				compareAscii,
			),
		);
		state.fieldReads.add(
			`${expression.operand.collection}:${expression.operand.path.join("/")}`,
		);
		return;
	}
	throw new Error(`Unsupported Policy node: ${expression.kind}`);
}

export function deriveEvidenceGraph(program) {
	const state = {
		nodes: 0,
		maximumExistsDepth: 0,
		collections: new Set(),
		fieldReads: new Set(),
		executionFacts: new Set(),
	};
	for (const operation of Object.values(program.operations)) {
		for (const phase of ["rows", "current", "candidate"]) {
			const expression = operation[phase];
			if (expression && expression.kind !== "sameRelationalScopeAsRead") {
				inspectExpression(expression, state);
			}
		}
	}
	for (const rules of Object.values(program.fields.callerInput)) {
		if (!Array.isArray(rules)) continue;
		for (const rule of rules) inspectExpression(rule.when, state);
	}
	for (const rule of program.fields.selectedOutput) {
		inspectExpression(rule.when, state);
	}
	return {
		format: "questpie.policy-evidence-graph",
		version: 1,
		policy: program.identity,
		nodeCount: state.nodes,
		maximumExistsDepth: state.maximumExistsDepth,
		collections: [...state.collections].sort(compareAscii),
		fieldReads: [...state.fieldReads].sort(compareAscii),
		executionFacts: [...state.executionFacts].sort(compareAscii),
		disclosure: "booleanOnly",
	};
}

export const evidenceGraph = Object.freeze(
	deriveEvidenceGraph(messagePolicyProgram),
);

export const sqlLowering = Object.freeze({
	format: "questpie.policy-sql-lowering",
	version: 1,
	policy: "policy:messages.default",
	complete: true,
	rowPredicate: `EXISTS (
  SELECT 1 FROM channels AS c
  WHERE c.id = m.channel_id
    AND EXISTS (
      SELECT 1 FROM spaces AS s
      WHERE s.id = c.space_id
        AND EXISTS (
          SELECT 1 FROM companies AS co
          WHERE co.id = s.company_id
            AND co.id = :tenant_id
            AND EXISTS (
              SELECT 1 FROM memberships AS cm
              WHERE cm.company_id = co.id
                AND cm.principal_id = :principal_id
                AND cm.scope_key = 'company'
                AND cm.status = 'active'
            )
        )
    )
    AND (
      c.visibility = 'company'
      OR EXISTS (
        SELECT 1 FROM memberships AS chm
        WHERE chm.company_id = m.company_id
          AND chm.principal_id = :principal_id
          AND chm.scope_key = c.id
          AND chm.status = 'active'
      )
    )
)`,
	compositionOrder: [
		"policyRows",
		"operationRows",
		"callerFilter",
		"cursorBoundary",
		"totalOrder",
		"firstPlusOneSentinel",
	],
	selectedOutput: {
		moderationNote: {
			statementProjection: "permissionBitAndGuardedValue",
			wireEncoding: "omitWhenPermissionBitIsFalse",
			nPlusOne: false,
		},
	},
	indexes: [
		{ identity: "constraint:companies.primary", accessMethod: "btree" },
		{ identity: "constraint:spaces.primary", accessMethod: "btree" },
		{ identity: "constraint:channels.primary", accessMethod: "btree" },
		{ identity: "constraint:memberships.primary", accessMethod: "btree" },
		{ identity: "index:messages.channelCreated", accessMethod: "btree" },
	],
	derivedRls: {
		status: "notEmitted",
		claim: null,
		reason: "complete hostile RLS equivalence matrix not proven in P2",
	},
});

export const nondisclosureProjection = Object.freeze({
	format: "questpie.policy-nondisclosure",
	version: 1,
	keyedTarget: {
		missing: "notFound",
		policyInvisible: "notFound",
		postLockInvisible: "notFound",
	},
	reference: {
		missing: "invalidReference",
		policyInvisible: "invalidReference",
	},
	databaseErrors: {
		foreignKey: "invalidReference",
		unique: "conflict",
		detailDisclosure: false,
	},
	selectedFieldDenial: "omitProperty",
	rowDenialInList: "omitRow",
	errorPrecedence: {
		root: ["contextDecode", "contextResolution", "admission"],
		keyedRead: ["admission", "scopedLookup", "selectedOutput"],
		create: [
			"admission",
			"suppliedFieldAuthority",
			"candidateAuthority",
			"validation",
			"normalizedConstraint",
		],
		update: [
			"admission",
			"scopedCurrentLockAndRecheck",
			"suppliedFieldAuthority",
			"candidateAuthority",
			"validation",
			"normalizedConstraint",
			"selectedOutput",
		],
		cursorScopeMismatch: "beforeSqlAndDisclosure",
	},
});

export const dependencyProjection = Object.freeze({
	format: "questpie.policy-dependencies",
	version: 1,
	policy: "policy:messages.default",
	bootstrap: [
		{
			collection: "collection:memberships",
			paths: [
				["companyId"],
				["principalId"],
				["role"],
				["scopeKey"],
				["status"],
			],
		},
	],
	policyEvidence: evidenceGraph.collections.map((collection) => ({
		collection,
		paths: evidenceGraph.fieldReads
			.filter((read) => read.startsWith(`${collection}:`))
			.map((read) => read.slice(collection.length + 1).split("/"))
			.sort((left, right) => compareAscii(left.join("/"), right.join("/"))),
	})),
	changesThatInvalidate: [
		"membershipCreate",
		"membershipDelete",
		"membershipRoleChange",
		"membershipScopeChange",
		"membershipStatusChange",
		"channelSpaceChange",
		"channelVisibilityChange",
		"spaceCompanyChange",
	],
	recompute: "freshRootExecutionAndCurrentPolicyEvidence",
});

export const executionParityProjection = Object.freeze({
	format: "questpie.execution-policy-parity",
	version: 1,
	surfaces: [
		"direct",
		"nested",
		"network",
		"recompute",
		"routeTransition",
		"studio",
		"worker",
	],
	constructor: "applicationExecutionRoot",
	contextInput: "exactGeneratedTransportNeutralInput",
	ordinaryAuthorityDefault: true,
	systemAuthorityFromInput: false,
	policyEngine: "sameCompiledProgram",
});

function readOperand(operand, environment) {
	if (operand.kind === "literal") return operand.value;
	if (operand.kind === "executionFact") {
		return environment.execution[operand.source][operand.path[0]];
	}
	if (operand.kind === "field") {
		return environment.scopes[operand.scope][operand.path[0]];
	}
	throw new Error(`Unsupported operand: ${operand.kind}`);
}

export function evaluateExpression(expression, environment) {
	if (expression.kind === "equal") {
		return (
			readOperand(expression.left, environment) ===
			readOperand(expression.right, environment)
		);
	}
	if (expression.kind === "in") {
		const value = readOperand(expression.operand, environment);
		return expression.values.some((item) => item.value === value);
	}
	if (expression.kind === "and") {
		return expression.items.every((item) =>
			evaluateExpression(item, environment),
		);
	}
	if (expression.kind === "or") {
		return expression.items.some((item) =>
			evaluateExpression(item, environment),
		);
	}
	if (expression.kind === "exists") {
		const rows = environment.store[expression.collection] ?? [];
		return rows.some((row) =>
			evaluateExpression(expression.predicate, {
				...environment,
				scopes: { ...environment.scopes, [expression.scope]: row },
			}),
		);
	}
	throw new Error(`Unsupported expression: ${expression.kind}`);
}

function decisionEnvironment(facts, store, scopes) {
	return { execution: facts, store, scopes };
}

function admission(facts) {
	return facts.principal.kind === "anonymous"
		? { allowed: false, error: "unauthenticated" }
		: { allowed: true, error: null };
}

export function decideMessageRead({ facts, row, selectedPaths, store }) {
	const admitted = admission(facts);
	if (!admitted.allowed) return { outcome: admitted.error };
	const environment = decisionEnvironment(facts, store, { row });
	if (!evaluateExpression(messageReadRows, environment)) {
		return { outcome: "notFound" };
	}
	const result = {};
	for (const selectedPath of selectedPaths) {
		const fieldName = selectedPath[0];
		if (fieldName === "moderationNote") {
			const rule = messagePolicyProgram.fields.selectedOutput[0];
			if (!evaluateExpression(rule.when, environment)) continue;
		}
		result[fieldName] = row[fieldName];
	}
	return { outcome: "allowed", result };
}

export function decideMessageUpdate({
	facts,
	current,
	candidate,
	suppliedPaths,
	store,
}) {
	const admitted = admission(facts);
	if (!admitted.allowed) return { outcome: admitted.error };
	const environment = decisionEnvironment(facts, store, { current, candidate });
	if (!evaluateExpression(updateRows, environment)) {
		return { outcome: "notFound" };
	}
	const updateRules = new Map(
		messagePolicyProgram.fields.callerInput.update.map((rule) => [
			rule.path.join("\0"),
			rule,
		]),
	);
	for (const suppliedPath of suppliedPaths) {
		const rule = updateRules.get(suppliedPath.join("\0"));
		if (rule && !evaluateExpression(rule.when, environment)) {
			return { outcome: "forbiddenField", path: suppliedPath };
		}
	}
	if (!evaluateExpression(candidateInvariant, environment)) {
		return { outcome: "forbiddenCandidate" };
	}
	return { outcome: "allowed" };
}

export function cursorScope(facts) {
	const programDigest = canonicalDigest(
		"questpie-policy-program-v1\0",
		messagePolicyProgram,
	);
	const scope = {
		format: "questpie.policy-cursor-scope",
		version: 1,
		policyProgramDigest: programDigest,
		usedExecutionFacts: {
			authorityKind: facts.authority.kind,
			principalId: facts.principal.id,
			tenantId: facts.tenant.id,
		},
	};
	return {
		...scope,
		digest: canonicalDigest("questpie-policy-cursor-scope-v1\0", scope),
	};
}

export function verifyCursorScope(cursor, facts) {
	return cursor.digest === cursorScope(facts).digest
		? { accepted: true, beforeSql: true }
		: { accepted: false, beforeSql: true, error: "cursorScopeMismatch" };
}

function policyAttachment(collection, policies) {
	const candidates = policies
		.filter((item) => item.target === collection)
		.sort((left, right) => compareAscii(left.identity, right.identity));
	if (candidates.length === 1) return candidates[0].identity;
	return {
		code: candidates.length === 0 ? "QP-POLICY-001" : "QP-POLICY-002",
		class:
			candidates.length === 0
				? "missingDefaultPolicy"
				: "ambiguousDefaultPolicy",
		collection,
		candidates: candidates.map((item) => item.identity),
		failClosed: true,
	};
}

function explainProjection(digests) {
	return {
		format: "questpie.explain",
		version: 1,
		command: "policy",
		identity: "policy:messages.default",
		context: {
			projectionDigest: digests.context,
			bootstrapPlanDigest: digests.bootstrap,
		},
		policy: {
			programDigest: digests.policy,
			evidenceGraphDigest: digests.evidence,
			dependencyDigest: digests.dependencies,
			sqlLoweringDigest: digests.sql,
			nondisclosureDigest: digests.nondisclosure,
			pushdownComplete: true,
			derivedRls: "notEmitted",
		},
		fixedInputs: FIXED_DIGESTS,
	};
}

export function runP2Goldens() {
	assert.equal(FIXED_DIGESTS.schema.length, 64);
	assert.equal(FIXED_DIGESTS.data.length, 64);
	assert.equal(FIXED_DIGESTS.structuralQuery.length, 64);

	assert.equal(evidenceGraph.maximumExistsDepth, 4);
	assert.ok(evidenceGraph.nodeCount <= 128);
	assert.deepEqual(evidenceGraph.collections, [
		"collection:channels",
		"collection:companies",
		"collection:memberships",
		"collection:spaces",
	]);
	assert.ok(evidenceGraph.executionFacts.includes("principal:id"));
	assert.ok(evidenceGraph.executionFacts.includes("tenant:id"));
	assert.ok(evidenceGraph.executionFacts.includes("authority:kind"));

	const serialized = canonicalBytes({
		contextProjection,
		bootstrapProjection,
		messagePolicyProgram,
		archivePolicyProgram,
		evidenceGraph,
		dependencyProjection,
		sqlLowering,
	});
	assert.equal(serialized.includes("rawSql"), true);
	assert.equal(
		bootstrapProjection.forbiddenCapabilities.includes("rawSql"),
		true,
	);
	assert.equal(
		sqlLowering.indexes.every((item) => item.accessMethod === "btree"),
		true,
	);
	assert.equal(sqlLowering.derivedRls.status, "notEmitted");
	assert.equal(sqlLowering.derivedRls.claim, null);
	assert.ok(
		dependencyProjection.changesThatInvalidate.includes("membershipRoleChange"),
	);
	assert.ok(
		dependencyProjection.changesThatInvalidate.includes(
			"membershipStatusChange",
		),
	);

	const store = {
		"collection:companies": [
			{ id: "company-northwind", name: "Northwind" },
			{ id: "company-contoso", name: "Contoso" },
		],
		"collection:spaces": [
			{ id: "space-northwind", companyId: "company-northwind" },
			{ id: "space-contoso", companyId: "company-contoso" },
		],
		"collection:channels": [
			{
				id: "channel-company",
				spaceId: "space-northwind",
				visibility: "company",
			},
			{
				id: "channel-private",
				spaceId: "space-northwind",
				visibility: "private",
			},
			{
				id: "channel-foreign",
				spaceId: "space-contoso",
				visibility: "company",
			},
		],
		"collection:memberships": [
			{
				companyId: "company-northwind",
				principalId: "principal-alice",
				scopeKey: "company",
				status: "active",
				role: "member",
			},
			{
				companyId: "company-northwind",
				principalId: "principal-alice",
				scopeKey: "channel-private",
				status: "active",
				role: "member",
			},
			{
				companyId: "company-northwind",
				principalId: "principal-moderator",
				scopeKey: "company",
				status: "active",
				role: "moderator",
			},
		],
	};
	const alice = {
		principal: { kind: "user", id: "principal-alice" },
		tenant: { id: "company-northwind" },
		authority: { kind: "ordinary" },
	};
	const authorRow = {
		id: "message-1",
		companyId: "company-northwind",
		channelId: "channel-private",
		authorId: "principal-alice",
		body: "hello",
		moderationNote: null,
	};
	const otherRow = { ...authorRow, id: "message-2", authorId: "principal-bob" };
	const invisibleRow = {
		...authorRow,
		id: "message-foreign",
		companyId: "company-contoso",
		channelId: "channel-foreign",
	};

	const ownRead = decideMessageRead({
		facts: alice,
		row: authorRow,
		selectedPaths: [["id"], ["body"], ["moderationNote"]],
		store,
	});
	assert.deepEqual(ownRead, {
		outcome: "allowed",
		result: { id: "message-1", body: "hello", moderationNote: null },
	});
	const otherRead = decideMessageRead({
		facts: alice,
		row: otherRow,
		selectedPaths: [["id"], ["body"], ["moderationNote"]],
		store,
	});
	assert.deepEqual(otherRead, {
		outcome: "allowed",
		result: { id: "message-2", body: "hello" },
	});
	const invisible = decideMessageRead({
		facts: alice,
		row: invisibleRow,
		selectedPaths: [["id"]],
		store,
	});
	assert.deepEqual(invisible, { outcome: "notFound" });
	assert.deepEqual(invisible, {
		outcome: nondisclosureProjection.keyedTarget.missing,
	});

	const sparseAllowed = decideMessageUpdate({
		facts: alice,
		current: authorRow,
		candidate: { ...authorRow, body: "changed" },
		suppliedPaths: [["body"]],
		store,
	});
	assert.deepEqual(sparseAllowed, { outcome: "allowed" });
	const deniedField = decideMessageUpdate({
		facts: alice,
		current: authorRow,
		candidate: { ...authorRow, moderationNote: "secret" },
		suppliedPaths: [["moderationNote"]],
		store,
	});
	assert.deepEqual(deniedField, {
		outcome: "forbiddenField",
		path: ["moderationNote"],
	});
	const deniedCandidate = decideMessageUpdate({
		facts: alice,
		current: authorRow,
		candidate: { ...authorRow, channelId: "channel-foreign" },
		suppliedPaths: [["body"]],
		store,
	});
	assert.deepEqual(deniedCandidate, { outcome: "forbiddenCandidate" });

	const cursor = cursorScope(alice);
	assert.deepEqual(verifyCursorScope(cursor, alice), {
		accepted: true,
		beforeSql: true,
	});
	assert.deepEqual(
		verifyCursorScope(cursor, {
			...alice,
			principal: { kind: "user", id: "principal-bob" },
		}),
		{
			accepted: false,
			beforeSql: true,
			error: "cursorScopeMismatch",
		},
	);
	assert.equal(
		cursor.digest,
		cursorScope({ ...alice, values: { selectedRole: "stale-owner" } }).digest,
		"unused convenience values must not become cursor or Policy authority",
	);

	assert.deepEqual(policyAttachment("collection:messages", []), {
		code: "QP-POLICY-001",
		class: "missingDefaultPolicy",
		collection: "collection:messages",
		candidates: [],
		failClosed: true,
	});
	assert.equal(
		policyAttachment("collection:messages", [
			{ identity: "policy:messages.default", target: "collection:messages" },
		]),
		"policy:messages.default",
	);
	assert.equal(
		policyAttachment("collection:messages", [
			{ identity: "policy:messages.a", target: "collection:messages" },
			{ identity: "policy:messages.b", target: "collection:messages" },
		]).class,
		"ambiguousDefaultPolicy",
	);

	const digests = {
		context: canonicalDigest(
			"questpie-context-projection-v1\0",
			contextProjection,
		),
		bootstrap: canonicalDigest(
			"questpie-context-bootstrap-plan-v1\0",
			bootstrapProjection,
		),
		policy: canonicalDigest(
			"questpie-policy-program-v1\0",
			messagePolicyProgram,
		),
		archivePolicy: canonicalDigest(
			"questpie-policy-program-v1\0",
			archivePolicyProgram,
		),
		evidence: canonicalDigest(
			"questpie-policy-evidence-graph-v1\0",
			evidenceGraph,
		),
		sql: canonicalDigest("questpie-policy-sql-lowering-v1\0", sqlLowering),
		nondisclosure: canonicalDigest(
			"questpie-policy-nondisclosure-v1\0",
			nondisclosureProjection,
		),
		parity: canonicalDigest(
			"questpie-execution-policy-parity-v1\0",
			executionParityProjection,
		),
		dependencies: canonicalDigest(
			"questpie-policy-dependencies-v1\0",
			dependencyProjection,
		),
	};
	const explain = explainProjection(digests);
	digests.explain = canonicalDigest("questpie-explain-v1\0", explain);

	const reversed = canonicalValue({
		executionParityProjection,
		dependencyProjection,
		nondisclosureProjection,
		sqlLowering,
		evidenceGraph,
		archivePolicyProgram,
		messagePolicyProgram,
		bootstrapProjection,
		contextProjection,
	});
	const forward = canonicalValue({
		contextProjection,
		bootstrapProjection,
		messagePolicyProgram,
		archivePolicyProgram,
		evidenceGraph,
		sqlLowering,
		nondisclosureProjection,
		executionParityProjection,
		dependencyProjection,
	});
	assert.deepEqual(reversed, forward);

	return {
		digests,
		artifacts: {
			contextProjection,
			bootstrapProjection,
			messagePolicyProgram,
			archivePolicyProgram,
			evidenceGraph,
			sqlLowering,
			nondisclosureProjection,
			executionParityProjection,
			dependencyProjection,
			explain,
		},
		decisions: {
			ownRead,
			otherRead,
			invisible,
			sparseAllowed,
			deniedField,
			deniedCandidate,
			cursorAccepted: verifyCursorScope(cursor, alice),
		},
	};
}

if (import.meta.main) {
	const result = runP2Goldens();
	console.log(JSON.stringify({ digests: result.digests }, null, 2));
	console.log("P2 Context and Policy canonical goldens: pass");
}
