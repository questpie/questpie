import { qb } from "@/questpie/server/builder";

// Type helper for reactive context
type Data = Record<string, unknown>;
type Prev = { data: Data };

export const reviews = qb
	.collection("reviews")
	.fields((f) => ({
		// Customer relation - when set, use customer's name and email
		customer: f.relation({ to: "user" }),
		customerName: f.text({
			required: true,
			maxLength: 255,
			meta: {
				admin: {
					// Read-only when customer relation is set (use customer's name)
					readOnly: ({ data }: { data: Data }) => !!data.customer,
				},
			},
		}),
		customerEmail: f.email({
			maxLength: 255,
			meta: {
				admin: {
					// Only show when no customer relation (manual entry)
					hidden: ({ data }: { data: Data }) => !!data.customer,
				},
			},
		}),
		barber: f.relation({ to: "barbers", required: true }),
		appointment: f.relation({ to: "appointments" }),
		rating: f.select({
			required: true,
			options: [
				{ value: "1", label: "1 Star" },
				{ value: "2", label: "2 Stars" },
				{ value: "3", label: "3 Stars" },
				{ value: "4", label: "4 Stars" },
				{ value: "5", label: "5 Stars" },
			],
		}),
		comment: f.textarea({ localized: true }),
		isApproved: f.boolean({ default: false, required: true }),
		// Featured option only available for approved reviews
		isFeatured: f.boolean({
			default: false,
			required: true,
			meta: {
				admin: {
					// Only show featured option when review is approved
					hidden: ({ data }: { data: Data }) => !data.isApproved,
					// Reset featured when unapproved
					compute: ({ data, prev }: { data: Data; prev: Prev }) => {
						if (!data.isApproved && prev.data.isApproved) {
							return false; // Reset to false when unapproved
						}
						return undefined; // No change
					},
				},
			},
		}),
	}))
	.title(({ f }) => f.customerName);
