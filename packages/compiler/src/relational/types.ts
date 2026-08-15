export type CollectionIdentity = `collection:${string}`;
export type FieldIdentity = `collection:${string}/field:${string}`;
export type RelationIdentity = `collection:${string}/relation:${string}`;
export type ConstraintIdentity = `collection:${string}/constraint:${string}`;
export type PolicyIdentity = `policy:${string}`;

export type ScalarCodecV1 =
	| Readonly<{ kind: "uuid" }>
	| Readonly<{
			kind: "text";
			minLength: number | null;
			maxLength: number | null;
			collation: "questpie.binary";
	  }>
	| Readonly<{ kind: "boolean" }>
	| Readonly<{
			kind: "integer";
			minimum: number | null;
			maximum: number | null;
	  }>
	| Readonly<{ kind: "bigint"; minimum: string | null; maximum: string | null }>
	| Readonly<{ kind: "numeric"; precision: number; scale: number }>
	| Readonly<{ kind: "timestamp"; withTimezone: boolean }>
	| Readonly<{ kind: "date" }>;

export type QueryOperandV1 =
	| Readonly<{
			kind: "literal";
			codec: ScalarCodecV1;
			value: boolean | number | string;
	  }>
	| Readonly<{ kind: "parameter"; parameter: string }>;

export type ScalarQueryFilterV1 =
	| Readonly<{
			kind:
				| "equal"
				| "notEqual"
				| "lessThan"
				| "lessThanOrEqual"
				| "greaterThan"
				| "greaterThanOrEqual";
			field: FieldIdentity;
			operand: QueryOperandV1;
	  }>
	| Readonly<{
			kind: "in" | "notIn";
			field: FieldIdentity;
			set:
				| Readonly<{
						kind: "literal";
						codec: ScalarCodecV1;
						values: readonly (boolean | number | string)[];
				  }>
				| Readonly<{ kind: "parameter"; parameter: string }>;
	  }>
	| Readonly<{ kind: "isNull" | "isNotNull"; field: FieldIdentity }>;

export type RelatedQueryFilterV1 =
	| ScalarQueryFilterV1
	| Readonly<{
			kind: "and" | "or";
			expressions: readonly RelatedQueryFilterV1[];
	  }>
	| Readonly<{ kind: "not"; expression: RelatedQueryFilterV1 }>;

export type RootQueryFilterV1 =
	| ScalarQueryFilterV1
	| Readonly<{
			kind: "and" | "or";
			expressions: readonly RootQueryFilterV1[];
	  }>
	| Readonly<{ kind: "not"; expression: RootQueryFilterV1 }>
	| Readonly<{
			kind: "relationExists" | "relationNotExists";
			relation: RelationIdentity;
			filter: RelatedQueryFilterV1 | Readonly<{ kind: "true" }>;
	  }>;

export interface FieldQuerySelectionV1 {
	readonly kind: "field";
	readonly key: string;
	readonly field: FieldIdentity;
}

export type RootQuerySelectionV1 =
	| FieldQuerySelectionV1
	| Readonly<{
			kind: "toOne";
			key: string;
			relation: RelationIdentity;
			select: readonly FieldQuerySelectionV1[];
	  }>;

export type QueryParameterV1 =
	| Readonly<{
			name: string;
			kind: "scalar";
			codec: ScalarCodecV1;
			nullable: false;
	  }>
	| Readonly<{
			name: string;
			kind: "list";
			codec: ScalarCodecV1;
			maximumItems: number;
			nullable: false;
			semantics: "set";
	  }>
	| Readonly<{ name: string; kind: "cursor"; nullable: true }>;

export interface DataQueryTemplateV1 {
	readonly format: "questpie.data-query-template";
	readonly version: 1;
	readonly from: CollectionIdentity;
	readonly schemaProjectionDigest: string;
	readonly dataContractProjectionDigest: string;
	readonly parameters: readonly QueryParameterV1[];
	readonly select: readonly RootQuerySelectionV1[];
	readonly filter: RootQueryFilterV1 | null;
	readonly order: readonly Readonly<{
		field: FieldIdentity;
		direction: "asc" | "desc";
		nulls: "first" | "last";
	}>[];
	readonly page: Readonly<{
		kind: "forwardCursor";
		first: Readonly<{ kind: "parameter"; parameter: string }>;
		after: Readonly<{ kind: "parameter"; parameter: string }>;
		uniqueConstraint: ConstraintIdentity;
	}>;
}

