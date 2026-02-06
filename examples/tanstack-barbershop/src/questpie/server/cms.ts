import { adminModule, adminRpc } from "@questpie/admin/server";
import { ConsoleAdapter, pgBossAdapter, q, rpc, SmtpAdapter } from "questpie";
// Import blocks
import { blocks } from "@/questpie/admin/blocks";
// Import jobs
import { appointments } from "@/questpie/server/collections";
import {
  createBooking,
  getActiveBarbers,
  getAvailableTimeSlots,
  getRevenueStats,
} from "@/questpie/server/functions";
import { migrations } from "../../migrations";
import { barberServices } from "./collections/barber-services";
// Import collections
import { barbers } from "./collections/barbers";
import { pages } from "./collections/pages";
import { reviews } from "./collections/reviews";
import { services } from "./collections/services";
// Import globals
import { siteSettings } from "./globals";
import {
  sendAppointmentCancellation,
  sendAppointmentConfirmation,
  sendAppointmentReminder,
} from "./jobs";

const DATABASE_URL =
  process.env.DATABASE_URL || "postgres://localhost/barbershop";

// ============================================================================
// I18n Messages (Backend + Admin UI)
// ============================================================================

/**
 * Backend messages for API responses and validation errors.
 * These are used by the server for error messages, etc.
 */
const backendMessages = {
  en: {
    "appointment.created": "Appointment booked for {{date}} at {{time}}",
    "appointment.cancelled": "Appointment has been cancelled",
    "appointment.slotNotAvailable": "This time slot is no longer available",
    "appointment.pastDateNotAllowed": "Cannot book appointments in the past",
    "barber.notAvailable": "Selected barber is not available at this time",
    "service.notOffered": "Selected service is not offered by this barber",
  },
  sk: {
    "appointment.created": "Rezervácia vytvorená na {{date}} o {{time}}",
    "appointment.cancelled": "Rezervácia bola zrušená",
    "appointment.slotNotAvailable": "Tento termín už nie je dostupný",
    "appointment.pastDateNotAllowed":
      "Nie je možné rezervovať termín v minulosti",
    "barber.notAvailable": "Vybraný holič nie je v tomto čase dostupný",
    "service.notOffered": "Vybranú službu tento holič neposkytuje",
  },
} as const;

/**
 * Admin UI messages for the barbershop app.
 * These are fetched by the admin client via getAdminTranslations() RPC.
 *
 * The admin client will merge these with built-in admin messages
 * (common.save, auth.login, etc.) automatically.
 */
const adminUiMessages = {
  en: {
    // Custom labels for barbershop
    "barbershop.welcome": "Welcome to Barbershop Admin",
    "barbershop.bookNow": "Book Now",
    "barbershop.todaysAppointments": "Today's Appointments",
    "barbershop.upcomingSlots": "Upcoming Slots",
    "barbershop.activeBarbers": "Active Barbers",
    "barbershop.totalServices": "Total Services",
    "barbershop.pendingReviews": "Pending Reviews",
    // Collection-specific labels
    "collection.barbers.title": "Barbers",
    "collection.barbers.description": "Manage your team of barbers",
    "collection.services.title": "Services",
    "collection.services.description": "Hair cutting and styling services",
    "collection.appointments.title": "Appointments",
    "collection.appointments.description": "Customer bookings and schedules",
  },
  sk: {
    // Custom labels for barbershop
    "barbershop.welcome": "Vitajte v Barbershop Admin",
    "barbershop.bookNow": "Rezervovať",
    "barbershop.todaysAppointments": "Dnešné rezervácie",
    "barbershop.upcomingSlots": "Nadchádzajúce termíny",
    "barbershop.activeBarbers": "Aktívni holiči",
    "barbershop.totalServices": "Celkom služieb",
    "barbershop.pendingReviews": "Čakajúce recenzie",
    // Collection-specific labels
    "collection.barbers.title": "Holiči",
    "collection.barbers.description": "Spravujte váš tím holičov",
    "collection.services.title": "Služby",
    "collection.services.description": "Strihanie a úprava vlasov",
    "collection.appointments.title": "Rezervácie",
    "collection.appointments.description": "Zákaznícke rezervácie a rozvrhy",
  },
} as const;

