import {
	type DiscriminatedReference,
	type DiscriminatedValue,
	matchDiscriminated,
} from "./helpers";

declare const appointmentIdBrand: unique symbol;
type AppointmentId = string & { readonly [appointmentIdBrand]: true };
declare const barberIdBrand: unique symbol;
type BarberId = string & { readonly [barberIdBrand]: true };

type Subject = DiscriminatedReference<{
	appointment: AppointmentId;
	barber: BarberId;
}>;
declare let readonlySubject: Subject;
declare const replacementId: Subject["id"];
// @ts-expect-error discriminants are readonly
readonlySubject.kind = "appointment";
// @ts-expect-error reference IDs are readonly
readonlySubject.id = replacementId;

function render(subject: Subject) {
	return matchDiscriminated(subject, {
		appointment: ({ id }) => {
			const exact: AppointmentId = id;
			return { href: `/appointments/${exact}` } as const;
		},
		barber: ({ id }) => {
			const exact: BarberId = id;
			return `barber:${exact}`;
		},
	});
}

type Rendered = ReturnType<typeof render>;
const renderedUnion: string | Readonly<{ href: string }> =
	null as never as Rendered;
void renderedUnion;

type Activity = DiscriminatedValue<{
	created: { at: Date };
	closed: { reason: string };
}>;
declare const activity: Activity;

interface InterfaceVariants {
	readonly created: { readonly at: Date };
	readonly closed: { readonly reason: string };
}
const interfaceVariant: DiscriminatedValue<InterfaceVariants> = activity;
void interfaceVariant;

// @ts-expect-error every variant is required
matchDiscriminated(activity, { created: ({ at }) => at });

matchDiscriminated(activity, {
	created: ({ at }) => at,
	closed: ({ reason }) => reason,
	// @ts-expect-error extra branches are not accepted
	other: () => null,
});
