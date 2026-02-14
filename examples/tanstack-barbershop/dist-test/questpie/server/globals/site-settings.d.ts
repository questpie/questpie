export type NavItem = {
    label: string;
    href: string;
    isExternal?: boolean;
};
export type FooterLink = {
    label: string;
    href: string;
    isExternal?: boolean;
};
export type SocialLink = {
    platform: "instagram" | "facebook" | "twitter" | "tiktok" | "youtube";
    url: string;
};
export type BookingSettings = {
    minAdvanceHours: number;
    maxAdvanceDays: number;
    slotDurationMinutes: number;
    allowCancellation: boolean;
    cancellationDeadlineHours: number;
};
export declare const siteSettings: any;
