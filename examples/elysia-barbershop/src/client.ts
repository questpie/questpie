/**
 * Barbershop Client Example (Elysia Edition)
 *
 * Demonstrates:
 * - Unified client combining CMS CRUD + Eden Treaty
 * - Full end-to-end type safety with Elysia
 * - Cleaner API with single client instance
 * - Superior type inference compared to Hono
 */

import { createClientFromEden } from "@questpie/elysia/client";
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import type { cms } from "./cms"; // MUST be runtime import for typeof to work!
import type { App } from "./server";

// ============================================================================
// Client Setup
// ============================================================================

const SERVER = "localhost:3001";

// Unified client - combines CMS CRUD with Eden Treaty
// ✨ Single client with full type safety!
// IMPORTANT: Use `typeof cms` directly for proper type inference
const client = createClientFromEden<App, typeof cms>({
	server: SERVER,
});

// ============================================================================
// Usage Examples
// ============================================================================

async function exampleUsage() {
	console.log("🪒 Barbershop Client Examples (Elysia + Eden Treaty)\n");

	// ========================================================================
	// 1. Browse Barbers (CMS CRUD)
	// ========================================================================

	console.log("📋 Fetching active barbers...");
	const { docs: barbers } = await client.collections.barbers.find({
		where: { isActive: true },
		orderBy: { name: "asc" },
	});

	console.log(`Found ${barbers.length} barbers:`);
	for (const barber of barbers) {
		console.log(` - ${barber.name} (${barber.email})`);
	}
	console.log();

	// ========================================================================
	// 2. Browse Services (CMS CRUD)
	// ========================================================================

	console.log("💇 Fetching available services...");
	const { docs: services } = await client.collections.services.find({
		orderBy: { price: "asc" },
	});

	console.log(`Found ${services.length} services:`);
	for (const service of services) {
		console.log(
			`  - ${service.name}: $${service.price / 100} (${service.duration} min)`,
		);
	}
	console.log();

	// ========================================================================
	// 3. Check Availability (Custom API with Eden Treaty)
	// ========================================================================

	if (barbers.length > 0 && services.length > 0) {
		const barber = barbers[0];
		const service = services[0];
		const tomorrow = new Date();
		tomorrow.setDate(tomorrow.getDate() + 1);
		const date = tomorrow.toISOString().split("T")[0]; // YYYY-MM-DD

		console.log(`🗓️  Checking availability for ${barber.name} on ${date}...`);

		// ✨ Eden Treaty - fully type-safe, no $get suffix!
		const availability = await client.api
			.barbers({ barberId: barber.id })
			.availability.get({
				query: {
					date,
					serviceId: service.id,
				},
			});

		// ✨ Response is already typed, no need for .json()!
		if (availability.data) {
			console.log(
				`Available slots: ${availability.data.availableSlots.join(", ")}`,
			);
		}
		console.log();

		// ====================================================================
		// 4. Book Appointment (Custom API)
		// ====================================================================

		console.log("📅 Booking appointment...");

		// First, you need to be authenticated
		// For demo purposes, we'll show the request structure

		const bookingData = {
			barberId: barber.id,
			serviceId: service.id,
			scheduledAt: new Date(tomorrow.setHours(10, 0, 0, 0)).toISOString(),
			notes: "First time customer",
		};

		console.log("Booking payload:", bookingData);
		console.log("(Requires authentication - see server.ts for auth setup)");
		console.log();

		// Example of actual booking (when authenticated):
		/*
		const booking = await client.api.appointments.book.post(bookingData);

		if (booking.data) {
			console.log('✅ Appointment booked:', booking.data.appointment);
		}
		*/
	}

	// ========================================================================
	// 5. Get My Appointments (Custom API)
	// ========================================================================

	console.log("📝 Fetching my appointments...");
	console.log("(Requires authentication)");
	console.log();

	// Example when authenticated:
	/*
	const myAppointments = await client.api.my.appointments.get();

	if (myAppointments.data) {
		console.log(`You have ${myAppointments.data.appointments.length} appointments:`);
		for (const apt of myAppointments.data.appointments) {
			console.log(`  - ${apt.scheduledAt}: ${apt.service.name} with ${apt.barber.name}`);
		}
	}
	*/

	// ========================================================================
	// 6. Cancel Appointment (Custom API)
	// ========================================================================

	console.log("❌ Cancelling appointment...");
	console.log("(Requires authentication and appointment ID)");
	console.log();

	// Example when authenticated:
	/*
	const appointmentId = 'some-uuid';
	const cancellation = await client.api.appointments[':id'].cancel.post({
		params: { id: appointmentId },
		body: {
			reason: 'Schedule conflict'
		}
	});

	if (cancellation.data) {
		console.log('✅ Appointment cancelled:', cancellation.data.appointment);
	}
	*/

	// ========================================================================
	// 7. Leave Review (CMS CRUD)
	// ========================================================================

	console.log("⭐ Leaving review...");
	console.log("(After appointment is completed)");
	console.log();

	// Example review:
	/*
	const review = await client.collections.reviews.create({
		appointmentId: 'completed-appointment-id',
		customerId: 'user-id',
		barberId: barber.id,
		rating: 5,
		comment: 'Excellent service! Very professional.'
	});

	console.log('✅ Review posted:', review);
	*/

	// ========================================================================
	// 8. Admin: View All Appointments (CMS CRUD with relations)
	// ========================================================================

	console.log("👨‍💼 Admin: Viewing all appointments with relations...");
	const { docs: allAppointments } = await client.collections.appointments.find({
		limit: 10,
		with: {
			customer: true,
			barber: true,
			service: true,
		},
		orderBy: { scheduledAt: "desc" },
	});

	console.log(`Found ${allAppointments.length} recent appointments`);
	console.log();

	// ========================================================================
	// Summary
	// ========================================================================

	console.log("✨ Summary:");
	console.log(
		"  • Unified Client: Single client for both CMS CRUD and custom routes",
	);
	console.log("  • client.collections.*: CMS CRUD operations");
	console.log(
		"  • client.api.*: Eden Treaty for custom routes (NO $get/$post!)",
	);
	console.log("  • Full end-to-end type safety with Elysia");
	console.log("  • Automatic response parsing - no .json() needed");
	console.log("  • Relations are automatically typed and loaded");
}

