/**
 * Simple CMS Instance for Client Example
 */

import { QCMS, defineCollection, defineJob, pgBossAdapter } from "@questpie/cms/server";
import { varchar, boolean, text } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { z } from "zod";

// Define barbers collection
const barbers = defineCollection("barbers")
	.fields({
		name: varchar("name", { length: 255 }).notNull(),
		email: varchar("email", { length: 255 }).notNull().unique(),
		phone: varchar("phone", { length: 50 }),
		bio: text("bio"),
		isActive: boolean("is_active").default(true).notNull(),
	})
	.title(({ table }) => sql`${table.name}`);

// Define appointments collection
const appointments = defineCollection("appointments")
	.fields({
		barberId: varchar("barber_id", { length: 255 }).notNull(),
		customerId: varchar("customer_id", { length: 255 }).notNull(),
		status: varchar("status", { length: 50 }).default("pending").notNull(),
	})
	.relations(({ one, table }) => ({
		barber: one("barbers", {
			fields: [table.barberId],
			references: ["id"],
		}),
		customer: one("questpie_users", {
			fields: [table.customerId],
			references: ["id"],
		}),
	}));

const jobs = [
	defineJob({
		name: "test-job",
		schema: z.object({ id: z.string() }),
		handler: async () => {},
	}),
];

export const cms = new QCMS({
	app: {
		url: "http://localhost:3000",
	},

	db: {
		connection: {
			url: "postgres://localhost/test",
		},
	},

	collections: [barbers, appointments],

	auth: (db: any) => undefined as any,

	storage: {},

	email: {
		transport: {
			host: "localhost",
			port: 1025,
			secure: false,
		},
		templates: {},
	},

	queue: {
		jobs,
		adapter: pgBossAdapter({
			connectionString: "postgres://localhost/test",
		}),
	},
});
