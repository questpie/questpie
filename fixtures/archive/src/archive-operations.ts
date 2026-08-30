import { defineCollectionOperations } from "questpie";

import { provenancePolicy, recordPolicy } from "./archive-policy";
import { provenance } from "./provenance";
import { records } from "./records";

export const recordOperations = defineCollectionOperations(records, {
	name: "records",
	policy: recordPolicy,
	create: {
		input: ["archiveCode", "catalogueNumber", "visibility", "title", "body"],
		select: {
			archiveCode: true,
			catalogueNumber: true,
			visibility: true,
			title: true,
			body: true,
			createdAt: true,
		},
	},
});

export const provenanceOperations = defineCollectionOperations(provenance, {
	name: "provenance",
	policy: provenancePolicy,
	create: {
		input: ["archiveCode", "catalogueNumber", "sequence", "kind", "note"],
		select: { sequence: true, recordedAt: true },
	},
});
