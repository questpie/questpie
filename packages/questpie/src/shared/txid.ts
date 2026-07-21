export const QUESTPIE_TXID_HEADER = "X-Questpie-Txid";
export const QUESTPIE_TXID = Symbol.for("questpie.txid");

type TxidCarrier = {
	[QUESTPIE_TXID]?: string;
};

/** Attach response-only transaction metadata without changing JSON payloads. */
export function attachTxid<T>(value: T, txid: string | null | undefined): T {
	if (!txid || (typeof value !== "object" && typeof value !== "function")) {
		return value;
	}
	if (value === null) return value;

	Object.defineProperty(value, QUESTPIE_TXID, {
		value: txid,
		configurable: true,
		enumerable: false,
		writable: false,
	});
	return value;
}

export function getTxid(value: unknown): string | undefined {
	if (!value || (typeof value !== "object" && typeof value !== "function")) {
		return undefined;
	}
	return (value as TxidCarrier)[QUESTPIE_TXID];
}
