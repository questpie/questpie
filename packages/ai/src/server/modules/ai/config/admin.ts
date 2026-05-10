const aiAdminConfig = {
  sidebar: {
    items: [
      {
        type: "group" as const,
        label: { en: "AI" },
        icon: { type: "icon" as const, props: { name: "ph:brain" } },
        items: [
          { type: "collection" as const, collection: "ai_sessions" },
          { type: "collection" as const, collection: "ai_runs" },
          { type: "collection" as const, collection: "ai_workers" },
          { type: "collection" as const, collection: "ai_providers" },
          { type: "collection" as const, collection: "ai_models" },
        ],
      },
    ],
  },
  shell: {
    secondaryRail: {
      component: { type: "aiChatRail" as const, props: {} },
      placement: "right" as const,
      width: 360,
      minWidth: 320,
      maxWidth: 480,
      hiddenOnMobile: true,
      routes: {
        include: ["/admin"],
        match: "prefix" as const,
      },
    },
  },
};

export default aiAdminConfig;
