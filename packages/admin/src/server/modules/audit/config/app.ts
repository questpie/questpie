import { appConfig } from "questpie";

import {
	collectionAfterChange,
	collectionAfterDelete,
	collectionAfterPurge,
	collectionAfterTransition,
	globalAfterChange,
	globalAfterTransition,
} from "./hooks.js";

/** Audit hooks contributed by the audit module. */
export default appConfig({
	hooks: {
		collections: {
			afterChange: collectionAfterChange,
			afterDelete: collectionAfterDelete,
			afterPurge: collectionAfterPurge,
			afterTransition: collectionAfterTransition,
		},
		globals: {
			afterChange: globalAfterChange,
			afterTransition: globalAfterTransition,
		},
	},
});
