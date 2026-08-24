import {
	definePostgresStatement,
	type PostgresStatement,
} from "@questpie/runtime/bundle-core";

const definition = {
	name: "readiness.type-hostile",
	text: "SELECT 1",
	parameterCount: 0,
	parameters: (_input: void) => [],
	decode: () => undefined,
} as const;

function acceptsRuntimeStatement(
	_statement: PostgresStatement<void, void>,
): void {}

// @ts-expect-error an unbranded compiler descriptor cannot enter Runtime SQL
acceptsRuntimeStatement(definition);
acceptsRuntimeStatement(definePostgresStatement(definition));
