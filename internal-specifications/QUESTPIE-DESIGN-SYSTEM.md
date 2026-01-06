# QUESTPIE Design System v2.1 | Technical Manual

This document serves as the official specification for the **QUESTPIE Design System**. It is optimized for AI implementation and designer handoff. It follows a **neutral, modular architecture** compatible with **Tailwind CSS v4** and **shadcn/ui**.

---

## 1. Core Identity & Philosophy

QUESTPIE is a "Cyber-Minimalist" engine. It treats the UI as a high-precision instrument.

* **Logic over Decoration**: Design choices are driven by technical hierarchy.
* **Strict Geometry**: All components utilize a zero-radius policy (`--radius: 0px`).
* **Atmospheric Depth**: Uses pitch-black foundations with light-emitting (Neon) accents and layering via blurs.
* **Native shadcn Integration**: High reusability is achieved by mapping brand identity to standard shadcn semantic variables.

---

## 2. Global Configuration (Tailwind v4)

In Tailwind v4, the system identity is defined via CSS variables. This ensures any standard UI component (Buttons, Inputs, Modals) automatically inherits the QUESTPIE skin.

```css
@import "tailwindcss";

@theme {
  /* Typography */
  --font-sans: "Inter", ui-sans-serif, system-ui;
  --font-mono: "JetBrains Mono", ui-monospace, monospace;

  /* Global Geometry */
  --radius: 0px;

  /* QUESTPIE Palette (OKLCH - P3 Ready) */
  --background: oklch(14% 0 0);           /* Depth Black */
  --foreground: oklch(92% 0.01 255);      /* Ghost White */

  --card: oklch(18% 0 0);                 /* Surface Black */
  --card-foreground: oklch(92% 0.01 255);

  --primary: oklch(55% 0.3 300);          /* Neon Purple Accent */
  --primary-foreground: oklch(100% 0 0);

  --secondary: oklch(22% 0 0);            /* Neutral Surface */
  --secondary-foreground: oklch(55% 0.3 300);

  --muted: oklch(25% 0 0);
  --muted-foreground: oklch(70% 0 0);     /* Softened Gray */

  --border: oklch(32% 0 0);               /* Technical Border */
  --ring: oklch(55% 0.3 300 / 0.5);       /* Glow focus */
}

/* Atmospheric Utilities */
@utility bg-grid-quest {
  background-image: 
    linear-gradient(to right, var(--primary) / 0.05 1px, transparent 1px),
    linear-gradient(to bottom, var(--primary) / 0.05 1px, transparent 1px);
  background-size: 24px 24px;
}

```

---

## 3. Atmospheric Effects & Depth

Depth is created through light emission and transparency, not shadows.

### A. Backdrop Blurs (Layering)

To separate floating layers (Navs, Modals) from the grid background, use `backdrop-blur`.

* **Surface Level**: `bg-card/40 backdrop-blur-md`
* **Overlay Level**: `bg-background/80 backdrop-blur-xl`

### B. Neon Glow (OKLCH Light)

Standard shadows are replaced by "Glows." Using OKLCH ensures the purple maintains its luminance on dark backgrounds.

```css
@utility glow-primary {
  box-shadow: 0 0 20px oklch(55% 0.3 300 / 0.3);
}

@utility ambient-beam {
  background: radial-gradient(circle, var(--primary) / 0.15 0%, transparent 70%);
  filter: blur(100px);
}

```

---

## 4. Universal Component Framework

These are neutral, reusable structures designed to house any content type.

### The Technical Badge

For metadata, tags, or status indicators.

```tsx
<span className="inline-flex border border-primary/20 bg-primary/10 px-2 py-0.5 font-mono text-[10px] text-primary">
  [STATUS_CODE]
</span>

```

### The Standard Container (Card)

A neutral wrapper for projects, features, or data blocks.

```tsx
<div className="group border border-border bg-card/30 p-4 transition-all hover:border-primary/50 hover:bg-card/50">
  <div className="flex items-center gap-3">
    <div className="h-2 w-2 bg-primary shadow-[0_0_8px_var(--primary)]" />
    <h4 className="font-mono text-sm font-bold uppercase">Header_Label</h4>
  </div>
  <p className="mt-2 text-sm text-muted-foreground leading-relaxed">Description goes here.</p>
</div>

```

---

## 5. Typography Matrix

| Role                       | Class                                          | Specification                        |
| -------------------------- | ---------------------------------------------- | ------------------------------------ |
| **H1 - Branding**          | `text-4xl font-bold tracking-tighter`          | Sans-serif, High emphasis            |
| **H2 - Technical Section** | `font-mono text-sm tracking-[0.2em] uppercase` | Monospace, Muted foreground          |
| **Body - Reading**         | `text-sm leading-relaxed`                      | Sans-serif, optimized for legibility |
| **System Labels**          | `font-mono text-[10px] text-primary`           | Monospace, pure data/metadata        |

---

## 6. Rules of Thumb (Operational Manual)

1. **Radius is Forbidden**: Never use `rounded` or `border-radius`. If a component requires a "pill" shape, use a sharp-cornered rectangle instead.
2. **Color Restraint**: Keep the interface 95% monochromatic (`#0a0a0a` and `#e5e5e5`). Reserve `--primary` (Purple) strictly for interactive elements, status, or high-level accents.
3. **The Grid Foundation**: The `bg-grid-quest` should always be present on the background layer at low opacity (max 5%) to provide spatial orientation.
4. **Semantic Reuse**: When using **shadcn/ui**, do not override styles in the component files. Modify the global `--primary` or `--border` variables instead. This preserves the ability to update the component library without breaking the design.
5. **Hover Mechanics**: Every interactive surface must react. The standard interaction is a border color transition: `border-border` → `border-primary/50`.

---

**AI Implementation Note**: When generating UI based on this manual, prioritize `font-mono` for all numerical data and `backdrop-blur` for all sticky or floating elements. Always maintain a 1px border weight for technical consistency.

Would you like me to generate a **Navigation Sidebar** or a **Data Visualization** block based on these specific rules?