// ============================================================================
// CMS Instance
// ============================================================================

const baseInstance = q({
  name: "base",
})
  .use(adminModule)
  .blocks(blocks as any)
  .collections({
    barbers,
    services,
    barberServices,
    appointments,
    reviews,
    pages,
  })
  // Define global settings
  .globals({
    siteSettings,
  })
  // Sidebar navigation
  .sidebar(({ s, c }) =>
    s.sidebar({
      sections: [
        s.section({
          id: "overview",
          title: { en: "Overview", sk: "Prehľad" },
          items: [
            {
              type: "link",
              label: { en: "Dashboard", sk: "Dashboard" },
              href: "/admin",
            },
            {
              type: "global",
              global: "siteSettings",
              label: { en: "Site Settings", sk: "Nastavenia webu" },
            },
          ],
        }),
        s.section({
          id: "operations",
          title: { en: "Operations", sk: "Prevádzka" },
          items: [
            {
              type: "collection",
              collection: "appointments",
              label: { en: "Appointments", sk: "Rezervácie" },
            },
            {
              type: "collection",
              collection: "reviews",
              label: { en: "Reviews", sk: "Recenzie" },
            },
          ],
        }),
        s.section({
          id: "content",
          title: { en: "Content", sk: "Obsah" },
          items: [
            {
              type: "collection",
              collection: "pages",
              label: { en: "Pages", sk: "Stránky" },
            },
            {
              type: "collection",
              collection: "services",
              label: { en: "Services", sk: "Služby" },
            },
          ],
        }),
        s.section({
          id: "team",
          title: { en: "Team", sk: "Tím" },
          items: [
            {
              type: "collection",
              collection: "barbers",
              label: { en: "Barbers", sk: "Holiči" },
            },
            {
              type: "collection",
              collection: "barberServices",
              label: { en: "Barber Services", sk: "Služby holičov" },
            },
          ],
        }),
        s.section({
          id: "external",
          title: { en: "External", sk: "Externé" },
          items: [
            {
              type: "link",
              label: { en: "Open Website", sk: "Otvoriť web" },
              href: "/",
              external: true,
            },
          ],
        }),
      ],
    }),
  )
  // Branding
  .branding({
    name: { en: "Barbershop Control", sk: "Riadenie barbershopu" },
  })
  // Dashboard
  .dashboard(({ d }: any) =>
    d.dashboard({
      title: { en: "Barbershop Control", sk: "Riadenie barbershopu" },
      description: {
        en: "Live operations, content, and business performance overview",
        sk: "Prehľad prevádzky, obsahu a výkonu podniku v reálnom čase",
      },
      columns: 4,
      realtime: true,
      items: [
        {
          type: "section",
          label: { en: "Today", sk: "Dnes" },
          layout: "grid",
          columns: 4,
          items: [
            {
              id: "appointments-today",
              type: "stats",
              collection: "appointments",
              label: { en: "Today's Appointments", sk: "Dnešné rezervácie" },
              dateFilter: { field: "scheduledAt", range: "today" },
              variant: "primary",
              span: 1,
            },
            {
              id: "pending-appointments",
              type: "stats",
              collection: "appointments",
              label: { en: "Pending", sk: "Čakajúce" },
              filter: { status: "pending" },
              variant: "warning",
              span: 1,
            },
            {
              id: "active-barbers",
              type: "stats",
              collection: "barbers",
              label: { en: "Active Barbers", sk: "Aktívni holiči" },
              filter: { isActive: true },
              variant: "success",
              span: 1,
            },
            {
              id: "published-pages",
              type: "stats",
              collection: "pages",
              label: { en: "Published Pages", sk: "Publikované stránky" },
              filter: { isPublished: true },
              variant: "default",
              span: 1,
            },
          ],
        },
        {
          type: "section",
          label: { en: "Business", sk: "Biznis" },
          layout: "grid",
          columns: 4,
          items: [
            {
              id: "monthly-revenue",
              type: "value",
              span: 2,
              cardVariant: "featured",
              refreshInterval: 1000 * 60 * 5,
              fetchFn: async ({ app }: any) => {
                const now = new Date();
                const currentStart = new Date(
                  now.getFullYear(),
                  now.getMonth(),
                  1,
                ).toISOString();
                const currentEnd = now.toISOString();
                const previousStart = new Date(
                  now.getFullYear(),
                  now.getMonth() - 1,
                  1,
                ).toISOString();
                const previousEnd = new Date(
                  now.getFullYear(),
                  now.getMonth(),
                  0,
                  23,
                  59,
                  59,
                  999,
                ).toISOString();

                const [currentStats, previousStats] = await Promise.all([
                  app.api.functions.getRevenueStats({
                    startDate: currentStart,
                    endDate: currentEnd,
                    completedOnly: true,
                  }),
                  app.api.functions.getRevenueStats({
                    startDate: previousStart,
                    endDate: previousEnd,
                    completedOnly: true,
                  }),
                ]);

                const change =
                  previousStats.totalRevenue === 0
                    ? currentStats.totalRevenue > 0
                      ? 100
                      : 0
                    : Math.round(
                        ((currentStats.totalRevenue -
                          previousStats.totalRevenue) /
                          previousStats.totalRevenue) *
                          100,
                      );

                const revenue = currentStats.totalRevenue / 100;

                return {
                  value: revenue,
                  formatted: `${revenue.toLocaleString()} €`,
                  label: {
                    en: "Monthly Revenue",
                    sk: "Mesačné tržby",
                  },
                  subtitle: {
                    en: `${currentStats.appointmentCount} completed appointments`,
                    sk: `${currentStats.appointmentCount} dokončených rezervácií`,
                  },
                  trend: {
                    value: `${change >= 0 ? "+" : ""}${change}%`,
                  },
                };
              },
            },
            {
              id: "revenue-goal",
              type: "progress",
              span: 1,
              showPercentage: true,
              title: { en: "Monthly Goal", sk: "Mesačný cieľ" },
              fetchFn: async ({ app }: any) => {
                const now = new Date();
                const currentStart = new Date(
                  now.getFullYear(),
                  now.getMonth(),
                  1,
                ).toISOString();
                const stats = await app.api.functions.getRevenueStats({
                  startDate: currentStart,
                  endDate: now.toISOString(),
                  completedOnly: true,
                });
                const target = 500000;

                return {
                  current: stats.totalRevenue,
                  target,
                  label: `${(stats.totalRevenue / 100).toLocaleString()} € / ${(target / 100).toLocaleString()} €`,
                  subtitle:
                    stats.totalRevenue >= target
                      ? "Goal reached"
                      : `${((target - stats.totalRevenue) / 100).toLocaleString()} € to go`,
                };
              },
            },
            {
              id: "appointments-by-status",
              type: "chart",
              collection: "appointments",
              field: "status",
              chartType: "pie",
              label: {
                en: "Appointments by Status",
                sk: "Rezervácie podľa stavu",
              },
              span: 1,
            },
          ],
        },
        {
          type: "section",
          label: { en: "Operations", sk: "Prevádzka" },
          layout: "grid",
          columns: 4,
          items: [
            {
              id: "recent-appointments",
              type: "recentItems",
              collection: "appointments",
              label: { en: "Recent Appointments", sk: "Posledné rezervácie" },
              limit: 6,
              dateField: "scheduledAt",
              subtitleFields: ["status"],
              span: 2,
            },
            {
              id: "activity-stream",
              type: "timeline",
              title: { en: "Activity", sk: "Aktivita" },
              maxItems: 8,
              showTimestamps: true,
              timestampFormat: "relative",
              fetchFn: async ({ app }: any) => {
                const res = await app.api.collections.appointments.find({
                  limit: 8,
                  orderBy: { updatedAt: "desc" },
                });

                return res.docs.map((apt: any) => ({
                  id: apt.id,
                  title: apt.displayTitle || apt.id,
                  description: `Status: ${apt.status}`,
                  timestamp: apt.updatedAt || apt.createdAt,
                  variant:
                    apt.status === "completed"
                      ? "success"
                      : apt.status === "cancelled" || apt.status === "no-show"
                        ? "error"
                        : apt.status === "confirmed"
                          ? "info"
                          : "warning",
                  href: `/admin/collections/appointments/${apt.id}`,
                }));
              },
              span: 1,
            },
            {
              id: "quick-actions",
              type: "quickActions",
              title: { en: "Quick Actions", sk: "Rýchle akcie" },
              layout: "list",
              quickActions: [
                {
                  label: {
                    en: "New Appointment",
                    sk: "Nová rezervácia",
                  },
                  href: "/admin/collections/appointments/create",
                  variant: "primary",
                },
                {
                  label: { en: "Add Barber", sk: "Pridať holiča" },
                  href: "/admin/collections/barbers/create",
                },
                {
                  label: {
                    en: "Edit Site Settings",
                    sk: "Upraviť nastavenia webu",
                  },
                  href: "/admin/globals/siteSettings",
                  variant: "outline",
                },
              ],
              span: 1,
            },
          ],
        },
      ],
    }),
  )
  // Define background jobs
  .jobs({
    sendAppointmentConfirmation,
    sendAppointmentCancellation,
    sendAppointmentReminder,
  })
  // Configure content locales (for i18n tables)
  .locale({
    locales: [
      {
        code: "en",
        label: "English",
        fallback: true,
        flagCountryCode: "us", // Show US flag instead of UK
      },
      { code: "sk", label: "Slovenčina" },
    ],
    defaultLocale: "en",
    fallbacks: {
      "en-US": "en",
      "en-GB": "en",
    },
  })
  // Configure admin UI locales (separate from content locales)
  // The admin interface can be in different languages than the content
  .adminLocale({
    locales: ["en", "sk"],
    defaultLocale: "en",
  })
  // Add custom messages for both backend and admin UI
  // Backend messages are used for API error messages
  // Admin UI messages are fetched by the client via getAdminTranslations()
  .messages({
    ...backendMessages,
    // Merge admin UI messages (they get merged with built-in admin messages)
    en: { ...backendMessages.en, ...adminUiMessages.en },
    sk: { ...backendMessages.sk, ...adminUiMessages.sk },
  })
  // Configure authentication (Better Auth)
  .auth({
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: false,
    },
    baseURL: process.env.APP_URL || "http://localhost:3000",
    basePath: "/api/cms/auth",
    secret:
      process.env.BETTER_AUTH_SECRET || "demo-secret-change-in-production",
  })
  // Add migrations
  .migrations(migrations);

