import {
	inspectSchemaFingerprint,
	type SchemaProjectionV1,
} from "@questpie/compiler";

const schema = {
	application: {
		name: "genesis-probe",
		postgresSchema: "genesis_probe",
	},
	collections: [],
	format: "questpie.schema-projection",
	requiredPostgres: {
		databaseCType: "C.UTF-8",
		databaseCollation: "C.UTF-8",
		extensions: [],
		minimumMajor: 16,
	},
	version: 1,
} as const satisfies SchemaProjectionV1;

try {
	const inspected = await inspectSchemaFingerprint({ schema });
	console.log(
		JSON.stringify({
			ok: true,
			comparable: inspected.fingerprint.comparable,
		}),
	);
} catch (error) {
	console.log(
		JSON.stringify({
			ok: false,
			code: errorCode(error, "code"),
			diagnosticClass: errorCode(error, "diagnosticClass"),
		}),
	);
}

function errorCode(error: unknown, key: string): unknown {
	return error && typeof error === "object" && key in error
		? error[key as keyof typeof error]
		: undefined;
}
