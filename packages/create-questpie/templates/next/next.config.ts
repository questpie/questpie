import type { NextConfig } from "next";

const nextConfig: NextConfig = {
	// QUESTPIE is a server framework: its server graph pulls in optional native
	// deps (the S3 storage adapter's @aws-sdk/*, only needed if you use S3) and a
	// dynamic `import()` in the code-execution adapter. Turbopack bundles route
	// handlers eagerly and would choke on those, so the server-only packages must
	// run via native Node `require` instead of being bundled.
	serverExternalPackages: [
		"questpie",
		"@questpie/openapi",
		"drizzle-kit",
		"@aws-sdk/client-s3",
		"bun",
		"pino",
		"pino-pretty",
	],
};

export default nextConfig;
