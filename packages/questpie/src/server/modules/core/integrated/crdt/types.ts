import type {
	IsEligibleCrdtSetField,
	IsEligibleCrdtTextField,
} from "#questpie/server/fields/field-class-types.js";

import type { CrdtAwarenessOfOwner } from "./capability.js";

type EntityState<TEntity> = TEntity extends { state: infer TState }
	? TState
	: never;

type EntityFieldDefinitions<TEntity> =
	EntityState<TEntity> extends {
		fieldDefinitions: infer TFields;
	}
		? TFields extends Record<string, unknown>
			? TFields
			: {}
		: {};

type CrdtFieldDefinitionFromField<TField> =
	IsEligibleCrdtTextField<TField> extends true
		? { format: "text"; value: string }
		: IsEligibleCrdtSetField<TField> extends true
			? { format: "set"; conflict: "add-wins"; value: string[] }
			: never;

export type CrdtFieldRegistryFromEntity<TEntity> = {
	[TField in keyof EntityFieldDefinitions<TEntity> as CrdtFieldDefinitionFromField<
		EntityFieldDefinitions<TEntity>[TField]
	> extends never
		? never
		: TField]: CrdtFieldDefinitionFromField<
		EntityFieldDefinitions<TEntity>[TField]
	>;
};

type CrdtOwnerRegistryFromEntities<
	TEntities extends Record<string, unknown> | undefined,
> =
	TEntities extends Record<string, unknown>
		? {
				[TKey in keyof TEntities as EntityState<TEntities[TKey]> extends {
					collaborative: Record<string, unknown>;
				}
					? keyof CrdtFieldRegistryFromEntity<TEntities[TKey]> extends never
						? never
						: TKey
					: never]: {
					ownerName: EntityState<TEntities[TKey]> extends { name: infer TName }
						? TName
						: never;
					awareness: CrdtAwarenessOfOwner<TEntities[TKey]>;
					fields: CrdtFieldRegistryFromEntity<TEntities[TKey]>;
				};
			}
		: {};

export type CrdtRegistryFromApp<TApp> = TApp extends {
	collections: infer TCollections;
	globals?: infer TGlobals;
}
	? {
			collections: CrdtOwnerRegistryFromEntities<
				TCollections extends Record<string, unknown> ? TCollections : {}
			>;
			globals: CrdtOwnerRegistryFromEntities<
				TGlobals extends Record<string, unknown> ? TGlobals : {}
			>;
		}
	: { collections: {}; globals: {} };

export type CrdtOwnerLocator = { id: string | number };
export type CrdtFieldGrant = "view" | "edit";

export type CrdtTextOperation =
	| { type: "insert"; index: number; value: string }
	| { type: "delete"; index: number; length: number };
export type CrdtSetOperation<T extends string> =
	| { type: "add"; value: T }
	| { type: "delete"; value: T };

export interface CrdtTextReplica {
	value(): string;
	apply(operations: readonly CrdtTextOperation[]): void;
}

export interface CrdtSetReplica<T extends string> {
	values(): readonly T[];
	has(value: T): boolean;
	add(value: T): void;
	delete(value: T): void;
	apply(operations: readonly CrdtSetOperation<T>[]): void;
}

export interface CrdtTextFieldPort {
	readonly format: "text";
	readonly text: CrdtTextReplica;
}

export interface CrdtSetFieldPort<T extends string> {
	readonly format: "set";
	readonly set: CrdtSetReplica<T>;
}

export type CrdtAwarenessPort<TAwareness> = [TAwareness] extends [never]
	? { readonly enabled: false }
	: {
			readonly enabled: true;
			set(value: TAwareness): void;
			clear(): void;
		};

