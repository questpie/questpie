type JsonRecord = Readonly<Record<string, unknown>>;

export interface SchemaFingerprintV1 extends JsonRecord {
	readonly format: "questpie.schema-fingerprint";
	readonly version: 1;
	readonly comparable: JsonRecord;
	readonly observations: Readonly<{
		serverVersion: string;
		databaseCollation: string;
		databaseCType: string;
		databaseEncoding: string;
		binaryCollationProvider: string;
		binaryCollationDeterministic: boolean;
		extensions: readonly Readonly<{
			name: string;
			installedVersion: string;
		}>[];
	}>;
}

export interface ApplyMigrationsResult {
	readonly status: "applied" | "alreadyApplied";
	readonly applied: readonly string[];
	readonly head: string;
	readonly fingerprintDigest: string;
}
