import { defineCollection } from "#questpie/cms/server/collection/builder/collection-builder.js";
import { defineJob, pgBossAdapter, QCMS } from "#questpie/cms/server/index.js";
import { sql } from "drizzle-orm";
import {
	integer,
	boolean,
	varchar,
	jsonb,
	text,
	timestamp,
} from "drizzle-orm/pg-core";
import z from "zod";

const categories = defineCollection("categories")
	.fields({
		name: varchar().notNull(),
		description: varchar(),
		availableProducts: integer().notNull().default(0),
	})
	.relations(({ many }) => ({
		products: many("products", { relationName: "category" }),
	}))
	.access({
		read: () => true,
		create: (ctx) => ctx.user.role === "admin",
		update: (ctx) => ctx.user.role === "admin",
	})
	.build();

const products = defineCollection("products")
	.fields({
		name: varchar().notNull(),
		description: varchar(),
		price: varchar().notNull(),
		isAvailable: boolean().notNull().default(true),
		categoryId: varchar()
			.references(() => categories.table.id)
			.notNull(),
	})
	.relations(({ one }) => ({
		category: one(categories.name, {
			fields: [categories.table.id],
			references: ["categoryId"],
		}),
	}))
	.access({
		read: () => true,
		create: (ctx) => ctx.user.role === "admin",
		update: (ctx) => ctx.user.role === "admin",
	})
	.hooks({
		afterChange: async () => {
			// Enqueue job to update available products count
		},
	})
	.build();

// ============================================================================
// Collections
// ============================================================================

type WorkingHours = {
	monday: { start: string; end: string };
	tuesday: { start: string; end: string };
	wednesday: { start: string; end: string };
	thursday: { start: string; end: string };
	friday: { start: string; end: string };
	saturday?: { start: string; end: string };
	sunday?: { start: string; end: string };
};

/**
 * Barbers Collection
 * Represents staff members who provide services
 */
export const barbers = defineCollection("barbers")
	.fields({
		name: varchar("name", { length: 255 }).notNull(),
		email: varchar("email", { length: 255 }).notNull().unique(),
		phone: varchar("phone", { length: 50 }),
		bio: text("bio"),
		avatar: varchar("avatar", { length: 500 }),
		isActive: boolean("is_active").default(true).notNull(),
		// Working hours stored as JSON
		workingHours: jsonb("working_hours").$type<WorkingHours>(),
	})
	.build();
// .title((t) => sql`${t.name}`);

/**
 * Services Collection
 * Available services at the barbershop
 */
export const services = defineCollection("services")
	.fields({
		name: varchar("name", { length: 255 }).notNull(),
		description: text("description"),
		duration: integer("duration").notNull(), // in minutes
		price: integer("price").notNull(), // in cents
		isActive: boolean("is_active").default(true).notNull(),
	})
	.build();
// .title((t) => sql`${t.name}`);

/**
 * Appointments Collection
 * Customer bookings with barbers
 */
export const appointments = defineCollection("appointments")
	.fields({
		customerId: varchar("customer_id", { length: 255 }).notNull(),
		barberId: varchar("barber_id", { length: 255 }).notNull(),
		serviceId: varchar("service_id", { length: 255 }).notNull(),
		scheduledAt: timestamp("scheduled_at", { mode: "date" }).notNull(),
		status: varchar("status", { length: 50 }).default("pending").notNull(),
		// Status: pending, confirmed, completed, cancelled, no-show
		notes: text("notes"),
		cancelledAt: timestamp("cancelled_at", { mode: "date" }),
		cancellationReason: text("cancellation_reason"),
	})
	// .title((t) => sql`Appointment at  ${t.scheduledAt}`)
	.relations(({ one, table }) => ({
		// Note: customerId references Better Auth's users table
		customer: one("questpie_users", {
			fields: [table.customerId],
			references: ["id"],
		}),
		barber: one("barbers", {
			fields: [table.barberId],
			references: ["id"],
		}),
		service: one("services", {
			fields: [table.serviceId],
			references: ["id"],
		}),
	}))
	.hooks({
		afterCreate: async ({ data, cms }) => {
			// Send confirmation email after booking
			await cms.queue.publish("send-appointment-confirmation", {
				appointmentId: data.id,
				customerId: data.customerId,
			});
		},
		afterUpdate: async ({ data, cms }) => {
			// Notify customer if appointment is cancelled
			if (data.status === "cancelled" && data.cancelledAt) {
				await cms.queue.publish("send-appointment-cancellation", {
					appointmentId: data.id,
					customerId: data.customerId,
				});
			}
		},
	})
	.build();

/**
 * Reviews Collection
 * Customer reviews for completed appointments
 */
export const reviews = defineCollection("reviews")
	.fields({
		appointmentId: varchar("appointment_id", { length: 255 })
			.notNull()
			.unique(),
		customerId: varchar("customer_id", { length: 255 }).notNull(),
		barberId: varchar("barber_id", { length: 255 }).notNull(),
		rating: integer("rating").notNull(), // 1-5
		comment: text("comment"),
	})
	.title(({ table }) => sql`'Review #' || ${table.id}`)
	.relations(({ one, table }) => ({
		appointment: one("appointments", {
			fields: [table.appointmentId],
			references: ["id"],
		}),
		customer: one("questpie_users", {
			fields: [table.customerId],
			references: ["id"],
		}),
		barber: one("barbers", {
			fields: [table.barberId],
			references: ["id"],
		}),
	}))
	.build();
s;

const updateJob = defineJob({
	name: "update-number-of-available-products",
	schema: z.object({
		categoryId: z.string(),
	}),
	handler: async (input) => {
		const availableProductsCount = await cms.api.collections.products.count({
			where: {
				categoryId: input.categoryId,
				isAvailable: true,
			},
		});

		await cms.api.collections.categories.update({
			where: {
				id: { eq: input.categoryId },
			},
			data: {
				availableProducts: availableProductsCount,
			},
		});
	},
});

export const cms = new QCMS({
	app: {
		url: "http://localhost:3000",
	},
	db: {
		connection: {
			url: "postgresql://user:password@localhost:5432/questpie_test",
		},
	},
	collections: [products, categories, barbers, appointments, reviews] as const,
	queue: {
		jobs: [updateJob],
		adapter: pgBossAdapter({
			connectionString:
				"postgresql://user:password@localhost:5432/questpie_test",
		}),
	},
	locale: {
		locales() {
			return [{ code: "en" }];
		},
		defaultLocale: "en",
	},
});

const productsResult = await cms.api.collections.products.find({
	where: {
		isAvailable: true,
	},
	with: {
		category: { columns: { name: true } },
	},
});

console.log("Products with Category:", productsResult.docs);
if (productsResult.docs.length > 0) {
	console.log("Product Name:", productsResult.docs[0].name);
	console.log("Category Name:", productsResult.docs[0].category.name);
}

const categoriesResult = await cms.api.collections.categories.find({
	with: {
		products: {
			columns: { id: true },
			_aggregate: {
				_avg: {
					price: true,
				},
			},
		},
	},
});

console.log("Categories with Product Count:", categoriesResult.docs);
if (categoriesResult.docs.length > 0) {
	console.log("Category Name:", categoriesResult.docs[0].name);
	console.log("Product Count:", categoriesResult.docs[0].products._avg.price);
}
