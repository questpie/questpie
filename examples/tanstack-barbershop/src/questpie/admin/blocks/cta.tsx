/**
 * CTA Block
 *
 * Call to action section with title, description, and button.
 * Design: Bold background colors with contrasting text.
 */

import { ArrowRight } from "@phosphor-icons/react";
import type { BlockProps } from "./types";
import { buttonVariants } from "../../../components/ui/button";
import { cn } from "../../../lib/utils";

export function CTARenderer({ values }: BlockProps<"cta">) {
  const variantStyles = {
    highlight: {
      section: "bg-highlight text-highlight-foreground",
      button: "bg-foreground text-background hover:bg-foreground/90" },
    dark: {
      section: "bg-foreground text-background",
      button: "bg-highlight text-highlight-foreground hover:bg-highlight/90" },
    light: {
      section: "bg-muted text-foreground",
      button: "bg-foreground text-background hover:bg-foreground/90" } }[values.variant || "highlight"]!;

  const sizeStyles = {
    small: "py-12",
    medium: "py-20",
    large: "py-28" }[values.size || "medium"];

  return (
    <section className={cn("px-6", sizeStyles, variantStyles.section)}>
      <div className="container max-w-3xl mx-auto text-center">
        <h2 className="text-3xl sm:text-4xl md:text-5xl font-bold tracking-tight mb-6">
          {values.title}
        </h2>

        {values.description && (
          <p className="text-lg opacity-90 mb-10 max-w-2xl mx-auto">
            {values.description}
          </p>
        )}

        {values.buttonText && (
          <a
            href={values.buttonLink || "/booking"}
            className={cn(
              buttonVariants({ size: "lg" }),
              "group gap-3 text-base font-semibold",
              variantStyles.button,
            )}
          >
            {values.buttonText}
            <ArrowRight
              className="size-5 transition-transform group-hover:translate-x-1"
              weight="bold"
            />
          </a>
        )}
      </div>
    </section>
  );
}

