export * from "./booking";
export declare const getActiveBarbers: import("questpie").JsonFunctionDefinition<Record<string, never>, any, any>;
export declare const getRevenueStats: import("questpie").JsonFunctionDefinition<{
    startDate: string;
    endDate: string;
    completedOnly: boolean;
}, {
    totalRevenue: number;
    appointmentCount: number;
    avgRevenue: number;
}, any>;
