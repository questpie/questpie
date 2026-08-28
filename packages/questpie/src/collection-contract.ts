import type { CheckConstraintDefinition } from "./check-expression";
import type {
	CollectionRowFor,
	CollectionInputCodec,
	CreatePropertiesFor,
	UpdatePropertiesFor,
} from "./collection-input";
import type { CollectionListAuthoring } from "./relational/query";
import type { FieldNode } from "./shape";

export type FieldReference = string | readonly [string, ...string[]];

export interface ConstraintDefinition<
	Fields extends readonly FieldReference[] = readonly never[],
	Kind extends "primaryKey" | "unique" = "primaryKey" | "unique",
> {
	readonly kind: Kind;
	readonly fields: Fields;
	readonly postgresName: string | null;
}

export type ConstraintMemberDefinition =
	| ConstraintDefinition<readonly FieldReference[]>
	| CheckConstraintDefinition;

export type IndexField =
	| FieldReference
	| Readonly<{
			field: FieldReference;
			order?: "asc" | "desc";
			nulls?: "first" | "last";
	  }>;

export interface IndexDefinition<
	Fields extends readonly IndexField[] = readonly never[],
> {
	readonly kind: "btree";
	readonly fields: Fields;
	readonly postgresName: string | null;
}

export interface RelationDefinition<
	Target extends `collection:${string}` = `collection:${string}`,
	Fields extends readonly FieldReference[] = readonly FieldReference[],
	References extends readonly FieldReference[] = readonly FieldReference[],
	TargetCollection = unknown,
> {
	readonly kind: "toOne";
	readonly target: Target;
	readonly fields: Fields;
	readonly references: References;
	readonly onDelete: "restrict" | "cascade" | "setNull" | "noAction";
	readonly onUpdate: "restrict" | "cascade" | "setNull" | "noAction";
	readonly postgresName: string | null;
	/** Type-only target shape used by Collection-owned relational authoring. */
	readonly __targetCollection?: TargetCollection;
}

export type RelationReference<
	Name extends string = string,
	Member extends string = string,
> = `collection:${Name}/relation:${Member}`;

export interface InverseRelationDefinition<
	InverseOf extends RelationReference = RelationReference,
> {
	readonly kind: "toMany";
	readonly inverseOf: InverseOf;
}

interface DefinitionBrand {
	readonly category: "definition";
	readonly resourceKind: "collection" | "seed";
}

declare const collectionIssueDeclarationBrand: unique symbol;
declare const collectionIssueValueBrand: unique symbol;

export interface CollectionIssueDefinition {
	readonly kind: "collectionIssue";
	readonly [collectionIssueDeclarationBrand]: true;
}

export interface CollectionIssueValue {
	readonly [collectionIssueValueBrand]: true;
}

export type CollectionIssueDeclarations = Readonly<
	Record<string, CollectionIssueDefinition>
>;

export type CollectionIssueFactories<
	Issues extends CollectionIssueDeclarations,
> = Readonly<{
	[Key in keyof Issues]: () => CollectionIssueValue;
}>;

export interface CollectionLifecycleDefinition<
	Fields extends Readonly<Record<string, FieldNode>>,
	Issues extends CollectionIssueDeclarations,
> {
	readonly normalize?: (
		input: Readonly<{
			input: Readonly<Partial<CollectionRowFor<Fields>>>;
		}>,
	) => Readonly<Partial<CollectionRowFor<Fields>>>;
	readonly validate?: (
		input: Readonly<{
			candidate: CollectionRowFor<Fields>;
			current: CollectionRowFor<Fields> | null;
			now: Date;
			issues: CollectionIssueFactories<Issues>;
		}>,
	) => void;
}

interface AugmentationBrand {
	readonly category: "augmentation";
	readonly resourceKind: "collection";
}

export interface CollectionAugmentation<
	Name extends string = string,
	Fields extends Readonly<Record<string, FieldNode>> = Readonly<
		Record<never, never>
	>,
	Constraints extends Readonly<Record<string, ConstraintMemberDefinition>> =
		Readonly<Record<never, never>>,
	Indexes extends Readonly<
		Record<string, { readonly fields: readonly IndexField[] }>
	> = Readonly<Record<never, never>>,
> {
	readonly __questpie: AugmentationBrand;
	readonly name: Name;
	readonly fields: Fields;
	readonly constraints: Constraints;
	readonly indexes: Indexes;
}

export interface CollectionDefinition<
	Name extends string = string,
	Fields extends Readonly<Record<string, FieldNode>> = Readonly<
		Record<never, never>
	>,
	Constraints extends Readonly<Record<string, ConstraintMemberDefinition>> =
		Readonly<Record<never, never>>,
	Indexes extends Readonly<
		Record<string, { readonly fields: readonly IndexField[] }>
	> = Readonly<Record<never, never>>,
	Relations extends Readonly<
		Record<string, RelationDefinition | InverseRelationDefinition>
	> = Readonly<Record<never, never>>,
	Issues extends CollectionIssueDeclarations = Readonly<Record<never, never>>,
> {
	readonly __questpie: DefinitionBrand;
	readonly name: Name;
	readonly fields: Fields;
	readonly constraints: Constraints;
	readonly indexes: Indexes;
	readonly relations: Relations;
	readonly issues: Issues;
	readonly augmentations: readonly CollectionAugmentation[];
	readonly postgresName: string | null;
	readonly list: CollectionListAuthoring<Fields, Relations>;
	createInput(): CollectionInputCodec<CreatePropertiesFor<Fields>>;
	updateInput(): CollectionInputCodec<UpdatePropertiesFor<Fields>>;
}
