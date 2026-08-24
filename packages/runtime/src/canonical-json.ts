import { createHash } from "node:crypto";

export type CanonicalJsonFailure =
	| "cycle"
	| "invalid-number"
	| "invalid-unicode"
	| "invalid-value";

export class CanonicalJsonError extends TypeError {
	readonly reason: CanonicalJsonFailure;

	constructor(reason: CanonicalJsonFailure) {
		super(`Canonical JSON rejected ${reason}`);
		this.name = "CanonicalJsonError";
		this.reason = reason;
	}
}

function hasLoneSurrogate(value: string): boolean {
	for (let index = 0; index < value.length; index += 1) {
		const unit = value.charCodeAt(index);
		if (unit >= 0xd800 && unit <= 0xdbff) {
			const next = value.charCodeAt(index + 1);
			if (!(next >= 0xdc00 && next <= 0xdfff)) return true;
			index += 1;
		} else if (unit >= 0xdc00 && unit <= 0xdfff) return true;
	}
	return false;
}

/** Runtime-private canonical JSON kernel. Domain modules own its named uses. */
export function canonicalJsonLine(value: unknown): Uint8Array {
	const active = new Set<object>();
	const render = (item: unknown): string => {
		if (item === null || typeof item === "boolean") return JSON.stringify(item);
		if (typeof item === "number") {
			if (!Number.isFinite(item) || Object.is(item, -0))
				throw new CanonicalJsonError("invalid-number");
			return JSON.stringify(item);
		}
		if (typeof item === "string") {
			if (hasLoneSurrogate(item))
				throw new CanonicalJsonError("invalid-unicode");
			return JSON.stringify(item);
		}
		if (!item || typeof item !== "object")
			throw new CanonicalJsonError("invalid-value");
		if (active.has(item)) throw new CanonicalJsonError("cycle");
		active.add(item);
		let encoded: string;
		if (Array.isArray(item)) encoded = `[${item.map(render).join(",")}]`;
		else {
			const record = item as Readonly<Record<string, unknown>>;
			encoded = `{${Object.keys(record)
				.sort((left, right) => (left < right ? -1 : left > right ? 1 : 0))
				.map((key) => {
					if (hasLoneSurrogate(key))
						throw new CanonicalJsonError("invalid-unicode");
					return `${JSON.stringify(key)}:${render(record[key])}`;
				})
				.join(",")}}`;
		}
		active.delete(item);
		return encoded;
	};
	return Buffer.from(`${render(value)}\n`);
}

export function sha256Digest(bytes: Uint8Array | string): string {
	return createHash("sha256").update(bytes).digest("hex");
}
