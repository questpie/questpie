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

// @ts-expect-error every variant is required
matchDiscriminated(activity, { created: ({ at }) => at });

matchDiscriminated(activity, {
	created: ({ at }) => at,
	closed: ({ reason }) => reason,
	// @ts-expect-error extra branches are not accepted
	other: () => null,
});