export const cms = q({ name: "barbershop" })
  // Include starter module for auth and file uploads
  .use(baseInstance)
  // Build with runtime configuration
  .build({
    app: {
      url: process.env.APP_URL || "http://localhost:3000",
    },
    db: {
      url: DATABASE_URL,
    },
    storage: {
      basePath: "/api/cms",
    },
    secret: process.env.SECRET,
    email: {
      adapter:
        process.env.MAIL_ADAPTER === "console"
          ? new ConsoleAdapter({ logHtml: false })
          : new SmtpAdapter({
              transport: {
                host: process.env.SMTP_HOST || "localhost",
                port: Number.parseInt(process.env.SMTP_PORT || "1025", 10),
                secure: false,
              },
            }),
    },
    queue: {
      adapter: pgBossAdapter({
        connectionString: DATABASE_URL,
      }),
    },
  });

const r = rpc();

export const appRpc = r.router({
  ...adminRpc,
  getActiveBarbers,
  getRevenueStats,
  getAvailableTimeSlots,
  createBooking,
});

// ============================================================================
// Type Exports
// ============================================================================

/**
 * Full CMS runtime type including modules, collections, globals, and jobs.
 * Use this type with getApp<AppCMS>() in hooks and jobs.
 */
export type AppCMS = typeof cms;
export type AppRpc = typeof appRpc;

/**
 * Base CMS shape without runtime/RPC coupling - useful in RPC handlers
 * to avoid circular dependencies.
 * Use this with getApp<BaseCMS>() when defining procedures that need to reference the CMS.
 *
 * @example
 * ```ts
 * import { getApp } from "questpie";
 * import type { BaseCMS } from "./cms";
 *
 * export const getStats = q.fn({
 *   handler: async ({ app }) => {
 *     const cms = getApp<BaseCMS>(app);
 *     return cms.api.collections.posts.find();
 *   },
 * });
 * ```
 */
export type BaseCMS = typeof baseInstance.$inferCms;
