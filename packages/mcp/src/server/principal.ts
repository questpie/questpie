export type ValidatedMcpPrincipal =
	| { kind: "user" }
	| { kind: "oauth"; scopes: string[] }
	| { kind: "system" };

const hasOwnData = (
	descriptors: PropertyDescriptorMap,
	key: string,
): descriptors is PropertyDescriptorMap &
	Record<string, { value: unknown }> => {
	const descriptor = descriptors[key];
	return !!descriptor && "value" in descriptor;
};

const isObject = (value: unknown): value is object =>
	typeof value === "object" && value !== null && !Array.isArray(value);

const nonEmptyString = (value: unknown): value is string =>
	typeof value === "string" && value.length > 0;
const isString = (value: unknown): value is string => typeof value === "string";

function hasOwnString(value: object, key: string): boolean {
	try {
		const descriptor = Object.getOwnPropertyDescriptor(value, key);
		return (
			!!descriptor && "value" in descriptor && nonEmptyString(descriptor.value)
		);
	} catch {
		return false;
	}
}

/**
 * Validate the complete MCP-facing principal discriminant without invoking
 * getters or reading inherited properties.
 */
export function validateMcpPrincipal(
	value: unknown,
): ValidatedMcpPrincipal | null {
	if (!isObject(value)) return null;
	try {
		const descriptors = Object.getOwnPropertyDescriptors(value);
		if (!hasOwnData(descriptors, "kind")) return null;

		if (descriptors.kind.value === "system") {
			return Object.keys(descriptors).length === 1 ? { kind: "system" } : null;
		}

		if (descriptors.kind.value === "user") {
			if (
				Object.keys(descriptors).some(
					(key) => !["kind", "user", "session"].includes(key),
				) ||
				!hasOwnData(descriptors, "user") ||
				!isObject(descriptors.user.value) ||
				!hasOwnString(descriptors.user.value, "id") ||
				!hasOwnData(descriptors, "session") ||
				!isObject(descriptors.session.value) ||
				!hasOwnString(descriptors.session.value, "id")
			) {
				return null;
			}
			return { kind: "user" };
		}

		if (descriptors.kind.value === "oauth") {
			if (
				Object.keys(descriptors).some(
					(key) =>
						!["kind", "user", "clientId", "scopes", "tokenId"].includes(key),
				) ||
				!hasOwnData(descriptors, "user") ||
				!isObject(descriptors.user.value) ||
				!hasOwnString(descriptors.user.value, "id") ||
				!hasOwnData(descriptors, "clientId") ||
				!nonEmptyString(descriptors.clientId.value) ||
				!hasOwnData(descriptors, "tokenId") ||
				!isString(descriptors.tokenId.value) ||
				!hasOwnData(descriptors, "scopes") ||
				!Array.isArray(descriptors.scopes.value) ||
				!descriptors.scopes.value.every(nonEmptyString)
			) {
				return null;
			}
			return {
				kind: "oauth",
				scopes: [...descriptors.scopes.value],
			};
		}

		return null;
	} catch {
		return null;
	}
}
