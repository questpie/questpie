/**
 * Hero Block
 *
 * Full-width banner with background image, title, subtitle, and CTA.
 * Design: Modern minimalist with smooth animations.
 *
 * The `backgroundImage` upload field is auto-expanded by the server
 * afterRead hook — no manual prefetch needed.
 */

import { ArrowRight } from "@phosphor-icons/react";
import type { BlockRendererProps } from "@questpie/admin/client";
import { buttonVariants } from "../../../components/ui/button";
import { cn } from "../../../lib/utils";
import { builder } from "../builder";

type HeroValues = {
  title: string;
  subtitle: string;
  backgroundImage: string;
  overlayOpacity: number;
  alignment: "left" | "center" | "right";
  ctaText: string;
  ctaLink: string;
  height: "small" | "medium" | "large" | "full";
};

function HeroRenderer({
  values,
  data,
  children,
}: BlockRendererProps<HeroValues>) {
  // backgroundImage is auto-expanded from ID to full asset record
  const bgAsset = (data as Record<string, any> | undefined)?.backgroundImage;
  const bgImageUrl = bgAsset?.url || values.backgroundImage;

  const heightClass = {
    small: "min-h-[50vh]",
    medium: "min-h-[70vh]",
    large: "min-h-[85vh]",
    full: "min-h-screen",
  }[values.height || "medium"];

  const alignClass = {
    left: "text-left items-start",
    center: "text-center items-center",
    right: "text-right items-end",
  }[values.alignment || "center"];

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

export const heroBlock = builder
  .block("hero")
  .label({ en: "Hero Section", sk: "Hero sekcia" })
  .icon("Image")
  .category("sections")
  .fields(({ r }) => ({
    title: r.text({
      label: { en: "Title", sk: "Nadpis" },
      localized: true,
      required: true,
    }),
    subtitle: r.textarea({
      label: { en: "Subtitle", sk: "Podnadpis" },
      localized: true,
    }),
    backgroundImage: r.upload({
      label: { en: "Background Image", sk: "Obrázok pozadia" },
    }),
    overlayOpacity: r.number({
      label: { en: "Overlay Opacity", sk: "Priehľadnosť" },
      defaultValue: 60,
    }),
    alignment: r.select({
      label: { en: "Alignment", sk: "Zarovnanie" },
      options: [
        { value: "left", label: { en: "Left", sk: "Vľavo" } },
        { value: "center", label: { en: "Center", sk: "Stred" } },
        { value: "right", label: { en: "Right", sk: "Vpravo" } },
      ],
      defaultValue: "center",
    }),
    ctaText: r.text({
      label: { en: "CTA Text", sk: "Text tlačidla" },
      localized: true,
    }),
    ctaLink: r.text({ label: { en: "CTA Link", sk: "Odkaz tlačidla" } }),
    height: r.select({
      label: { en: "Height", sk: "Výška" },
      options: [
        { value: "small", label: { en: "Small", sk: "Malá" } },
        { value: "medium", label: { en: "Medium", sk: "Stredná" } },
        { value: "large", label: { en: "Large", sk: "Veľká" } },
        { value: "full", label: { en: "Full", sk: "Plná" } },
      ],
      defaultValue: "medium",
    }),
  }))
  .renderer(HeroRenderer)
  .build();
