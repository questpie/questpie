// Import official admin translations for SK (optional - other languages available)
import { adminMessagesSK } from "@questpie/admin/client";
import { builder } from "./builder";

// ============================================================================
// I18n Messages (Admin UI)
// ============================================================================

/**
 * Custom admin UI messages for the barbershop app.
 *
 * These app-specific messages are MERGED with official admin translations.
 * - Official translations (adminMessagesSK) provide: common.save, auth.login, etc.
 * - Custom messages below provide: barbershop.welcome, collection.barbers.title, etc.
 *
 * The `as const` assertion enables type-safe autocomplete for message keys.
 */
const customMessages = {
	en: {
		// Custom labels for barbershop
		"barbershop.welcome": "Welcome to Barbershop Admin",
		"barbershop.bookNow": "Book Now",
		"barbershop.todaysAppointments": "Today's Appointments",
		"barbershop.upcomingSlots": "Upcoming Slots",
		"barbershop.activeBarbers": "Active Barbers",
		"barbershop.totalServices": "Total Services",
		"barbershop.pendingReviews": "Pending Reviews",
		// Collection-specific labels
		"collection.barbers.title": "Barbers",
		"collection.barbers.description": "Manage your team of barbers",
		"collection.services.title": "Services",
		"collection.services.description": "Hair cutting and styling services",
		"collection.appointments.title": "Appointments",
		"collection.appointments.description": "Customer bookings and schedules",
	},
	sk: {
		// Merge official SK translations with custom barbershop messages
		...adminMessagesSK,
		// Custom labels for barbershop (these override/extend official translations)
		"barbershop.welcome": "Vitajte v Barbershop Admin",
		"barbershop.bookNow": "Rezervovať",
		"barbershop.todaysAppointments": "Dnešné rezervácie",
		"barbershop.upcomingSlots": "Nadchádzajúce termíny",
		"barbershop.activeBarbers": "Aktívni holiči",
		"barbershop.totalServices": "Celkom služieb",
		"barbershop.pendingReviews": "Čakajúce recenzie",
		// Collection-specific labels
		"collection.barbers.title": "Holiči",
		"collection.barbers.description": "Spravujte váš tím holičov",
		"collection.services.title": "Služby",
		"collection.services.description": "Strihanie a úprava vlasov",
		"collection.appointments.title": "Rezervácie",
		"collection.appointments.description": "Zákaznícke rezervácie a rozvrhy",
	},
};

export const admin = builder
	// Add admin UI locale configuration
	.locale({
		default: "en",
		supported: ["en", "sk"],
	})
	// Add custom admin UI messages
	.messages(customMessages)
	// Branding
	.branding({
		name: "Barbershop Admin",
		logo: undefined, // TODO: Add logo component
	});

export type AdminConfig = typeof admin;
