export interface ApplicationConfiguration {
	readonly $schema: string;
	readonly version: 1;
	readonly application: Readonly<{ name: string }>;
	readonly postgres: Readonly<{
		schema: string;
		minimumMajor: 16;
		databaseCollation: string;
		databaseCType: string;
		extensions: readonly string[];
		physicalNames: Readonly<Record<string, string>>;
	}>;
	readonly source: Readonly<{ root: string; exclude: readonly string[] }>;
	readonly packages: Readonly<
		Record<string, Readonly<{ inventoryDigest: string }>>
	>;
}

export interface PackageResolution {
	readonly id: string;
	readonly name: string;
	readonly version: string;
	readonly resolution: "workspace";
	readonly integrity: null;
	readonly commit: null;
	readonly contentDigest: string;
	readonly root: string;
	readonly entry: string;
}

export interface EvaluatedExport {
	readonly logicalPath: string;
	readonly exportName: string;
	readonly value: Readonly<Record<string, unknown>>;
	readonly span: SourceSpan | null;
	readonly memberSpans: Readonly<Record<string, SourceSpan>>;
	readonly acceptanceSpans: readonly (SourceSpan | null)[];
	readonly packageId: string | null;
}

export interface SourceSpan {
	readonly start: Readonly<{ line: number; column: number }>;
	readonly end: Readonly<{ line: number; column: number }>;
}

export interface PackageInventoryEntry {
	readonly exportName: string;
	readonly category: "definition" | "augmentation";
	readonly resourceKind: string;
	readonly identity: string;
	readonly structuralContractDigest: string;
}

export interface PackageInventory {
	readonly package: PackageResolution;
	readonly entries: readonly PackageInventoryEntry[];
	readonly digest: string;
}

export interface NormalizedResource {
	readonly identity: string;
	readonly kind: string;
	readonly name: string;
	readonly contract: Readonly<Record<string, unknown>>;
	readonly contributions: readonly Readonly<{
		identity: string;
		structuralContractDigest: string;
		packageId: string;
		logicalPath: string;
		exportName: string;
		definedSpan: SourceSpan | null;
		acceptedSpan: SourceSpan | null;
		memberSpans: Readonly<Record<string, SourceSpan>>;
	}>[];
	readonly origin: Readonly<{
		logicalPath: string;
		exportName: string;
		packageId: string | null;
		span: SourceSpan | null;
		memberSpans: Readonly<Record<string, SourceSpan>>;
	}>;
	readonly value: Readonly<Record<string, unknown>>;
}
