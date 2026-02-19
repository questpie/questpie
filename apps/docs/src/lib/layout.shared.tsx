import { BookIcon } from "@phosphor-icons/react";
import type { BaseLayoutProps } from "fumadocs-ui/layouts/shared";
import { Logo } from "@/components/Logo";

export function baseOptions(): BaseLayoutProps {
  return {
    nav: {
      url: "/",
      title: <Logo />,
      transparentMode: "always",
    },
    searchToggle: {
      components: {},
    },
    links: [
      {
        text: "Documentation",
        url: "/docs",
        active: "nested-url",
        icon: <BookIcon size={16} />,
      },
      {
        text: "Examples",
        url: "https://github.com/questpie/questpie/tree/main/examples",
        external: true,
      },
      {
        text: "GitHub",
        url: "https://github.com/questpie/questpie",
        external: true,
      },
    ],
  };
}
