export type DaySchedule = {
    isOpen: boolean;
    start: string;
    end: string;
};
export type WorkingHours = {
    monday: DaySchedule;
    tuesday: DaySchedule;
    wednesday: DaySchedule;
    thursday: DaySchedule;
    friday: DaySchedule;
    saturday?: DaySchedule | null;
    sunday?: DaySchedule | null;
};
export type SocialLink = {
    platform: "instagram" | "facebook" | "twitter" | "linkedin" | "tiktok";
    url: string;
};
export declare const barbers: any;