// ============================================================================
// Authentication Example
// ============================================================================

async function _authExample() {
	console.log("\n🔐 Authentication Example\n");

	// Register new user
	console.log("Registering new customer...");

	const registerResponse = await fetch(
		`http://${SERVER}/api/auth/sign-up/email`,
		{
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				email: "customer@example.com",
				password: "secure_password_123",
				name: "John Doe",
			}),
		},
	);

	if (registerResponse.ok) {
		const session = await registerResponse.json();
		console.log("✅ Registered:", session.user.email);

		// Now you can use the session token for authenticated requests
		const sessionToken = session.token; // or get from cookies

		// ✨ Eden Treaty with authentication headers
		// Note: You'd need to configure the client with headers
		console.log("Session token:", sessionToken);
		console.log("(Configure client headers for authenticated requests)");
	}
}

// ============================================================================
// Eden Treaty vs Hono RPC Comparison
// ============================================================================

async function _comparisonExample() {
	console.log("\n🔍 Eden Treaty vs Hono RPC Comparison\n");

	console.log("Hono RPC:");
	console.log("  const result = await client.api.route.$get()");
	console.log("  if (result.ok) {");
	console.log("    const data = await result.json()  // Manual parsing");
	console.log("  }");
	console.log();

	console.log("Eden Treaty:");
	console.log("  const result = await client.api.route.get()");
	console.log("  if (result.data) {");
	console.log("    // Data is already parsed and typed!");
	console.log("  }");
	console.log();

	console.log("Benefits of Eden Treaty:");
	console.log("  ✅ No $ prefix needed");
	console.log("  ✅ Automatic response parsing");
	console.log("  ✅ Better type inference");
	console.log("  ✅ Runtime type validation");
	console.log("  ✅ Cleaner API surface");
}

// ============================================================================
// Run Examples
// ============================================================================

if (import.meta.main) {
	try {
		await exampleUsage();
		// await authExample(); // Uncomment to test auth
		// await comparisonExample(); // Uncomment to see comparison
	} catch (error) {
		console.error("Error:", error);
	}
}
