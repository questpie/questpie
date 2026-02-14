export declare const getAvailableTimeSlots: import("questpie").JsonFunctionDefinition<{
    date: string;
    barberId: string;
    serviceId: string;
}, {
    slots: string[];
}, any>;
export declare const createBooking: import("questpie").JsonFunctionDefinition<{
    barberId: string;
    serviceId: string;
    scheduledAt: string;
    customerName: string;
    customerEmail: string;
    customerPhone?: string | undefined;
    notes?: string | undefined;
}, {
    success: boolean;
    appointmentId: any;
    message: string;
}, any>;
