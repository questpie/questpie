export const LIFECYCLE_PROGRAM_FORMAT =
	"questpie.lifecycle-program.v1" as const;
export const LIFECYCLE_INTERPRETER =
	"questpie.lifecycle-interpreter.v1" as const;

export type LifecyclePhase = "normalize" | "validate" | "check" | "afterWrite";
export type LifecycleIdentity =
	`${"schema" | "collection" | "field" | "issue" | "query" | "mutation" | "operation" | "job"}:${string}`;
export type LifecycleScalar = null | boolean | number | string;

export type LifecycleExpression =
	| Readonly<{ op: "literal"; value: LifecycleScalar }>
	| Readonly<{
			op: "root";
			root:
				| "input"
				| "candidate"
				| "current"
				| "written"
				| "previous"
				| "now"
				| "callId";
	  }>
	| Readonly<{ op: "local"; slot: number }>
	| Readonly<{ op: "optionalBoundary"; value: LifecycleExpression }>
	| Readonly<{
			op: "member";
			target: LifecycleExpression;
			field: LifecycleIdentity;
			optional: boolean;
	  }>
	| Readonly<{
			op: "unary";
			operator: "!" | "-";
			value: LifecycleExpression;
	  }>
	| Readonly<{
			op: "binary";
			operator:
				| "+"
				| "-"
				| "*"
				| "/"
				| "%"
				| "==="
				| "!=="
				| "<"
				| "<="
				| ">"
				| ">="
				| "&&"
				| "||"
				| "??";
			left: LifecycleExpression;
			right: LifecycleExpression;
	  }>
	| Readonly<{
			op: "conditional";
			test: LifecycleExpression;
			yes: LifecycleExpression;
			no: LifecycleExpression;
	  }>
	| Readonly<{ op: "array"; values: readonly LifecycleExpression[] }>
	| Readonly<{ op: "object"; entries: readonly LifecycleObjectEntry[] }>
	| Readonly<{
			op: "template";
			head: string;
			spans: readonly Readonly<{
				value: LifecycleExpression;
				tail: string;
			}>[];
	  }>
	| Readonly<{
			op: "stringMethod";
			method:
				| "trim"
				| "toUpperCase"
				| "toLowerCase"
				| "startsWith"
				| "endsWith"
				| "includes";
			target: LifecycleExpression;
			arguments: readonly LifecycleExpression[];
			optional: boolean;
	  }>
	| Readonly<{
			op: "capability";
			capability: "read" | "write";
			identity: LifecycleIdentity;
			arguments: readonly LifecycleExpression[];
	  }>;

export type LifecycleObjectEntry =
	| Readonly<{
			kind: "field";
			field: LifecycleIdentity;
			value: LifecycleExpression;
	  }>
	| Readonly<{
			kind: "argument";
			key: string;
			value: LifecycleExpression;
	  }>
	| Readonly<{ kind: "spreadInput" }>;

export type LifecycleStatement =
	| Readonly<{ op: "const"; slot: number; value: LifecycleExpression }>
	| Readonly<{
			op: "if";
			test: LifecycleExpression;
			consequent: readonly LifecycleStatement[];
			otherwise: readonly LifecycleStatement[];
	  }>
	| Readonly<{ op: "return"; value: LifecycleExpression | null }>
	| Readonly<{ op: "throwIssue"; issue: LifecycleIdentity }>
	| Readonly<{
			op: "effect";
			value: Extract<LifecycleExpression, { op: "capability" }>;
	  }>;

export type LifecycleCapabilityBinding =
	| Readonly<{
			kind: "read";
			identity: LifecycleIdentity;
			argumentKeys: readonly string[];
			cardinality: "one" | "many";
			first: boolean;
			maxRows: number;
	  }>
	| Readonly<{
			kind: "write";
			identity: LifecycleIdentity;
			argumentKeys: readonly string[];
	  }>;

export interface LifecycleBindings {
	readonly schema: LifecycleIdentity;
	readonly collection: LifecycleIdentity;
	readonly fields: Readonly<Record<string, LifecycleIdentity>>;
	readonly issues: Readonly<Record<string, LifecycleIdentity>>;
	readonly capabilities: Readonly<Record<string, LifecycleCapabilityBinding>>;
	readonly operations: readonly LifecycleIdentity[];
	readonly jobs: readonly LifecycleIdentity[];
}

export interface CollectionLifecycleProgramV1 {
	readonly format: typeof LIFECYCLE_PROGRAM_FORMAT;
	readonly interpreter: typeof LIFECYCLE_INTERPRETER;
	readonly runtimeBuild: string;
	readonly reentryLimit: number;
	readonly bindings: LifecycleBindings;
	readonly phases: Readonly<
		Record<LifecyclePhase, readonly LifecycleStatement[]>
	>;
	readonly digest: string;
}

export interface CollectionLifecycleProgramsV1 {
	readonly format: "questpie.collection-lifecycle-programs";
	readonly version: 1;
	readonly programs: readonly CollectionLifecycleProgramV1[];
}
