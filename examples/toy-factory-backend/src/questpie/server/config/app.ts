import { appConfig } from "#questpie/factories";

/**
 * App config — also the regression fixture for the appConfig.access type
 * cycle: a FUNCTION-valued default-access rule used to collapse the whole
 * AppContext augmentation (TS2456 via typeof appConfig in the generated
 * index). appConfig now erases access/hooks from its return type, so this
 * must typecheck.
 */
export default appConfig({
	access: {
		read: true,
		create: ({ session }) => !!session,
		update: ({ session }) => !!session,
		delete: false,
	},
	hooks: {
		collections: {
			afterChange: async () => {
				// function-valued global hook — must not cycle either
			},
		},
	},
});
