/**
 * Database Migration Script
 *
 * Creates all tables and seeds initial data
 */

import { cms } from "./src/cms";

async function migrate() {
	console.log("🔄 Running migrations...\n");

	try {
		// Generate and apply migrations
		await cms.migrations.push();

		console.log("✅ Migrations completed successfully!\n");

		// Seed initial data
		console.log("🌱 Seeding initial data...\n");

		const systemContext = await cms.createContext({
			accessMode: "system",
		});

		// Seed barbers
		console.log("Creating barbers...");
		const barber1 = await cms.api.collections.barbers.create(
			{
				name: "John Smith",
				email: "john@barbershop.com",
				phone: "+1-555-0101",
				bio: "Master barber with 15 years of experience. Specializes in classic cuts and hot towel shaves.",
				isActive: true,
				workingHours: JSON.stringify({
					monday: { start: "09:00", end: "17:00" },
					tuesday: { start: "09:00", end: "17:00" },
					wednesday: { start: "09:00", end: "17:00" },
					thursday: { start: "09:00", end: "17:00" },
					friday: { start: "09:00", end: "17:00" },
					saturday: { start: "10:00", end: "16:00" },
					sunday: null,
				}),
			},
			systemContext,
		);

		const barber2 = await cms.api.collections.barbers.create(
			{
				name: "Mike Johnson",
				email: "mike@barbershop.com",
				phone: "+1-555-0102",
				bio: "Modern stylist specializing in fades and contemporary cuts. Always up-to-date with latest trends.",
				isActive: true,
				workingHours: JSON.stringify({
					monday: { start: "10:00", end: "18:00" },
					tuesday: { start: "10:00", end: "18:00" },
					wednesday: { start: "10:00", end: "18:00" },
					thursday: { start: "10:00", end: "18:00" },
					friday: { start: "10:00", end: "18:00" },
					saturday: { start: "09:00", end: "15:00" },
					sunday: null,
				}),
			},
			systemContext,
		);

		console.log(`  ✓ Created barber: ${barber1.name}`);
		console.log(`  ✓ Created barber: ${barber2.name}`);

		// Seed services
		console.log("\nCreating services...");
		const haircut = await cms.api.collections.services.create(
			{
				name: "Classic Haircut",
				description: "Traditional haircut with scissors and/or clippers",
				duration: 30,
				price: 3500, // $35.00
				isActive: true,
			},
			systemContext,
		);

		const fade = await cms.api.collections.services.create(
			{
				name: "Fade Haircut",
				description: "Modern fade with clean lines and sharp edges",
				duration: 45,
				price: 4500, // $45.00
				isActive: true,
			},
			systemContext,
		);

		const shave = await cms.api.collections.services.create(
			{
				name: "Hot Towel Shave",
				description:
					"Traditional straight razor shave with hot towel and facial massage",
				duration: 30,
				price: 4000, // $40.00
				isActive: true,
			},
			systemContext,
		);

		const combo = await cms.api.collections.services.create(
			{
				name: "Haircut + Shave Combo",
				description: "Get both a haircut and hot towel shave",
				duration: 60,
				price: 6500, // $65.00
				isActive: true,
			},
			systemContext,
		);

		const beard = await cms.api.collections.services.create(
			{
				name: "Beard Trim & Styling",
				description: "Professional beard trimming and styling",
				duration: 20,
				price: 2500, // $25.00
				isActive: true,
			},
			systemContext,
		);

		console.log(`  ✓ Created service: ${haircut.name} ($${haircut.price / 100})`);
		console.log(`  ✓ Created service: ${fade.name} ($${fade.price / 100})`);
		console.log(`  ✓ Created service: ${shave.name} ($${shave.price / 100})`);
		console.log(`  ✓ Created service: ${combo.name} ($${combo.price / 100})`);
		console.log(`  ✓ Created service: ${beard.name} ($${beard.price / 100})`);

		console.log("\n✅ Seeding completed!\n");
		console.log("🎉 Database is ready!");
		console.log("\nNext steps:");
		console.log("  1. Run 'bun run dev' to start the server (port 3001)");
		console.log("  2. Run 'bun run client' to test the API");
		console.log("  3. Run 'bun run worker' to process background jobs\n");

		process.exit(0);
	} catch (error) {
		console.error("❌ Migration failed:", error);
		process.exit(1);
	}
}

migrate();
