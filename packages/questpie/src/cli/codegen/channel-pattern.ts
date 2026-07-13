const LITERAL_CHARACTER = /^[A-Za-z0-9_\-=@,.;]$/;
const PARAMETER_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * Validate a channel wire pattern before code generation.
 *
 * The source pattern may contain repo-native `[param]` placeholders. Literal
 * characters follow the Pusher-compatible alphabet. The resolved channel name
 * is validated again at runtime because parameter lengths determine whether the
 * provider's 164-character limit is met.
 */
export function validateChannelWirePattern(
	pattern: string,
): string | undefined {
	if (pattern.length === 0) return "wire pattern cannot be empty";

	const parameters = new Set<string>();
	let index = 0;
	while (index < pattern.length) {
		const character = pattern[index]!;

		if (character === "[") {
			const close = pattern.indexOf("]", index + 1);
			if (close === -1) return "wire pattern has an unclosed bracket parameter";

			const parameter = pattern.slice(index + 1, close);
			if (!PARAMETER_NAME.test(parameter)) {
				return `wire pattern parameter "${parameter}" must be a TypeScript identifier`;
			}
			if (parameters.has(parameter)) {
				return `wire pattern parameter "${parameter}" is declared more than once`;
			}
			parameters.add(parameter);
			index = close + 1;
			continue;
		}

		if (character === "]") {
			return "wire pattern has an unmatched closing bracket";
		}
		if (character === "/") {
			return "wire pattern cannot contain a slash";
		}
		if (/\s/.test(character)) {
			return "wire pattern cannot contain whitespace";
		}
		if (!LITERAL_CHARACTER.test(character)) {
			return `wire pattern contains unsupported character ${JSON.stringify(character)}`;
		}

		index += 1;
	}
}
