export const SECRET = "sk_live_SENTINEL_7a6b5c4d3e2f";
/** Identifier-shaped sentinel: passes any "looks like a class name" check. */
export const IDENT_SECRET = "AcmeTenantSentinel";
export const DSN = "https://publickey@o1.ingest.example.com/42";

export interface CapturedEnvelope {
	url: string;
	raw: string;
	header: Record<string, unknown>;
	items: Array<{ header: Record<string, unknown>; payload: any }>;
}

/** Local capture transport: records the serialized wire envelope verbatim. */
export function captureTransport(statusCode = 200) {
	const envelopes: CapturedEnvelope[] = [];
	const send = async (request: { url: string; body: string | Uint8Array }) => {
		const raw =
			typeof request.body === "string"
				? request.body
				: new TextDecoder().decode(request.body);
		const lines = raw.split("\n").filter(Boolean);
		const items: CapturedEnvelope["items"] = [];
		for (let i = 1; i < lines.length; i += 2) {
			items.push({
				header: JSON.parse(lines[i]!),
				payload: JSON.parse(lines[i + 1]!),
			});
		}
		envelopes.push({
			url: request.url,
			raw,
			header: JSON.parse(lines[0]!),
			items,
		});
		return { statusCode };
	};
	return { envelopes, send };
}

export const ALLOWED_EVENT_KEYS = new Set([
	"event_id",
	"timestamp",
	"platform",
	"level",
	"release",
	"environment",
	"transaction",
	"tags",
	"exception",
	"contexts",
	"debug_meta",
	"sdk",
]);
