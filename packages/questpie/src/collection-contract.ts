import type { CheckConstraintDefinition } from "./check-expression";
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
> {
	readonly kind: "toOne";
	readonly target: Target;
	readonly fields: Fields;
	readonly references: References;
	readonly onDelete: "restrict" | "cascade" | "setNull" | "noAction";
	readonly onUpdate: "restrict" | "cascade" | "setNull" | "noAction";
	readonly postgresName: string | null;
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
> {
	readonly __questpie: DefinitionBrand;
	readonly name: Name;
	readonly fields: Fields;
	readonly constraints: Constraints;
	readonly indexes: Indexes;
	readonly relations: Relations;
	readonly augmentations: readonly CollectionAugmentation[];
	readonly postgresName: string | null;
}
