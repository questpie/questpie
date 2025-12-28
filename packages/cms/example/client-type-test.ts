/**
 * Type-Safety Test for Client
 *
 * This file demonstrates that all client operations are fully type-safe.
 * Uncomment the error examples to see TypeScript catch issues at compile time!
 */

import { createQCMSClient } from "@questpie/cms/client";
import type { cms } from "./cms-instance";

const client = createQCMSClient<typeof cms>({
	baseURL: "http://localhost:3000",
});

// ============================================================================
// ✅ VALID: Type-safe create with all required fields
// ============================================================================

async function validCreate() {
	const barber = await client.collections.barbers.create({
		name: "John Doe", // ✅ Required field
		email: "john@example.com", // ✅ Required field
		phone: "+1234567890", // ✅ Optional field
		bio: "Expert barber", // ✅ Optional field
		isActive: true, // ✅ Optional field with correct type (boolean)
	});

	// ✅ Return type is fully typed
	console.log(barber.id); // ✅ Autocomplete works!
	console.log(barber.name); // ✅ Autocomplete works!
	console.log(barber.email); // ✅ Autocomplete works!
}

// ============================================================================
// ❌ INVALID: Missing required fields
// ============================================================================

async function invalidCreate_MissingFields() {
	// @ts-expect-error - Missing required 'email' field
	await client.collections.barbers.create({
		name: "John Doe",
		// email is required but missing!
	});
}

// ============================================================================
// ❌ INVALID: Wrong field type
// ============================================================================

async function invalidCreate_WrongType() {
	// @ts-expect-error - isActive should be boolean, not string
	await client.collections.barbers.create({
		name: "John Doe",
		email: "john@example.com",
		isActive: "yes", // ❌ Should be boolean!
	});
}

// ============================================================================
// ❌ INVALID: Unknown field
// ============================================================================

async function invalidCreate_UnknownField() {
	await client.collections.barbers.create({
		name: "John Doe",
		email: "john@example.com",
		// @ts-expect-error - 'unknownField' does not exist on barbers
		unknownField: "value",
	});
}

// ============================================================================
// ✅ VALID: Type-safe update with partial data
// ============================================================================

async function validUpdate() {
	const updated = await client.collections.barbers.update("some-id", {
		// ✅ All fields are optional (Partial)
		bio: "Updated bio",
		isActive: false, // ✅ Type-checked: must be boolean
	});

	console.log(updated.name); // ✅ Autocomplete works!
}

// ============================================================================
// ❌ INVALID: Update with wrong type
// ============================================================================

async function invalidUpdate_WrongType() {
	// @ts-expect-error - isActive should be boolean
	await client.collections.barbers.update("some-id", {
		isActive: "no", // ❌ Should be boolean!
	});
}

// ============================================================================
// ✅ VALID: Type-safe find with where clause
// ============================================================================

async function validFind() {
	const barbers = await client.collections.barbers.find({
		where: {
			isActive: true, // ✅ Type-checked
			name: "John", // ✅ Type-checked
		},
		orderBy: {
			name: "asc", // ✅ Must be "asc" or "desc"
		},
		limit: 10,
	});

	// ✅ Return type is Barber[]
	barbers.forEach((barber) => {
		console.log(barber.name); // ✅ Autocomplete!
		console.log(barber.email); // ✅ Autocomplete!
	});
}

// ============================================================================
// ❌ INVALID: Find with unknown field
// ============================================================================

async function invalidFind_UnknownField() {
	await client.collections.barbers.find({
		where: {
			// @ts-expect-error - 'unknownField' does not exist
			unknownField: "value",
		},
	});
}

// ============================================================================
// ❌ INVALID: Find with wrong orderBy direction
// ============================================================================

async function invalidFind_WrongOrderBy() {
	await client.collections.barbers.find({
		orderBy: {
			// @ts-expect-error - Must be "asc" or "desc"
			name: "invalid",
		},
	});
}

// ============================================================================
// Summary
// ============================================================================

/**
 * All operations are type-safe:
 *
 * ✅ create() - Requires all mandatory fields, types are checked
 * ✅ update() - All fields optional (Partial), types are checked
 * ✅ find() - Where clause is type-checked, orderBy is type-checked
 * ✅ findOne() - Same as find
 * ✅ delete() - Type-safe ID parameter
 *
 * ✅ Return types are fully typed (not `any`)
 * ✅ Autocomplete works everywhere
 * ✅ Compile-time errors for invalid usage
 */

export {
	validCreate,
	validUpdate,
	validFind,
	invalidCreate_MissingFields,
	invalidCreate_WrongType,
	invalidCreate_UnknownField,
	invalidUpdate_WrongType,
	invalidFind_UnknownField,
	invalidFind_WrongOrderBy,
};
