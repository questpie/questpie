export declare const sendAppointmentConfirmation: import("questpie").JobDefinition<{
    appointmentId: string;
    customerId: string;
}, void, "send-appointment-confirmation", any>;
export declare const sendAppointmentCancellation: import("questpie").JobDefinition<{
    appointmentId: string;
    customerId: string;
}, void, "send-appointment-cancellation", any>;
export declare const sendAppointmentReminder: import("questpie").JobDefinition<{
    appointmentId: string;
}, void, "send-appointment-reminder", any>;
