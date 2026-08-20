import { readFileSync } from "node:fs";

import { scanRepositoryAuthority, validate } from "./check";

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
		(path: string) => path !== "HANDOFF.md",
	);
let repositoryOmissionRejected = false;
try {
	scanRepositoryAuthority(missingCurrentAuthority);
} catch (error) {
	repositoryOmissionRejected =
		error instanceof Error &&
		error.message.includes(
			"Channel-bearing current authority missing from projection: HANDOFF.md",
		);
}
if (!repositoryOmissionRejected)
	throw new Error(
		"repository scan accepted omission of Channel-bearing current authority",
	);

console.log(
	`Channel removal negative controls: ${invalid.length} invalid projections and one repository authority omission rejected`,
);
