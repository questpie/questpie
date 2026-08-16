export type RetainedClientPair = Readonly<{
	clientContractDigest: string;
	wireDigest: string;
}>;

const digestPattern = /^[0-9a-f]{64}$/;

function pairKey(clientContractDigest: string, wireDigest: string): string {
	return `${clientContractDigest}:${wireDigest}`;
}

export function retainClientPairs(
	value: readonly RetainedClientPair[] | undefined,
): ReadonlySet<string> {
	const pairs = new Set<string>();
	for (const candidate of value ?? []) {
		if (
			!candidate ||
			typeof candidate !== "object" ||
			Array.isArray(candidate) ||
			Object.keys(candidate).sort().join(",") !==
				"clientContractDigest,wireDigest" ||
			!digestPattern.test(candidate.clientContractDigest) ||
			!digestPattern.test(candidate.wireDigest)
		)
			throw new TypeError("Retained client pair is invalid");
		const key = pairKey(candidate.clientContractDigest, candidate.wireDigest);
		if (pairs.has(key))
			throw new TypeError("Retained client pair is duplicated");
		pairs.add(key);
	}
	return pairs;
}

export function matchesRetainedClientPair(
	pairs: ReadonlySet<string>,
	clientContractDigest: string,
	wireDigest: string,
): boolean {
	return pairs.has(pairKey(clientContractDigest, wireDigest));
}
