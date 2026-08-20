import { readFileSync } from "node:fs";

import {
	assertBenignAuthorityExemptions,
	scanRepositoryAuthority,
	validate,
} from "./check";

const source = JSON.parse(
	readFileSync(new URL("./PROJECTION.json", import.meta.url), "utf8"),
);
const clone = () => structuredClone(source);
const invalid = [
	() => {
		const value = clone();
		value.frameworkSurface.absent = value.frameworkSurface.absent.filter(
			(item: string) => item !== "defineChannel",
		);
		return value;
	},
	() => {
		const value = clone();
		value.frameworkSurface.replacements = ["defineSignal"];
		return value;
	},
	() => {
		const value = clone();
		value.providerBoundary.runtimeBinding = "runtime.channelCarrier";
		return value;
	},
	() => {
		const value = clone();
		value.providerBoundary.providerRegistry = "pusher and soketi";
		return value;
	},
	() => {
		const value = clone();
		value.providerBoundary.durableAuthority = "provider event history";
		return value;
	},
	() => {
		const value = clone();
		value.providerBoundary.reactionGuarantee = "exactly-once provider delivery";
		return value;
	},
	() => {
		const value = clone();
		value.ownership.businessAuthorization = "provider subscription";
		return value;
	},
	() => {
		const value = clone();
		value.domainPreservation.fixtureGraph =
			"Company -> Space -> Membership -> Message";
		return value;
	},
	() => {
		const value = clone();
		value.supersedes = value.supersedes.filter(
			(item: string) => !item.startsWith("P14"),
		);
		return value;
	},
	() => {
		const value = clone();
		value.historicalEvidence.rewrite = true;
		return value;
	},
];

for (const mutate of invalid) {
	let rejected = false;
	try {
		validate(mutate());
	} catch {
		rejected = true;
	}
	if (!rejected)
		throw new Error("invalid Channel removal projection was accepted");
}

const missingCurrentAuthority = clone();
missingCurrentAuthority.authorityProjection =
	missingCurrentAuthority.authorityProjection.filter(
		(path: string) => path !== "docs/adr/0021-slice-the-beta-one-release.md",
	);
let repositoryOmissionRejected = false;
try {
	scanRepositoryAuthority(missingCurrentAuthority);
} catch (error) {
	repositoryOmissionRejected =
		error instanceof Error &&
		error.message.includes(
			"Channel-bearing current authority missing from projection: docs/adr/0021-slice-the-beta-one-release.md",
		);
}
if (!repositoryOmissionRejected)
	throw new Error(
		"repository scan accepted omission of marker-invisible Channel-bearing ADR-0021",
	);

const capabilityMisclassifiedAsBenign = clone();
const capabilityPath = "docs/v4/semantic-kernels-and-public-surface.md";
capabilityMisclassifiedAsBenign.authorityProjection =
	capabilityMisclassifiedAsBenign.authorityProjection.filter(
		(path: string) => path !== capabilityPath,
	);
capabilityMisclassifiedAsBenign.currentAuthorityBenignExemptions.push({
	path: capabilityPath,
	reason: "incorrectly claimed as a domain-only use",
});
let capabilityMisclassificationRejected = false;
try {
	assertBenignAuthorityExemptions(capabilityMisclassifiedAsBenign);
} catch (error) {
	capabilityMisclassificationRejected =
		error instanceof Error &&
		error.message.includes(capabilityPath) &&
		error.message.includes("defineChannel");
}
if (!capabilityMisclassificationRejected)
	throw new Error(
		"benign exemption accepted a projected core Channel capability surface",
	);

console.log(
	`Channel removal negative controls: ${invalid.length} invalid projections, one repository authority omission, and one capability-as-benign misclassification rejected`,
);
