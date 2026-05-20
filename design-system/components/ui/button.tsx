// components/ui/button.tsx — shadcn Button with QUESTPIE depth-shadow primary
//
// Drop alongside tokens.css. Requires shadcn helpers (cn, Slot, cva).
// Tokens come from tokens.css; this file references them via CSS variables
// so theme + light/dark + custom primary swap inherit automatically.

import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-[background-color,color,border-color,box-shadow,transform] duration-150 active:translate-y-px focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2 disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        // Depth brand CTA — gradient + inset highlight + brand glow + bottom shadow
        primary:
          "text-primary-foreground bg-[linear-gradient(to_bottom,color-mix(in_srgb,var(--primary)_100%,white_4%),var(--primary))] " +
          "shadow-[inset_0_1px_0_0_color-mix(in_srgb,white_22%,transparent),inset_0_-1px_0_0_color-mix(in_srgb,black_18%,transparent),0_1px_2px_-1px_color-mix(in_srgb,var(--primary)_60%,transparent),0_2px_6px_-2px_rgba(0,0,0,0.35)] " +
          "hover:bg-[linear-gradient(to_bottom,color-mix(in_srgb,var(--primary)_100%,white_10%),color-mix(in_srgb,var(--primary)_95%,white_0%))]",
        secondary:
          "text-foreground border border-border " +
          "bg-[linear-gradient(to_bottom,color-mix(in_srgb,var(--card)_100%,var(--foreground)_2%),var(--card))] " +
          "shadow-[inset_0_1px_0_0_color-mix(in_srgb,var(--foreground)_6%,transparent),0_1px_2px_-1px_rgba(0,0,0,0.18)] " +
          "hover:bg-secondary hover:border-border-strong",
        ghost:
          "text-muted-foreground hover:bg-secondary hover:text-foreground",
        destructive:
          "bg-destructive text-white hover:opacity-90",
      },
      size: {
        sm: "h-8 px-3 rounded-sm text-[13px]",
        md: "h-10 px-4",
        lg: "h-11 px-5",
        icon: "h-8 w-8 p-0 rounded-sm",
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        ref={ref}
        className={cn(buttonVariants({ variant, size, className }))}
        {...props}
      />
    );
  }
);
Button.displayName = "Button";
