/**
 * Hero Block
 *
 * Full-width banner with background image, title, subtitle, and CTA.
 * Design: Modern minimalist with smooth animations.
 *
 * The `backgroundImage` upload field is expanded via `.prefetch({ with: ['backgroundImage'] })`.
 */

import { ArrowRight } from "@phosphor-icons/react";
import type { BlockProps } from "./types";
import { buttonVariants } from "../../../components/ui/button";
import { cn } from "../../../lib/utils";

export function HeroRenderer({
  values,
  data,
  children }: BlockProps<"hero">) {
  const bgImageUrl = data?.backgroundImage?.url as string | undefined;

  const heightClass = {
    small: "min-h-[50vh]",
    medium: "min-h-[70vh]",
    large: "min-h-[85vh]",
    full: "min-h-screen" }[values.height || "medium"];

  const alignClass = {
    left: "text-left items-start",
    center: "text-center items-center",
    right: "text-right items-end" }[values.alignment || "center"];

  return (
    <section
      className={cn(
        "relative flex items-center bg-cover bg-center",
        heightClass,
      )}
      style={{ backgroundImage: bgImageUrl ? `url(${bgImageUrl})` : undefined }}
    >
      {/* Gradient overlay */}
      <div
        className="absolute inset-0 bg-gradient-to-b from-black/60 via-black/40 to-black/70"
        style={{ opacity: (values.overlayOpacity ?? 60) / 100 }}
      />

      {/* Content */}
      <div
        className={cn(
          "relative z-10 container px-6 py-20 flex flex-col gap-6",
          alignClass,
        )}
      >
        <h1 className="text-4xl sm:text-5xl md:text-6xl lg:text-7xl font-bold text-white tracking-tight leading-[1.1] animate-fade-in-up max-w-4xl">
          {values.title}
        </h1>

        {values.subtitle && (
          <p className="text-lg sm:text-xl md:text-2xl text-white/85 max-w-2xl animate-fade-in-up [animation-delay:100ms]">
            {values.subtitle}
          </p>
        )}

        {values.ctaText && (
          <a
            href={values.ctaLink || "/booking"}
            className={cn(
              buttonVariants({ size: "lg" }),
              "mt-4 animate-fade-in-up [animation-delay:200ms]",
              "group gap-3 bg-highlight text-highlight-foreground hover:bg-highlight/90",
              "text-base font-semibold",
            )}
          >
            {values.ctaText}
            <ArrowRight
              className="size-5 transition-transform group-hover:translate-x-1"
              weight="bold"
            />
          </a>
        )}

        {children}
      </div>
    </section>
  );
}

