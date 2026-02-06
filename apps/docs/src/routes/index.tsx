import { createFileRoute } from "@tanstack/react-router";
import { HomeLayout } from "fumadocs-ui/layouts/home";
import { AdminExperience } from "@/components/landing/AdminExperience";
import { CallToAction } from "@/components/landing/CallToAction";
import { Examples } from "@/components/landing/Examples";
import { Features } from "@/components/landing/Features";
import { Footer } from "@/components/landing/Footer";
import { Frameworks } from "@/components/landing/Frameworks";
import { Hero } from "@/components/landing/Hero";
import { getRandomHeadlineIndex } from "@/components/landing/headlines";
import { HowItWorks } from "@/components/landing/HowItWorks";
import { Navbar } from "@/components/landing/Navbar";
import { NumbersStrip } from "@/components/landing/NumbersStrip";
import { Stack } from "@/components/landing/Stack";
import { UseCases } from "@/components/landing/UseCases";
import { baseOptions } from "@/lib/layout.shared";
import { generateJsonLd, generateMeta, siteConfig } from "@/lib/seo";

export const Route = createFileRoute("/")({
  component: Home,
  head: () => ({
    meta: generateMeta({
      title: siteConfig.title,
      description: siteConfig.description,
      url: siteConfig.url,
    }),
    scripts: [
      {
        type: "application/ld+json",
        children: JSON.stringify(generateJsonLd()),
      },
    ],
  }),
  loader: () => {
    return {
      headlineIndex: getRandomHeadlineIndex(),
    };
  },
  headers: () => ({
    "Cache-Control":
      "public, max-age=86400, s-maxage=86400, stale-while-revalidate=604800",
  }),
  staleTime: 60 * 60_000,
  gcTime: 2 * 60 * 60_000,
});

function Home() {
  const { headlineIndex } = Route.useLoaderData();

  return (
    <HomeLayout {...baseOptions()} nav={{ component: <Navbar /> }}>
      <div className="flex flex-col min-h-screen text-foreground font-sans selection:bg-primary/20 selection:text-primary">
        {/* Background Grid - more subtle with fade overlay */}
        <div className="fixed inset-0 bg-grid-quest opacity-[0.02] pointer-events-none z-0" />
        {/* Subtle gradient overlay to soften grid visibility */}
        <div className="fixed inset-0 bg-gradient-to-b from-background/30 via-transparent to-background/30 pointer-events-none z-0" />

        {/* Layout Guide Lines */}
        <div className="fixed inset-0 pointer-events-none z-[1] flex justify-center px-4">
          <div className="w-full max-w-7xl h-full border-x border-border/30 relative">
            <div className="absolute top-0 bottom-0 left-1/4 w-px bg-border/10 hidden md:block" />
            <div className="absolute top-0 bottom-0 left-2/4 w-px bg-border/10 hidden md:block" />
            <div className="absolute top-0 bottom-0 left-3/4 w-px bg-border/10 hidden md:block" />

            {/* Crosshairs */}
            <div className="absolute top-24 -left-1.5 w-3 h-3 text-border/40 font-mono text-[10px] flex items-center justify-center">
              +
            </div>
            <div className="absolute top-24 -right-1.5 w-3 h-3 text-border/40 font-mono text-[10px] flex items-center justify-center">
              +
            </div>
            <div className="absolute bottom-24 -left-1.5 w-3 h-3 text-border/40 font-mono text-[10px] flex items-center justify-center">
              +
            </div>
            <div className="absolute bottom-24 -right-1.5 w-3 h-3 text-border/40 font-mono text-[10px] flex items-center justify-center">
              +
            </div>
          </div>
        </div>

        {/* Main Content */}
        <main className="flex-1 relative z-10">
          <Hero headlineIndex={headlineIndex} />
          <NumbersStrip />
          <HowItWorks />
          <AdminExperience />
          <Features />
          <Stack />
          <Frameworks />
          <UseCases />
          <Examples />
          <CallToAction />
        </main>

        <Footer />
      </div>
    </HomeLayout>
  );
}