export type CrdtNonReadyDocumentState =
	| { status: "authorizing" }
	| { status: "connecting" }
	| { status: "synchronizing"; requestedMode: "view" | "edit" }
	| {
			status: "recovery-required";
			reason:
				| "epoch_changed"
				| "offline_horizon_expired"
				| "pending_update_rejected"
				| "owner_retired"
				| "field_contract_changed"
				| "queue_limit"
				| "local_store_corrupt";
			pendingUpdates: number;
	  }
	| {
			status: "suspended";
			reason: "canonical_conflict" | "aggregate_limit" | "engine_quarantined";
			pendingUpdates: number;
			readable: true;
	  }
	| {
			status: "denied";
			code: "CRDT_UNAVAILABLE" | "CRDT_EDIT_NOT_ALLOWED";
	  }
	| {
			status: "failed";
			code:
				| "CRDT_PROTOCOL_REJECTED"
				| "CRDT_RATE_LIMITED"
				| "CRDT_TRANSPORT_UNAVAILABLE";
			retryable: boolean;
	  }
	| { status: "closed" };

export type CrdtDocumentState<K extends PropertyKey> =
	| { status: "idle" }
	| {
			status: "ready";
			fieldGrants: Readonly<Partial<Record<K, CrdtFieldGrant>>>;
			fieldSyncing: readonly K[];
			pendingUpdates: number;
	  }
	| {
			status: "offline";
			fieldGrants: Readonly<Partial<Record<K, CrdtFieldGrant>>>;
			pendingUpdates: number;
	  }
	| CrdtNonReadyDocumentState;

type CrdtClientFieldPort<TDefinition> = TDefinition extends {
	format: "text";
}
	? CrdtTextFieldPort
	: TDefinition extends {
				format: "set";
				value: (infer TValue extends string)[];
		  }
		? CrdtSetFieldPort<TValue>
		: never;

type CrdtClientFields<TOwner> = TOwner extends { fields: infer TFields }
	? { [TField in keyof TFields]: CrdtClientFieldPort<TFields[TField]> }
	: never;

export interface CrdtAggregateDocument<
	TFields extends Record<string, CrdtTextFieldPort | CrdtSetFieldPort<string>>,
	TAwareness,
> {
	readonly fields: TFields;
	readonly replicaRevision: number;
	readonly awareness: CrdtAwarenessPort<TAwareness>;
	getSnapshot(): CrdtDocumentState<keyof TFields>;
	subscribe(
		listener: (state: CrdtDocumentState<keyof TFields>) => void,
	): () => void;
	connect(options: { mode: "view" | "edit"; fallback?: "view" }): Promise<void>;
	disconnect(): Promise<void>;
	close(): Promise<void>;
	transaction(callback: (tx: { readonly fields: TFields }) => void): void;
}

type CrdtClientOwnerAPI<
	TOwner,
	TOwnerKind extends "collection" | "global",
> = TOwner extends { awareness: infer TAwareness }
	? TOwnerKind extends "collection"
		? {
				document(
					locator: CrdtOwnerLocator,
				): CrdtAggregateDocument<CrdtClientFields<TOwner>, TAwareness>;
			}
		: {
				document(): CrdtAggregateDocument<CrdtClientFields<TOwner>, TAwareness>;
			}
	: never;

type CrdtClientOwnersAPI<
	TOwners,
	TOwnerKind extends "collection" | "global",
> = {
	[TOwner in keyof TOwners]: CrdtClientOwnerAPI<TOwners[TOwner], TOwnerKind>;
};

export type CrdtClientAPI<TRegistry extends CrdtRegistryShape> = {
	collections: CrdtClientOwnersAPI<TRegistry["collections"], "collection">;
	globals: CrdtClientOwnersAPI<TRegistry["globals"], "global">;
};

export type CrdtEpoch = string;
export type CrdtCursor = string;
export type CrdtReplaceReason = "agent" | "import" | "restore" | "resolve";
export type CrdtAuthoritySubject =
	| { kind: "human"; subjectId: string }
	| { kind: "agent"; issuer: string; subjectId: string };

declare const crdtAuthorityTargetBrand: unique symbol;
export interface CrdtAuthorityTarget {
	readonly [crdtAuthorityTargetBrand]: never;
}

