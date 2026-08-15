import type { Codec } from "questpie";

import { decodeRuntimeCodec, RuntimeCodecError } from "../codec";

export function decodeContextInput<Value>(
	codec: Codec<Value>,
	value: unknown,
): Value {
	try {
		return decodeRuntimeCodec(codec as never, value);
	} catch (error) {
		if (error instanceof RuntimeCodecError)
			throw new TypeError(`Context input ${error.message}`, { cause: error });
		throw error;
	}
}
