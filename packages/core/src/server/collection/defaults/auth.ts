import { defineCollection } from "../builder/collection-builder";
import { sql } from "drizzle-orm";
import { varchar, boolean, timestamp } from "drizzle-orm/pg-core";

// User Collection
export const usersCollection = defineCollection("user")
	.options({ timestamps: true })
	.fields({
		name: varchar("name", { length: 255 }).notNull(),
		email: varchar("email", { length: 255 }).notNull().unique(),
		emailVerified: boolean("emailVerified").notNull(),
		image: varchar("image", { length: 500 }),
		role: varchar("role", { length: 50 }), // Optional: Better Auth role handling
		banned: boolean("banned"), // Optional: Better Auth ban handling
	})
	.title((t) => sql`${t.name}`);

// Session Collection
export const sessionsCollection = defineCollection("session")
	.fields({
		userId: varchar("userId", { length: 255 }).notNull(),
		token: varchar("token", { length: 255 }).notNull().unique(),
		expiresAt: timestamp("expiresAt", { mode: "date" }).notNull(),
		ipAddress: varchar("ipAddress", { length: 45 }),
		userAgent: varchar("userAgent", { length: 500 }),
	})
	.title((t) => sql`${t.token}`);

// Account Collection (Social Logins)
export const accountsCollection = defineCollection("account")
	.fields({
		userId: varchar("userId", { length: 255 }).notNull(),
		accountId: varchar("accountId", { length: 255 }).notNull(),
		providerId: varchar("providerId", { length: 255 }).notNull(),
		accessToken: varchar("accessToken", { length: 500 }),
		refreshToken: varchar("refreshToken", { length: 500 }),
		accessTokenExpiresAt: timestamp("accessTokenExpiresAt", { mode: "date" }),
		refreshTokenExpiresAt: timestamp("refreshTokenExpiresAt", { mode: "date" }),
		scope: varchar("scope", { length: 255 }),
		idToken: varchar("idToken", { length: 500 }),
		password: varchar("password", { length: 255 }), // Optional: if using credential account here
	})
	.title((t) => sql`${t.providerId}`);

// Verification Collection
export const verificationsCollection = defineCollection("verification")
	.fields({
		identifier: varchar("identifier", { length: 255 }).notNull(),
		value: varchar("value", { length: 255 }).notNull(),
		expiresAt: timestamp("expiresAt", { mode: "date" }).notNull(),
	})
	.title((t) => sql`${t.identifier}`);