export interface CrdtServerFieldStatus<TFormat extends "text" | "set"> {
	format: TFormat;
	fieldEpoch: CrdtEpoch;
	headCursor: CrdtCursor;
	projectedCursor: CrdtCursor;
	canonicalRevision: string;
	status: "active" | "retired" | "write_suspended";
}

type CrdtServerFieldDefinition = {
	format: "text" | "set";
	value: unknown;
};

export interface CrdtServerField<
	TDefinition extends CrdtServerFieldDefinition,
> {
	status(): Promise<CrdtServerFieldStatus<TDefinition["format"]>>;
	replace(input: {
		value: TDefinition["value"];
		expected: { fieldEpoch: CrdtEpoch; canonicalRevision: string };
		reason: CrdtReplaceReason;
	}): Promise<CrdtServerFieldStatus<TDefinition["format"]>>;
	authorityTarget(input: {
		subject: CrdtAuthoritySubject;
		capability: "read" | "edit";
	}): CrdtAuthorityTarget;
	revoke(input: {
		subject: CrdtAuthoritySubject;
		capability: "read" | "edit";
		tx: unknown;
	}): Promise<CrdtServerFieldStatus<TDefinition["format"]>>;
}

export interface CrdtServerDocumentStatus<
	TFields extends Record<string, CrdtServerFieldDefinition>,
> {
	status: "active" | "retired" | "write_suspended";
	aggregateEpoch: CrdtEpoch;
	headCommit: CrdtCursor;
	projectedCommit: CrdtCursor;
	fields: Partial<{
		[K in keyof TFields]: CrdtServerFieldStatus<TFields[K]["format"]>;
	}>;
}

export interface CrdtServerDocument<
	TFields extends Record<string, CrdtServerFieldDefinition>,
> {
	readonly fields: {
		[K in keyof TFields]: CrdtServerField<TFields[K]>;
	};
	status(): Promise<CrdtServerDocumentStatus<TFields>>;
	replace(input: {
		fields: { [K in keyof TFields]: TFields[K]["value"] };
		expected: {
			aggregateEpoch: CrdtEpoch;
			canonicalRevisions: { [K in keyof TFields]: string };
		};
		reason: CrdtReplaceReason;
	}): Promise<CrdtServerDocumentStatus<TFields>>;
	authorityTarget(input: {
		subject: CrdtAuthoritySubject;
		capability: "read" | "edit";
	}): CrdtAuthorityTarget;
	revoke(input: {
		subject: CrdtAuthoritySubject;
		capability: "read" | "edit";
		tx: unknown;
	}): Promise<CrdtServerDocumentStatus<TFields>>;
}

type CrdtServerFields<TOwner> = TOwner extends {
	fields: infer TFields extends Record<string, CrdtServerFieldDefinition>;
}
	? TFields
	: never;

type CrdtServerOwnerAPI<
	TOwner,
	TOwnerKind extends "collection" | "global",
> = TOwnerKind extends "collection"
	? {
			document(
				locator: CrdtOwnerLocator,
			): CrdtServerDocument<CrdtServerFields<TOwner>>;
		}
	: {
			document(): CrdtServerDocument<CrdtServerFields<TOwner>>;
		};

type CrdtServerOwnersAPI<
	TOwners,
	TOwnerKind extends "collection" | "global",
> = {
	[TOwner in keyof TOwners]: CrdtServerOwnerAPI<TOwners[TOwner], TOwnerKind>;
};

export type CrdtServerAPI<TRegistry extends CrdtRegistryShape> = {
	collections: CrdtServerOwnersAPI<TRegistry["collections"], "collection">;
	globals: CrdtServerOwnersAPI<TRegistry["globals"], "global">;
	withAuthorityMutation<TResult>(
		targets: readonly CrdtAuthorityTarget[],
		mutation: (tx: unknown) => TResult | Promise<TResult>,
	): Promise<TResult>;
};

export type CrdtRegistryShape = {
	collections: Record<string, unknown>;
	globals: Record<string, unknown>;
};
