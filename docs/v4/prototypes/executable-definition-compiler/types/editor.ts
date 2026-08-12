import { operation } from "questpie";

import { defineQuery } from "#questpie/app";

export const editorProbe = defineQuery({
	name: "editor.probe",
	input: operation.object({ id: operation.uuid() }),
	handler: async ({ input, ctx }) => {
		const dataCompletion = ctx.data./*DATA_COMPLETION*/ messages;
		const dataHover = ctx.data.messages /*DATA_HOVER*/;
		return dataCompletion.get({
			key: { id: input.id },
			select: { id: true, body: true },
		});
	},
});

void editorProbe;
