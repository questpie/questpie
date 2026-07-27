export const QUESTPIE_QUEUE_DISPATCH_ENVELOPE_VERSION = 1;

interface QueueDispatchEnvelope {
	__questpieQueue: {
		version: typeof QUESTPIE_QUEUE_DISPATCH_ENVELOPE_VERSION;
		dispatchId: string;
		idempotencyKey?: string;
	};
	payload: unknown;
}

export function encodeQueueDispatchEnvelope(
	payload: unknown,
	dispatchId: string,
	idempotencyKey?: string,
): QueueDispatchEnvelope {
	return {
		__questpieQueue: {
			version: QUESTPIE_QUEUE_DISPATCH_ENVELOPE_VERSION,
			dispatchId,
			...(idempotencyKey ? { idempotencyKey } : {}),
		},
		payload,
	};
}

export function decodeQueueDispatchEnvelope(
	value: unknown,
	physicalJobId: string,
): {
	data: unknown;
	dispatchId?: string;
	idempotencyKey?: string;
};
export function decodeQueueDispatchEnvelope(
	value: unknown,
	physicalJobId: string,
): {
	data: unknown;
	dispatchId?: string;
	idempotencyKey?: string;
} {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		return { data: value };
	}
	const envelope = value as Partial<QueueDispatchEnvelope>;
	const metadata = envelope.__questpieQueue;
	if (
		!metadata ||
		metadata.version !== QUESTPIE_QUEUE_DISPATCH_ENVELOPE_VERSION ||
		typeof metadata.dispatchId !== "string" ||
		!isUuid(metadata.dispatchId) ||
		physicalJobId !== metadata.dispatchId ||
		!Object.hasOwn(envelope, "payload")
	) {
		return { data: value };
	}
	return {
		data: envelope.payload,
		dispatchId: metadata.dispatchId,
		...(typeof metadata.idempotencyKey === "string"
			? { idempotencyKey: metadata.idempotencyKey }
			: {}),
	};
}

function isUuid(value: string): boolean {
	return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
		value,
	);
}
