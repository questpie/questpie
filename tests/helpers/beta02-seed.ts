const companyId = "018f5f6e-5f2c-7b41-a854-3d9a6b6b61a0";
const spaceId = "018f5f6e-5f2c-7b41-a854-3d9a6b6b61a1";
const channelId = "018f5f6e-5f2c-7b41-a854-3d9a6b6b61a2";
const membershipId = "018f5f6e-5f2c-7b41-a854-3d9a6b6b61a3";

export const collaborationSeedDefinition = Object.freeze({
	name: "collaboration.demo.v1",
	dependsOn: [],
	steps: [
		{
			kind: "insert",
			collection: "collection:companies",
			values: { id: companyId, name: "Questpie" },
		},
		{
			kind: "insert",
			collection: "collection:spaces",
			values: { id: spaceId, companyId, name: "General" },
		},
		{
			kind: "insert",
			collection: "collection:channels",
			values: { id: channelId, spaceId, name: "welcome" },
		},
		{
			kind: "insert",
			collection: "collection:memberships",
			values: {
				id: membershipId,
				companyId,
				principalId: "018f5f6e-5f2c-7b41-a854-3d9a6b6b61a4",
			},
		},
		{
			kind: "insert",
			collection: "collection:messages",
			values: {
				id: "018f5f6e-5f2c-7b41-a854-3d9a6b6b61a5",
				channelId,
				authorMembershipId: membershipId,
				body: "Welcome",
				createdAt: "2026-08-14T12:00:00.000Z",
			},
		},
	],
});
