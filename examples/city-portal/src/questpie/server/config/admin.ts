import { adminConfig } from "#questpie/factories";

export default adminConfig({
    branding: {
        name: "City Portal",
    },
    locale: {
        locales: ["en"],
        defaultLocale: "en",
    },
    sidebar: {
        sections: [
            {
                id: "overview",
                title: "Overview",
                items: [
                    { type: "link", label: "Dashboard", href: "/admin", icon: { type: "icon", props: { name: "ph:house" } } },
                    { type: "global", global: "site_settings" },
                ],
            },
            {
                id: "content",
                title: "Content",
                items: [
                    { type: "collection", collection: "pages" },
                    { type: "collection", collection: "news" },
                    { type: "collection", collection: "announcements" },
                ],
            },
            {
                id: "resources",
                title: "Resources",
                items: [
                    { type: "collection", collection: "documents" },
                    { type: "collection", collection: "contacts" },
                ],
            },
            {
                id: "engagement",
                title: "Engagement",
                items: [{ type: "collection", collection: "submissions" }],
            },
            {
                id: "administration",
                title: "Administration",
                items: [
                    { type: "collection", collection: "cities" },
                    { type: "collection", collection: "cityMembers" },
                ],
            },
            {
                id: "external",
                title: "External",
                items: [
                    { type: "link", label: "View Website", href: "/", external: true, icon: { type: "icon", props: { name: "ph:arrow-square-out" } } },
                ],
            },
        ],
    },
    dashboard: {
        title: "City Portal Dashboard",
        description: "Content management overview for your city portal",
        actions: [
            { id: "new-page", label: "New Page", icon: { type: "icon", props: { name: "ph:article" } }, variant: "primary", href: "/admin/collections/pages/create" },
            { id: "new-article", label: "New Article", icon: { type: "icon", props: { name: "ph:newspaper" } }, variant: "outline", href: "/admin/collections/news/create" },
            { id: "edit-site-settings", label: "Site Settings", icon: { type: "icon", props: { name: "ph:gear" } }, variant: "outline", href: "/admin/globals/site_settings" },
        ],
        columns: 4,
        sections: [
            { id: "content-overview", label: "Content Overview", layout: "grid", columns: 4 },
            { id: "recent-activity", label: "Recent Activity", layout: "grid", columns: 4 },
        ],
        items: [
            { sectionId: "content-overview", id: "published-pages", type: "stats", collection: "pages", label: "Published Pages", filter: { isPublished: true }, span: 1 },
            { sectionId: "content-overview", id: "published-news", type: "stats", collection: "news", label: "News Articles", filter: { isPublished: true }, span: 1 },
            { sectionId: "content-overview", id: "active-announcements", type: "stats", collection: "announcements", label: "Announcements", span: 1 },
            { sectionId: "content-overview", id: "new-submissions", type: "stats", collection: "submissions", label: "New Submissions", filter: { status: "new" }, span: 1 },
            { sectionId: "recent-activity", id: "recent-submissions", type: "recentItems", collection: "submissions", label: "Recent Submissions", dateField: "createdAt", limit: 6, span: 2 },
            { sectionId: "recent-activity", id: "recent-news", type: "recentItems", collection: "news", label: "Latest News", dateField: "publishedAt", limit: 6, span: 2 },
        ],
    },
});
