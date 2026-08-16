export function isOperationCallId(value: unknown): value is string {
	if (typeof value !== "string" || value.length === 0 || value.includes("\0"))
		return false;
	let scalars = 0;
	for (let index = 0; index < value.length; index += 1) {
		const unit = value.charCodeAt(index);
		if (unit >= 0xd800 && unit <= 0xdbff) {
			if (index + 1 >= value.length) return false;
			const next = value.charCodeAt(index + 1);
			if (next < 0xdc00 || next > 0xdfff) return false;
			index += 1;
		} else if (unit >= 0xdc00 && unit <= 0xdfff) return false;
		scalars += 1;
		if (scalars > 256) return false;
	}
	return (
		value === value.normalize("NFC") &&
		new TextEncoder().encode(value).byteLength <= 1_024
	);
}

export function isPostgresTransactionId(value: unknown): value is string {
	if (typeof value !== "string" || !/^[1-9][0-9]{0,19}$/.test(value))
		return false;
	return BigInt(value) <= 18_446_744_073_709_551_615n;
}