export type PolicyOperandV1 =
	| Readonly<{
			kind: "field";
			scope: string;
			collection: CollectionIdentity;
			path: readonly string[];
			codec: string;
	  }>
	| Readonly<{
			kind: "executionFact";
			source: "authority" | "principal" | "tenant";
			path: readonly string[];
			codec: string;
	  }>
	| Readonly<{
			kind: "literal";
			codec: string;
			value: boolean | number | string | null;
	  }>;

export type PolicyExpressionV1 =
	| Readonly<{ kind: "constant"; value: boolean }>
	| Readonly<{
			kind: "equal" | "notEqual";
			left: PolicyOperandV1;
			right: PolicyOperandV1;
	  }>
	| Readonly<{
			kind: "in";
			operand: PolicyOperandV1;
			values: readonly Extract<PolicyOperandV1, { kind: "literal" }>[];
	  }>
	| Readonly<{
			kind: "and" | "or";
			items: readonly PolicyExpressionV1[];
	  }>
	| Readonly<{ kind: "not"; expression: PolicyExpressionV1 }>
	| Readonly<{
			kind: "exists";
			collection: CollectionIdentity;
			scope: string;
			semantics: "policyEvidenceBooleanOnly";
			targetDisclosurePolicy: "notApplied";
			predicate: PolicyExpressionV1;
	  }>;

export type PolicyAdmissionV1 = Readonly<{
	kind: "authenticated" | "public" | "system";
}>;

type PolicyCandidateV1 =
	| PolicyExpressionV1
	| Readonly<{ kind: "sameRelationalScopeAsRead" }>;

export interface PolicyOperationsV1 {
	readonly read?: Readonly<{
		admission: PolicyAdmissionV1;
		rows: PolicyExpressionV1;
	}>;
	readonly create?: Readonly<{
		admission: PolicyAdmissionV1;
		candidate: PolicyCandidateV1;
	}>;
	readonly update?: Readonly<{
		admission: PolicyAdmissionV1;
		current: PolicyExpressionV1;
		candidate: PolicyCandidateV1;
	}>;
	readonly delete?: Readonly<{
		admission: PolicyAdmissionV1;
		current: PolicyExpressionV1;
	}>;
}

export interface PolicyFieldRuleV1 {
	readonly path: readonly string[];
	readonly when: PolicyExpressionV1;
	readonly deniedEncoding?: "omitProperty";
}

export interface PolicyFieldsV1 {
	readonly callerInput: Readonly<{
		create?: readonly PolicyFieldRuleV1[];
		update?: readonly PolicyFieldRuleV1[];
		suppliedPathsOnly: true;
	}>;
	readonly selectedOutput: readonly PolicyFieldRuleV1[];
}

export interface PolicyProgramV1 {
	readonly format: "questpie.policy-program";
	readonly version: 1;
	readonly identity: PolicyIdentity;
	readonly target: CollectionIdentity;
	readonly attachment: Readonly<{
		kind: "default";
		requiredForNormalDataAccess: true;
	}>;
	readonly operations: PolicyOperationsV1;
	readonly limits?: Readonly<{
		maximumExistsDepth: number;
		maximumNodes: number;
		maximumEvidenceCollections: number;
		maximumFieldRules: number;
		maximumSqlBytes: number;
	}>;
	readonly fields?: PolicyFieldsV1;
	readonly phaseOrder?: Readonly<{
		root: readonly string[];
		keyedRead: readonly string[];
		createPolicyBoundary: readonly string[];
		updatePolicyBoundary: readonly string[];
	}>;
	readonly evidenceUse?: Readonly<{
		allowedAsBooleanOnly: true;
		targetDisclosurePolicyApplied: false;
	}>;
	readonly disclosureUse?: Readonly<{
		targetDisclosurePolicyApplied: true;
		ordinaryAuthorityRows: "none";
	}>;
}
