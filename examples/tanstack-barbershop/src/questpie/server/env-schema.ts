/**
 * Barbershop Client Environment
 *
 * Client-safe vars, keyed by unprefixed logical name. Codegen emits
 * `.generated/env.client.vite.ts` with literal `import.meta.env.VITE_*`
 * references so the bundler can inline them — server keys are physically
 * absent from that module.
 */

import { clientEnv } from "questpie/env";
import { z } from "zod";

export default clientEnv({
	consumers: ["vite"],
	vars: {
		APP_URL: z.string().default("http://localhost:3000"),
	},
});
