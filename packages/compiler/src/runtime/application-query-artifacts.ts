import { compareAscii } from "../canonical";

type RecordValue = Readonly<Record<string, unknown>>;

function record(value: unknown, label: string): RecordValue {
	if (!value || typeof value !== "object" || Array.isArray(value))
		throw new TypeError(`${label} must be an object`);
	return value as RecordValue;
}

export function expectedQueryTemplates(
	queries: readonly RecordValue[],
): readonly Readonly<{ digest: string; templateVersion: number }>[] {
	return [
		...new Map(
			queries.map((query) => [
				String(query.digest),
				{
					digest: String(query.digest),
					templateVersion: Number(
						query.templateVersion ??
							record(query.template, "Query Template").version,
					),
				},
			]),
		).values(),
	].sort((left, right) => compareAscii(left.digest, right.digest));
}
