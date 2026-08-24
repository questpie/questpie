import {
	failRuntimeArtifact as fail,
	runtimeArtifactRecord as record,
} from "./artifact-protocol";
import { validateOperationWireV3 } from "./wire-v3-artifact";

export const operationWireV3ExtensionKeys = [
	"actionEffectIdentity",
	"actionFailureDetails",
	"actionFailures",
	"actionLimitsProjection",
	"actionOutcomeAmbiguous",
	"actionRequestKeys",
	"effectKey",
	"postDispatchResourceLimit",
	"preExecutionRejection",
] as const;

function retainedWireV2(wire: Readonly<Record<string, unknown>>) {
	const compatibility = record(wire.compatibility, "wire v3 compatibility");
	const retainedCompatibility = { ...compatibility };
	delete retainedCompatibility.wireV2Digest;
	delete retainedCompatibility.wireV2ActionExecution;
	delete retainedCompatibility.wireV2MutationExecution;
	delete retainedCompatibility.wireV2QueryExecution;
	const retained: Record<string, unknown> = {
		...wire,
		version: 2,
		compatibility: retainedCompatibility,
		operations: (
			wire.operations as readonly Readonly<{ identity?: unknown }>[]
		).filter(
			(operation) =>
				typeof operation.identity === "string" &&
				!operation.identity.startsWith("action:"),
		),
		digest: compatibility.wireV2Digest,
	};
	for (const key of operationWireV3ExtensionKeys) delete retained[key];
	return retained;
}

export function validateRuntimeOperationWireV3(
	wire: Readonly<Record<string, unknown>>,
): void {
	const actionOperations = (wire.operations as readonly unknown[]).filter(
		(operation) =>
			typeof operation === "object" &&
			operation !== null &&
			!Array.isArray(operation) &&
			String(
				(operation as Readonly<Record<string, unknown>>).identity,
			).startsWith("action:"),
	);
	if (actionOperations.length === 0)
		fail("Operation Wire v3 requires Action operations");
	validateOperationWireV3({
		wire,
		retainedWireV2: retainedWireV2(wire),
		actionOperations,
	});
}
