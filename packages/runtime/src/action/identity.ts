import {
	canonicalJsonLine,
	sha256Digest,
	uuidFromSha256Digest,
} from "../canonical-json";
import type { ExecutionFacts } from "../execution";
import { OperationFailure } from "../operation";

type ActionExecutionFacts = ExecutionFacts<
	Readonly<{ tenant: Readonly<{ id: string }>; values: unknown }>
>;

function validEffectKey(value: unknown): value is string {
	if (typeof value !== "string" || value.length === 0) return false;
	let scalars = 0;
	for (let index = 0; index < value.length; index += 1) {
		const unit = value.charCodeAt(index);
		if (unit === 0) return false;
		if (unit >= 0xd800 && unit <= 0xdbff) {
			const next = value.charCodeAt(index + 1);
			if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
			index += 1;
		} else if (unit >= 0xdc00 && unit <= 0xdfff) return false;
		scalars += 1;
	}
	return (
		scalars <= 256 &&
		Buffer.byteLength(value, "utf8") <= 1_024 &&
		value.normalize("NFC") === value
	);
}

export function resourceIdentity(
	value: unknown,
	kind: "action" | "application",
): string {
	if (typeof value !== "string" || !value.startsWith(`${kind}:`))
		throw new TypeError(`Runtime Action ${kind} identity is invalid`);
	const name = value.slice(kind.length + 1);
	const segments = name.split(".");
	if (
		name.length > 255 ||
		!/^[a-z][A-Za-z0-9]*(?:\.[a-z][A-Za-z0-9]*)*$/u.test(name) ||
		segments.some((segment) => segment.length > 63) ||
		(kind === "action" && segments.at(-1) === "then")
	)
		throw new TypeError(`Runtime Action ${kind} identity is invalid`);
	return value;
}

function trustedIdentityText(value: unknown, label: string): string {
	if (
		typeof value !== "string" ||
		value.length === 0 ||
		value.includes("\0") ||
		value.normalize("NFC") !== value ||
		[...value].some(
			(scalar) => scalar.length === 1 && /[\uD800-\uDFFF]/u.test(scalar),
		)
	)
		throw new TypeError(`Runtime Action ${label} is invalid`);
	return value;
}

export function deriveOrdinaryEffectIdentity(
	application: string,
	action: string,
	facts: ActionExecutionFacts,
	effectKey: unknown,
): string {
	if (!validEffectKey(effectKey))
		throw new OperationFailure("PROTOCOL_UNSUPPORTED");
	const material = canonicalJsonLine({
		action,
		application,
		effectKey,
		principalId: trustedIdentityText(facts.principal.id, "Principal id"),
		principalKind: facts.principal.kind,
		tenant: trustedIdentityText(facts.tenant.id, "Tenant id"),
	});
	const domain = Buffer.from("questpie.effect-identity.action.v1\0", "utf8");
	return uuidFromSha256Digest(
		sha256Digest(Buffer.concat([domain, Buffer.from(material)])),
	);
}
