import { collection } from "questpie";

export interface Company {
	readonly id: string;
	readonly name: string;
}

export interface Space {
	readonly id: string;
	readonly companyId: string;
	readonly name: string;
}

export interface Channel {
	readonly id: string;
	readonly spaceId: string;
	readonly visibility: "company" | "private";
	readonly name: string;
}

export interface Membership {
	readonly companyId: string;
	readonly principalId: string;
	readonly scopeKey: string;
	readonly status: "active" | "revoked";
	readonly role: "member" | "moderator" | "admin" | "owner";
	readonly canPost: boolean;
}

export interface Message {
	readonly id: string;
	readonly companyId: string;
	readonly channelId: string;
	readonly authorId: string;
	readonly body: string;
	readonly moderationNote: string | null;
	readonly createdAt: Date;
}

export const companies = collection<
	"companies",
	Company,
	{ readonly id: string }
>("companies");
export const spaces = collection<"spaces", Space, { readonly id: string }>(
	"spaces",
);
export const channels = collection<
	"channels",
	Channel,
	{ readonly id: string }
>("channels");
export const memberships = collection<
	"memberships",
	Membership,
	{
		readonly companyId: string;
		readonly principalId: string;
		readonly scopeKey: string;
	}
>("memberships");
export const messages = collection<
	"messages",
	Message,
	{ readonly id: string }
>("messages");

// A separate application fixture: natural composite keys, no `id` Field, and
// authorization based on research permits rather than a company-row shortcut.
export interface Archive {
	readonly code: string;
	readonly title: string;
}

export interface ArchiveRecord {
	readonly archiveCode: string;
	readonly catalogueNumber: string;
	readonly visibility: "public" | "restricted";
	readonly title: string;
	readonly sealedNote: string | null;
}

export interface ResearchPermit {
	readonly programmeCode: string;
	readonly archiveCode: string;
	readonly principalId: string;
	readonly status: "active" | "revoked";
	readonly mayViewSealed: boolean;
}

export const archives = collection<
	"archives",
	Archive,
	{ readonly code: string }
>("archives");
export const archiveRecords = collection<
	"archiveRecords",
	ArchiveRecord,
	{ readonly archiveCode: string; readonly catalogueNumber: string }
>("archiveRecords");
export const researchPermits = collection<
	"researchPermits",
	ResearchPermit,
	{
		readonly programmeCode: string;
		readonly archiveCode: string;
		readonly principalId: string;
	}
>("researchPermits");
