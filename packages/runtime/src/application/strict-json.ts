export function parseJsonWithoutDuplicateKeys(source: string): unknown {
	let offset = 0;
	const whitespace = () => {
		while (/\s/u.test(source[offset] ?? "")) offset += 1;
	};
	const string = (): string => {
		const start = offset;
		offset += 1;
		while (offset < source.length) {
			const character = source[offset]!;
			offset += 1;
			if (character === "\\") {
				offset += 1;
				continue;
			}
			if (character === '"')
				return JSON.parse(source.slice(start, offset)) as string;
		}
		throw new TypeError("invalid JSON string");
	};
	const value = (): void => {
		whitespace();
		if (source[offset] === "{") {
			offset += 1;
			whitespace();
			const keys = new Set<string>();
			if (source[offset] === "}") {
				offset += 1;
				return;
			}
			while (offset < source.length) {
				whitespace();
				if (source[offset] !== '"') throw new TypeError("invalid JSON object");
				const key = string();
				if (keys.has(key)) throw new TypeError("duplicate JSON key");
				keys.add(key);
				whitespace();
				if (source[offset] !== ":") throw new TypeError("invalid JSON object");
				offset += 1;
				value();
				whitespace();
				if (source[offset] === "}") {
					offset += 1;
					return;
				}
				if (source[offset] !== ",") throw new TypeError("invalid JSON object");
				offset += 1;
			}
			throw new TypeError("invalid JSON object");
		}
		if (source[offset] === "[") {
			offset += 1;
			whitespace();
			if (source[offset] === "]") {
				offset += 1;
				return;
			}
			while (offset < source.length) {
				value();
				whitespace();
				if (source[offset] === "]") {
					offset += 1;
					return;
				}
				if (source[offset] !== ",") throw new TypeError("invalid JSON array");
				offset += 1;
			}
			throw new TypeError("invalid JSON array");
		}
		if (source[offset] === '"') {
			string();
			return;
		}
		const start = offset;
		while (offset < source.length && !/[\s,\]}]/u.test(source[offset] ?? ""))
			offset += 1;
		if (start === offset) throw new TypeError("invalid JSON value");
	};
	value();
	whitespace();
	if (offset !== source.length) throw new TypeError("invalid JSON");
	return JSON.parse(source) as unknown;
}
