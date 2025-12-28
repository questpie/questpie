/**
 * Quick type inference test
 * This file tests if autocomplete works correctly
 */

import { createClientFromEden } from "@questpie/elysia/client";
import { cms } from "./src/cms";
import type { App } from "./src/server";

const client = createClientFromEden<App, typeof cms>({
	server: "localhost:3001",
});

// Test 1: Collection names should autocomplete
// Try typing: client.collections.
// Should show: barbers, services, appointments, reviews, questpie_assets, questpie_users, etc.

// Test 2: Collection methods should autocomplete
// Try typing: client.collections.barbers.
// Should show: find, findOne, create, update, delete

// Test 3: Results should be typed
async function testTypes() {
	// This should have proper types
	const barbers = await client.collections.barbers.find();

	// barbers should be typed as array
	// barbers[0] should have: id, name, email, phone, bio, avatar, isActive, workingHours, etc.

	const firstBarber = barbers[0];

	// These should all autocomplete:
	console.log(firstBarber?.name); // string
	console.log(firstBarber?.email); // string
	console.log(firstBarber?.isActive); // boolean

	// Test with options
	const activeBarbers = await client.collections.barbers.find({
		where: { isActive: true }, // Should autocomplete fields
		orderBy: { name: "asc" }, // Should autocomplete fields
		limit: 10,
	});

	console.log("Type test completed!", activeBarbers.length);
}

// Don't run, just for type checking
if (false) {
	testTypes();
}

export {};
