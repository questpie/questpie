import type { Metadata } from "next";

import { Providers } from "./providers";

import "@/styles.css";

export const metadata: Metadata = {
	title: "{{projectName}}",
	description: "A QUESTPIE powered app",
};

export default function RootLayout({
	children,
}: {
	children: React.ReactNode;
}) {
	return (
		<html lang="en">
			<body className="bg-background text-foreground min-h-screen antialiased">
				<Providers>{children}</Providers>
			</body>
		</html>
	);
}
