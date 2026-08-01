import { collection, type BeforeWriteGuard } from "#questpie/exports/index.js";

const memberships = collection("memberships").fields(({ f }) => ({
	account: f.text().required(),
}));

const membershipGuard: BeforeWriteGuard<
	typeof memberships.$infer.select,
	typeof memberships.$infer.insert,
	typeof memberships.$infer.update
> = {
	locks: ({ data, method }) =>
		method === "updateBatch" || !data.account
			? []
			: [{ collection: "accounts", ids: [data.account] }],
	run: ({ data, method }) => {
		if (method === "updateBatch" || !data.account) return;
		const accountId: string = data.account;
		void accountId;
	},
};

memberships.hooks({ beforeWrite: membershipGuard });
