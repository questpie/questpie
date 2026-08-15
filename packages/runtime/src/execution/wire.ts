import type { Principal } from "questpie";

export type OperationWireRootFrame = Readonly<{
	format: "questpie.operation-wire-root";
	version: 1;
	context: unknown;
}>;

export function decodeOperationWireRoot(
	frame: unknown,
	principal: Principal,
): Readonly<{ principal: Principal; context: unknown }> {
	if (!frame || typeof frame !== "object" || Array.isArray(frame))
		throw new TypeError("Operation-Wire root must be an object");
	const value = frame as Readonly<Record<string, unknown>>;
	const keys = Object.keys(value).sort();
	if (
		keys.length !== 3 ||
		keys[0] !== "context" ||
		keys[1] !== "format" ||
		keys[2] !== "version" ||
		value.format !== "questpie.operation-wire-root" ||
		value.version !== 1
	)
		throw new TypeError("Operation-Wire root has an invalid envelope");
	return { principal, context: value.context };
}
