export type JsonRecord = Readonly<Record<string, unknown>>;

export interface CatalogAccumulator {
	readonly objects: JsonRecord[];
	readonly unsupportedObjects: JsonRecord[];
	readonly dependencies: Map<string, JsonRecord>;
}

export interface CatalogTable {
	readonly name: string;
}

export interface CatalogColumn {
	readonly name: string;
	readonly nullable: boolean;
}
