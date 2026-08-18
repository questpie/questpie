import { expect, test } from "bun:test";

import { durableKernelContract } from "../../packages/compiler/src/reaction/durable-kernel";

/**
 * Criterion 6: the operational lane gets a compiled, digest-verified
 * nondisclosure commitment, so a later widening is a visible diff rather than a
 * quiet change.
 *
 * It rides on `durable-kernel.json` rather than a new artifact. That file is
 * already compiled, digested, and semantically verified at startup, and the
 * commitments describe exactly the surface it already contracts. A separate
 * artifact would be a constant with a digest around it — the ceremony
 * `inspection-contract.md` D1 named as the reason to check before building one.
 */
test("the durable kernel contract pins the operational nondisclosure commitments", () => {
	const nondisclosure = durableKernelContract.nondisclosure;

	// A caller that may not read a run learns the same thing as one asking about
	// a run that does not exist.
	expect(nondisclosure.runAbsence).toBe("indistinguishable");

	// The worklist answers `hasMore` from one row past the bound. A total is a
	// scan and an existence oracle over rows the caller may not read one by one.
	expect(nondisclosure.countOracle).toBe("absent");
	expect(nondisclosure.listDisclosure).toBe("individuallyInspectableOnly");

	// What the inspection projection narrowed, stated as contract rather than as
	// an implementation detail of one function.
	expect(nondisclosure.result).toBe("presenceLengthDigest");
	expect(nondisclosure.receipt).toBe("presenceOnly");

	// Events carry a closed error code and no free text.
	expect(nondisclosure.eventPayload).toBe("closedErrorCodeOnly");

	// The maintenance reason is the first operator-authored free text to enter
	// the durable record, so it is named rather than left implicit.
	expect(nondisclosure.operatorText).toBe("maintenanceReasonOnly");
});

test("the commitments are inside the digested contract", () => {
	const { digest, ...unsigned } = durableKernelContract;
	expect(digest).toMatch(/^[0-9a-f]{64}$/);
	// Widening any commitment moves the digest the Runtime Build pins, so it
	// cannot change without the change being visible.
	expect(JSON.stringify(unsigned)).toContain("nondisclosure");
});
