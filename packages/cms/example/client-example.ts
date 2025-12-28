/**
 * Type-Safe Client Example
 *
 * Demonstrates how the client provides full type safety for:
 * - Collection operations (find, findOne, create, update, delete)
 * - Field autocomplete
 * - Type checking for data payloads
 */

import { createQCMSClient } from "@questpie/cms/client";
import type { cms } from "./cms-instance"; // Import your CMS instance type

// ============================================================================
// Create Type-Safe Client
// ============================================================================

const client = createQCMSClient<typeof cms>({
	baseURL: "http://localhost:3000",
});

// ============================================================================
// Type-Safe Examples
// ============================================================================

async function exampleUsage() {
	// ========================================================================
	// 1. Find with Type-Safe Where Clause
	// ========================================================================

	const barbers = await client.collections.barbers.find({
		where: {
			// ✅ Type-safe: isActive is known to be boolean
			isActive: true,
			// ✅ Autocomplete works for all barber fields
			// ❌ TypeScript error if you use non-existent field
			// unknownField: 'value' // <- Would error!
		},
		orderBy: {
			// ✅ Type-safe: name is known field
			name: "asc",
			// ❌ TypeScript error for invalid direction
			// name: 'invalid' // <- Would error!
		},
		limit: 10,
	});

	// ✅ Return type is typed as Barber[]
	// ✅ Autocomplete works on results
	for (const barber of barbers) {
		console.log(barber.name); // ✅ Autocomplete!
		console.log(barber.email); // ✅ Autocomplete!
		console.log(barber.isActive); // ✅ Autocomplete!
		// console.log(barber.unknownField); // ❌ TypeScript error!
	}

	// ========================================================================
	// 2. Create with Type-Safe Insert Data
	// ========================================================================

	const newBarber = await client.collections.barbers.create({
		// ✅ Type-safe: all required fields must be provided
		name: "John Doe",
		email: "john@example.com",
		// ✅ Optional fields
		phone: "+1234567890",
		bio: "Experienced barber with 10 years of experience",
		isActive: true,
		// ❌ TypeScript error if you use non-existent field
		// unknownField: 'value' // <- Would error!
		// ❌ TypeScript error if you miss required fields
	});

	console.log("Created barber:", newBarber.id, newBarber.name);

	// ========================================================================
	// 3. Update with Type-Safe Partial Data
	// ========================================================================

	const updatedBarber = await client.collections.barbers.update(newBarber.id, {
		// ✅ All fields are optional (Partial<Barber>)
		bio: "Updated bio",
		// ✅ Type-safe: isActive must be boolean
		isActive: false,
		// ❌ TypeScript error if wrong type
		// isActive: 'yes' // <- Would error!
	});

	console.log("Updated barber:", updatedBarber.name);

	// ========================================================================
	// 4. FindOne with Type-Safe ID
	// ========================================================================

	const barber = await client.collections.barbers.findOne({
		where: {
			// ✅ ID is required
			id: newBarber.id,
			// ✅ Additional filters are optional
			isActive: true,
		},
	});

	if (barber) {
		console.log("Found barber:", barber.name);
	}

	// ========================================================================
	// 5. Delete with Type-Safe ID
	// ========================================================================

	const deleted = await client.collections.barbers.delete(newBarber.id);
	console.log("Deleted:", deleted.success);

	// ========================================================================
	// 6. Complex Queries with Relations
	// ========================================================================

	const appointments = await client.collections.appointments.find({
		where: {
			// ✅ Type-safe appointment fields
			status: "pending",
		},
		with: {
			// ✅ Type-safe relations
			barber: true,
			service: true,
			customer: true,
		},
		orderBy: {
			scheduledAt: "desc",
		},
		limit: 20,
	});

	// ✅ Relations are typed
	for (const apt of appointments) {
		// ✅ Autocomplete on related data
		// console.log(apt.barber?.name);
		// console.log(apt.service?.name);
		// console.log(apt.customer?.email);
	}
}

// ============================================================================
// Comparison: Before vs After
// ============================================================================

// BEFORE (without type-safety):
// ❌ No autocomplete
// ❌ No type checking
// ❌ Runtime errors if you use wrong field names
// ❌ No help from IDE

// AFTER (with type-safety):
// ✅ Full autocomplete for all fields
// ✅ Compile-time type checking
// ✅ Catch errors before running code
// ✅ IDE shows all available fields and their types

export { client, exampleUsage };
