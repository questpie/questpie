export function isOperationCallId(value: unknown): value is string {
	return (
		typeof value === "string" &&
		value.length > 0 &&
		value.length <= 256 &&
		value === value.normalize("NFC")
	);
}
