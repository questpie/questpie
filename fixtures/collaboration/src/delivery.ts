/**
 * A local delivery provider stand-in for the executed Reaction. It is ordinary
 * handler code, not an authored Action: BETA-08 adds no external Action
 * authoring.
 *
 * Its outcome is decided entirely by the committed Message body and the
 * physical attempt number, so a tracer drives every accepted effect outcome —
 * accepted, definitely refused, and lost response — without shared test state.
 */
const accepted = new Map<string, string>();

export async function deliverMessage(
	input: Readonly<{ attempt: number; body: string; effectId: string }>,
): Promise<string> {
	if (input.body.startsWith("delivery-refused-once") && input.attempt === 1)
		throw new Error("delivery provider refused the request");
	if (input.body.startsWith("delivery-refused-always"))
		throw new Error("delivery provider refused the request");
	const receipt = `delivery:${input.effectId}`;
	accepted.set(input.effectId, receipt);
	if (input.body.startsWith("delivery-lost"))
		throw new Error("delivery response was lost");
	return receipt;
}

export async function lookupDelivery(
	input: Readonly<{ body: string; effectId: string }>,
): Promise<string | null> {
	if (input.body.startsWith("delivery-lost"))
		throw new Error("delivery lookup is unavailable");
	return accepted.get(input.effectId) ?? null;
}
