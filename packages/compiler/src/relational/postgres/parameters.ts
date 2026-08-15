import { canonicalBytes } from "../../canonical";
import { postgresType } from "./model";

export type PostgresQueryParameterV1 =
	| Readonly<{
			position: number;
			kind: "cursorPresent";
			parameter: string;
			postgresType: "boolean";
	  }>
	| Readonly<{
			position: number;
			kind: "cursorValue";
			parameter: string;
			field: string;
			postgresType: string;
	  }>
	| Readonly<{
			position: number;
			kind: "executionFact";
			source: string;
			path: readonly string[];
			codec: string;
			postgresType: string;
	  }>
	| Readonly<{
			position: number;
			kind: "literal";
			value: null | boolean | number | string;
			codec: string;
			postgresType: string;
	  }>
	| Readonly<{
			position: number;
			kind: "queryParameter";
			parameter: string;
			postgresType: string;
	  }>;

type ParameterWithoutPosition = PostgresQueryParameterV1 extends infer Parameter
	? Parameter extends Readonly<{ position: number }>
		? Omit<Parameter, "position">
		: never
	: never;

export class PostgresParameters {
	readonly #items: PostgresQueryParameterV1[] = [];
	readonly #positions = new Map<string, number>();

	add(parameter: ParameterWithoutPosition): string {
		const key = canonicalBytes(parameter);
		let position = this.#positions.get(key);
		if (position === undefined) {
			position = this.#items.length + 1;
			this.#positions.set(key, position);
			this.#items.push({ ...parameter, position } as PostgresQueryParameterV1);
		}
		return `$${position}::${parameter.postgresType}`;
	}

	execution(source: string, path: readonly string[], codec: string): string {
		return this.add({
			kind: "executionFact",
			source,
			path,
			codec,
			postgresType: postgresType({ kind: codec }),
		});
	}

	literal(value: null | boolean | number | string, codec: string): string {
		return this.add({
			kind: "literal",
			value,
			codec,
			postgresType: postgresType({ kind: codec }),
		});
	}

	values(): readonly PostgresQueryParameterV1[] {
		return Object.freeze([...this.#items]);
	}
}
