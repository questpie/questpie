import type { QuestpieClient } from "#questpie/client/index.js";
import { collection } from "#questpie/server/collection/builder/collection-builder.js";

const retained = collection("retained")
	.fields(({ f }) => ({ title: f.text().required() }))
	.options({ softDelete: true });

const ephemeral = collection("ephemeral").fields(({ f }) => ({
	title: f.text().required(),
}));

type App = {
	collections: {
		retained: typeof retained;
		ephemeral: typeof ephemeral;
	};
};

declare const client: QuestpieClient<App>;

client.collections.retained.purgeById({ id: "record-1" });

// @ts-expect-error hard-delete collections do not expose physical purge
client.collections.ephemeral.purgeById({ id: "record-1" });
