import { defineSeed, seed } from "questpie";

import { channels } from "./channels";
import { companies } from "./companies";
import { memberships } from "./memberships";
import { messages } from "./messages";
import { spaces } from "./spaces";

const companyId = "018f5f6e-5f2c-7b41-a854-3d9a6b6b61a0";
const spaceId = "018f5f6e-5f2c-7b41-a854-3d9a6b6b61a1";
const channelId = "018f5f6e-5f2c-7b41-a854-3d9a6b6b61a2";
const membershipId = "018f5f6e-5f2c-7b41-a854-3d9a6b6b61a3";

export const collaborationDemo = defineSeed({
	name: "collaboration.demo.v1",
	steps: [
		seed.insert(companies, { id: companyId, name: "Questpie" }),
		seed.insert(spaces, { id: spaceId, companyId, name: "General" }),
		seed.insert(channels, { id: channelId, spaceId, name: "welcome" }),
		seed.insert(memberships, {
			id: membershipId,
			companyId,
			principalId: "018f5f6e-5f2c-7b41-a854-3d9a6b6b61a4",
		}),
		seed.insert(messages, {
			id: "018f5f6e-5f2c-7b41-a854-3d9a6b6b61a5",
			channelId,
			authorMembershipId: membershipId,
			body: "Welcome",
			createdAt: "2026-08-14T12:00:00.000Z",
		}),
	],
});
