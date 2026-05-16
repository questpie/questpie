import { sql } from "questpie/drizzle";

import { app } from "#questpie";

const email = "info@questpie.com";
const password = "admin123";
const name = "Questpie Admin";

await app.db.execute(sql`
	DELETE FROM "account"
	WHERE "userId" IN (SELECT "id" FROM "user" WHERE "email" = ${email})
`);
await app.db.execute(sql`
	DELETE FROM "session"
	WHERE "userId" IN (SELECT "id" FROM "user" WHERE "email" = ${email})
`);
await app.db.execute(sql`
	DELETE FROM "user"
	WHERE "email" = ${email}
`);

const signUp = await app.auth.api.signUpEmail({
	body: { email, password, name },
});

if (!signUp.user?.id) {
	throw new Error("Better Auth did not return a user for dev admin setup");
}

await app.db.execute(sql`
	UPDATE "user"
	SET "role" = 'admin', "emailVerified" = true, "name" = ${name}
	WHERE "id" = ${signUp.user.id}
`);

console.log(`Dev admin ready: ${email} / ${password}`);
