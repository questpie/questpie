const MAX_U64 = (1n << 64n) - 1n;

export class CrdtBinaryReader {
	private offset = 0;
	private readonly view: DataView;

	constructor(private readonly input: Uint8Array) {
		this.view = new DataView(input.buffer, input.byteOffset, input.byteLength);
	}

	get remaining(): number {
		return this.input.byteLength - this.offset;
	}

	u8(): number {
		this.require(1);
		return this.view.getUint8(this.offset++);
	}

	u16(): number {
		this.require(2);
		const value = this.view.getUint16(this.offset);
		this.offset += 2;
		return value;
	}

	u32(): number {
		this.require(4);
		const value = this.view.getUint32(this.offset);
		this.offset += 4;
		return value;
	}

	u64(): bigint {
		this.require(8);
		const value = this.view.getBigUint64(this.offset);
		this.offset += 8;
		return value;
	}

	bytes(length: number, maximum = length): Uint8Array {
		if (!Number.isSafeInteger(length) || length < 0 || length > maximum) {
			throw new Error("Invalid CRDT binary length");
		}
		this.require(length);
		const value = this.input.subarray(this.offset, this.offset + length);
		this.offset += length;
		return value;
	}

	done(): void {
		if (this.remaining !== 0) {
			throw new Error("Trailing CRDT binary bytes");
		}
	}

	private require(length: number): void {
		if (length > this.remaining) {
			throw new Error("Truncated CRDT binary value");
		}
	}
}

export class CrdtBinaryWriter {
	private readonly chunks: Uint8Array[] = [];
	private length = 0;

	u8(value: number): void {
		assertInteger(value, 0xff, "u8");
		this.push(Uint8Array.of(value));
	}

	u16(value: number): void {
		assertInteger(value, 0xffff, "u16");
		const bytes = new Uint8Array(2);
		new DataView(bytes.buffer).setUint16(0, value);
		this.push(bytes);
	}

	u32(value: number): void {
		assertInteger(value, 0xffff_ffff, "u32");
		const bytes = new Uint8Array(4);
		new DataView(bytes.buffer).setUint32(0, value);
		this.push(bytes);
	}

	u64(value: bigint): void {
		if (typeof value !== "bigint" || value < 0n || value > MAX_U64) {
			throw new Error("Invalid CRDT binary u64");
		}
		const bytes = new Uint8Array(8);
		new DataView(bytes.buffer).setBigUint64(0, value);
		this.push(bytes);
	}

	bytes(value: Uint8Array, length?: number): void {
		if (!(value instanceof Uint8Array)) {
			throw new Error("Expected CRDT binary bytes");
		}
		if (length !== undefined && value.byteLength !== length) {
			throw new Error("Invalid fixed CRDT binary byte length");
		}
		this.push(value);
	}

	finish(): Uint8Array {
		const output = new Uint8Array(this.length);
		let offset = 0;
		for (const chunk of this.chunks) {
			output.set(chunk, offset);
			offset += chunk.byteLength;
		}
		return output;
	}

	private push(value: Uint8Array): void {
		this.chunks.push(value);
		this.length += value.byteLength;
	}
}

export function canonicalCrdtJson(
	value: unknown,
	ancestors: Set<object> = new Set(),
): string {
	if (
		value === null ||
		typeof value === "boolean" ||
		typeof value === "string"
	) {
		if (typeof value === "string" && hasUnpairedSurrogate(value)) {
			throw new Error("Invalid CRDT JSON string");
		}
		return JSON.stringify(value);
	}
	if (typeof value === "number") {
		if (!Number.isFinite(value)) {
			throw new Error("Invalid CRDT JSON number");
		}
		return JSON.stringify(value);
	}
	if (typeof value !== "object") {
		throw new Error("Invalid CRDT JSON value");
	}
	if (ancestors.has(value)) {
		throw new Error("Cyclic CRDT JSON value");
	}
	ancestors.add(value);
	let result: string;
	if (Array.isArray(value)) {
		const items: string[] = [];
		for (let index = 0; index < value.length; index++) {
			if (!Object.hasOwn(value, index)) {
				throw new Error("Sparse CRDT JSON array");
			}
			items.push(canonicalCrdtJson(value[index], ancestors));
		}
		result = `[${items.join(",")}]`;
	} else {
		const object = value as Record<string, unknown>;
		const keys = Object.keys(object).sort();
		for (const key of keys) {
			if (
				hasUnpairedSurrogate(key) ||
				object[key] === undefined ||
				typeof object[key] === "function" ||
				typeof object[key] === "symbol"
			) {
				throw new Error("Invalid CRDT JSON object");
			}
		}
		result = `{${keys
			.map(
				(key) =>
					`${JSON.stringify(key)}:${canonicalCrdtJson(object[key], ancestors)}`,
			)
			.join(",")}}`;
	}
	ancestors.delete(value);
	return result;
}

function assertInteger(value: number, maximum: number, label: string): void {
	if (!Number.isSafeInteger(value) || value < 0 || value > maximum) {
		throw new Error(`Invalid CRDT binary ${label}`);
	}
}

function hasUnpairedSurrogate(value: string): boolean {
	for (let index = 0; index < value.length; index++) {
		const code = value.charCodeAt(index);
		if (code >= 0xd800 && code <= 0xdbff) {
			if (index + 1 >= value.length) return true;
			const next = value.charCodeAt(index + 1);
			if (next < 0xdc00 || next > 0xdfff) return true;
			index++;
		} else if (code >= 0xdc00 && code <= 0xdfff) {
			return true;
		}
	}
	return false;
}
