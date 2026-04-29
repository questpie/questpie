"use client";

import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";
import { useMemo } from "react";

import { cn } from "../../lib/utils";
import { Label } from "./label";
import { Separator } from "./separator";

// ============================================================================
// Field ID Context — links labels, descriptions, and errors to inputs
// ============================================================================

interface FieldIdsContextValue {
	/** Stable base id for generating related ids */
	baseId: string;
	/** ID for the description element (aria-describedby target) */
	descriptionId: string;
	/** ID for the error element (aria-describedby target) */
	errorId: string;
	/** Whether the field currently has an error */
	hasError: boolean;
	/** Whether the field currently has a description */
	hasDescription: boolean;
	/** Set by FieldDescription when it mounts */
	setHasDescription: (v: boolean) => void;
	/** Set by FieldError when it mounts */
	setHasError: (v: boolean) => void;
}

const FieldIdsContext = React.createContext<FieldIdsContextValue | null>(null);

/**
 * Hook for input primitives to get `aria-describedby` linking.
 * Returns the composed aria-describedby string pointing to
 * description and/or error elements in the parent Field.
 */
export function useFieldIds() {
	return React.useContext(FieldIdsContext);
}

function FieldSet({ className, ...props }: React.ComponentProps<"fieldset">) {
	return (
		<fieldset
			data-slot="field-set"
			className={cn(
				"qa-field-set flex flex-col gap-4 has-[>[data-slot=checkbox-group]]:gap-3 has-[>[data-slot=radio-group]]:gap-3",
				className,
			)}
			{...props}
		/>
	);
}

function FieldLegend({
	className,
	variant = "legend",
	...props
}: React.ComponentProps<"legend"> & { variant?: "legend" | "label" }) {
	return (
		<legend
			data-slot="field-legend"
			data-variant={variant}
			className={cn(
				"mb-2 font-medium data-[variant=label]:text-xs/relaxed data-[variant=legend]:text-sm",
				className,
			)}
			{...props}
		/>
	);
}

function FieldGroup({ className, ...props }: React.ComponentProps<"div">) {
	return (
		<div
			data-slot="field-group"
			className={cn(
				"qa-field-group group/field-group @container/field-group flex w-full flex-col gap-4 data-[slot=checkbox-group]:gap-3 [&>[data-slot=field-group]]:gap-4",
				className,
			)}
			{...props}
		/>
	);
}

const fieldVariants = cva(
	"qa-field data-[invalid=true]:text-destructive group/field flex w-full gap-2",
	{
		variants: {
			orientation: {
				vertical: "flex-col [&>*]:w-full [&>.sr-only]:w-auto",
				horizontal:
					"flex-row items-center has-[>[data-slot=field-content]]:items-start [&>[data-slot=field-label]]:flex-auto has-[>[data-slot=field-content]]:[&>[role=checkbox],[role=radio]]:mt-px",
				responsive:
					"flex-col @md/field-group:flex-row @md/field-group:items-center @md/field-group:has-[>[data-slot=field-content]]:items-start [&>*]:w-full @md/field-group:[&>*]:w-auto [&>.sr-only]:w-auto @md/field-group:[&>[data-slot=field-label]]:flex-auto @md/field-group:has-[>[data-slot=field-content]]:[&>[role=checkbox],[role=radio]]:mt-px",
			},
		},
		defaultVariants: {
			orientation: "vertical",
		},
	},
);

function Field({
	className,
	orientation = "vertical",
	...props
}: React.ComponentProps<"div"> & VariantProps<typeof fieldVariants>) {
	const baseId = React.useId();
	const [hasDescription, setHasDescription] = React.useState(false);
	const [hasError, setHasError] = React.useState(false);

	const ids = useMemo(
		() => ({
			baseId,
			descriptionId: `${baseId}-desc`,
			errorId: `${baseId}-err`,
			hasDescription,
			hasError,
			setHasDescription,
			setHasError,
		}),
		[baseId, hasDescription, hasError],
	);

	return (
		<FieldIdsContext.Provider value={ids}>
			<div
				role="group"
				data-slot="field"
				data-orientation={orientation}
				className={cn(fieldVariants({ orientation }), className)}
				{...props}
			/>
		</FieldIdsContext.Provider>
	);
}

function FieldContent({ className, ...props }: React.ComponentProps<"div">) {
	return (
		<div
			data-slot="field-content"
			className={cn(
				"qa-field__content group/field-content flex flex-1 flex-col gap-0.5 leading-snug",
				className,
			)}
			{...props}
		/>
	);
}

function FieldLabel({
	className,
	...props
}: React.ComponentProps<typeof Label>) {
	return (
		<Label
			data-slot="field-label"
			className={cn(
				"qa-field__label has-data-checked:bg-accent has-data-checked:text-accent-foreground group/field-label peer/field-label flex w-fit gap-2 leading-snug group-data-[disabled=true]/field:opacity-50 has-[>[data-slot=field]]:border [&>*]:data-[slot=field]:p-2",
				"has-[>[data-slot=field]]:w-full has-[>[data-slot=field]]:flex-col",
				className,
			)}
			{...props}
		/>
	);
}

function FieldTitle({ className, ...props }: React.ComponentProps<"div">) {
	return (
		<div
			data-slot="field-label"
			className={cn(
				"qa-field__title font-chrome flex w-fit items-center gap-2 text-xs leading-snug font-medium group-data-[disabled=true]/field:opacity-50",
				className,
			)}
			{...props}
		/>
	);
}

function FieldDescription({ className, ...props }: React.ComponentProps<"p">) {
	const fieldIds = React.useContext(FieldIdsContext);

	React.useEffect(() => {
		fieldIds?.setHasDescription(true);
		return () => fieldIds?.setHasDescription(false);
	}, [fieldIds]);

	return (
		<p
			id={fieldIds?.descriptionId}
			data-slot="field-description"
			className={cn(
				"qa-field__description text-muted-foreground text-left text-xs/relaxed leading-normal font-normal group-has-[[data-orientation=horizontal]]/field:text-balance [[data-variant=legend]+&]:-mt-1.5",
				"last:mt-0 nth-last-2:-mt-1",
				"[&>a:hover]:text-foreground [&>a]:underline [&>a]:underline-offset-4",
				className,
			)}
			{...props}
		/>
	);
}

function FieldSeparator({
	children,
	className,
	...props
}: React.ComponentProps<"div"> & {
	children?: React.ReactNode;
}) {
	return (
		<div
			data-slot="field-separator"
			data-content={!!children}
			className={cn(
				"qa-field__separator relative -my-2 h-5 text-xs/relaxed group-data-[variant=outline]/field-group:-mb-2",
				className,
			)}
			{...props}
		>
			<Separator className="absolute inset-0 top-1/2" />
			{children && (
				<span
					className="text-muted-foreground bg-background relative mx-auto block w-fit px-2"
					data-slot="field-separator-content"
				>
					{children}
				</span>
			)}
		</div>
	);
}

function FieldError({
	className,
	children,
	errors,
	...props
}: React.ComponentProps<"div"> & {
	errors?: Array<{ message?: string } | undefined>;
}) {
	const fieldIds = React.useContext(FieldIdsContext);

	const content = useMemo(() => {
		if (children) {
			return children;
		}

		if (!errors?.length) {
			return null;
		}

		const uniqueErrors = [
			...new Map(errors.map((error) => [error?.message, error])).values(),
		];

		if (uniqueErrors?.length == 1) {
			return uniqueErrors[0]?.message;
		}

		return (
			<ul className="ml-4 flex list-disc flex-col gap-1">
				{uniqueErrors.map(
					(error) =>
						error?.message && <li key={error.message}>{error.message}</li>,
				)}
			</ul>
		);
	}, [children, errors]);

	React.useEffect(() => {
		fieldIds?.setHasError(!!content);
		return () => fieldIds?.setHasError(false);
	}, [fieldIds, content]);

	if (!content) {
		return null;
	}

	return (
		<div
			id={fieldIds?.errorId}
			role="alert"
			data-slot="field-error"
			className={cn(
				"qa-field__error text-destructive text-xs/relaxed font-normal",
				className,
			)}
			{...props}
		>
			{content}
		</div>
	);
}

export {
	Field,
	FieldLabel,
	FieldDescription,
	FieldError,
	FieldGroup,
	FieldContent,
};
