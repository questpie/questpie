/**
 * Booking Wizard Route
 *
 * A multi-step flow for scheduling an appointment.
 */

import { Icon } from "@iconify/react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { format } from "date-fns";
import * as React from "react";
import { toast } from "sonner";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
	Card,
	CardContent,
	CardFooter,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { client } from "@/lib/client";
import { getAllBarbers } from "@/lib/getBarbers.function";
import { getAllServices } from "@/lib/getServices.function";
import { useTranslation } from "@/lib/providers/locale-provider";
import { cn } from "@/lib/utils";

// Search params schema
const bookingSearchSchema = z.object({
	service: z.string().optional(),
	barber: z.string().optional(),
});

export const Route = createFileRoute("/_app/booking")({
	validateSearch: (search) => bookingSearchSchema.parse(search),
	loader: async () => {
		const [services, barbers] = await Promise.all([
			getAllServices({ data: undefined }),
			getAllBarbers({ data: undefined }),
		]);

		return {
			services: services.services,
			barbers: barbers.barbers,
		};
	},
	component: BookingPage,
});

type Step = "service" | "barber" | "datetime" | "info" | "success";

function BookingPage() {
	const { t, locale } = useTranslation();
	const { services, barbers } = Route.useLoaderData();
	const search = Route.useSearch();

	// Wizard State
	const [step, setStep] = React.useState<Step>(
		search.service && search.barber
			? "datetime"
			: search.service
				? "barber"
				: "service",
	);

	const [selectedService, setSelectedService] = React.useState(
		services.find((s) => s.id === search.service) || null,
	);
	const [selectedBarber, setSelectedBarber] = React.useState(
		barbers.find((b) => b.id === search.barber) || null,
	);
	const [selectedDate, setSelectedDate] = React.useState<Date | undefined>(
		new Date(),
	);
	const [selectedTime, setSelectedTime] = React.useState<string | null>(null);

	const [customerInfo, setCustomerInfo] = React.useState({
		name: "",
		email: "",
		phone: "",
		notes: "",
	});

	// Queries & Mutations
	const {
		data: slotsData,
		isLoading: isLoadingSlots,
		isError: isSlotsError,
		error: slotsError,
	} = useQuery({
		queryKey: ["slots", selectedBarber?.id, selectedDate, selectedService?.id],
		queryFn: () =>
			client.routes.getAvailableTimeSlots({
				date: format(selectedDate!, "yyyy-MM-dd"),
				barberId: selectedBarber!.id,
				serviceId: selectedService!.id,
			}),
		enabled:
			!!selectedBarber &&
			!!selectedDate &&
			!!selectedService &&
			step === "datetime",
		retry: 2,
	});

	// Show error toast when slots fail to load
	React.useEffect(() => {
		if (isSlotsError) {
			toast.error(t("booking.error.loadSlots"), {
				description:
					(slotsError as Error | undefined)?.message ||
					t("booking.error.loadSlotsDesc"),
			});
		}
	}, [isSlotsError, slotsError, t]);

	const bookingMutation = useMutation({
		mutationFn: (data: any) => client.routes.createBooking(data),
		onSuccess: () => {
			toast.success(t("booking.error.success"), {
				description: t("booking.error.successDesc"),
			});
			setStep("success");
		},
		onError: (error: any) => {
			toast.error(t("booking.error.failed"), {
				description: error?.message || t("booking.error.failedDesc"),
			});
		},
	});

	// Helpers
	const formatPrice = (cents: number) => {
		return new Intl.NumberFormat(locale === "sk" ? "sk-SK" : "en-US", {
			style: "currency",
			currency: "EUR",
		}).format(cents / 100);
	};

	const handleNext = () => {
		if (step === "service") setStep("barber");
		else if (step === "barber") setStep("datetime");
		else if (step === "datetime") setStep("info");
		window.scrollTo(0, 0);
	};

	const handleBack = () => {
		if (step === "barber") setStep("service");
		else if (step === "datetime") setStep("barber");
		else if (step === "info") setStep("datetime");
		window.scrollTo(0, 0);
	};

	const handleFinalSubmit = (e: React.FormEvent) => {
		e.preventDefault();

		// Validation
		if (!selectedBarber || !selectedService || !selectedTime) {
			toast.error(t("booking.error.missing"), {
				description: t("booking.error.missingDesc"),
			});
			return;
		}

		if (!customerInfo.name || !customerInfo.email) {
			toast.error(t("booking.error.required"), {
				description: t("booking.error.requiredDesc"),
			});
			return;
		}

		bookingMutation.mutate({
			barberId: selectedBarber.id,
			serviceId: selectedService.id,
			scheduledAt: selectedTime,
			customerName: customerInfo.name,
			customerEmail: customerInfo.email,
			customerPhone: customerInfo.phone,
			notes: customerInfo.notes,
		});
	};

	// --- Render Steps ---

	if (step === "success") {
		return (
			<div className="flex min-h-[80vh] items-center justify-center px-6">
				<div className="animate-fade-in-up w-full max-w-md space-y-8 text-center">
					<div className="flex justify-center">
						<div className="bg-highlight/10 flex size-24 items-center justify-center rounded-full">
							<Icon
								icon="ph:check-circle-fill"
								className="text-highlight size-16"
							/>
						</div>
					</div>
					<div className="space-y-4">
						<h1 className="text-4xl font-bold tracking-tight">
							{t("booking.confirmed.title")}
						</h1>
						<p className="text-muted-foreground text-lg">
							{t("booking.confirmed.message")}{" "}
							<span className="text-foreground font-bold">
								{customerInfo.email}
							</span>
							.
						</p>
					</div>
					<div className="space-y-4 pt-8">
						<Link
							to="/"
							className="bg-foreground text-background hover:bg-highlight block w-full py-4 font-bold tracking-widest uppercase transition-all"
						>
							{t("booking.returnHome")}
						</Link>
						<p className="text-muted-foreground text-sm">
							{t("booking.needToChange")} +421 900 000 000
						</p>
					</div>
				</div>
			</div>
		);
	}

	return (
		<div className="bg-muted/30 min-h-screen px-6 py-20">
			<div className="container mx-auto max-w-4xl">
				{/* Progress Header */}
				<div className="mb-12 flex items-center justify-between">
					<div className="space-y-1">
						<h1 className="text-3xl font-bold tracking-tight">
							{t("booking.title")}
						</h1>
						<p className="text-muted-foreground">
							{t("booking.stepOf", {
								current:
									["service", "barber", "datetime", "info"].indexOf(step) + 1,
								total: 4,
							})}
						</p>
					</div>
					{step !== "service" && (
						<Button
							variant="ghost"
							onClick={handleBack}
							className="gap-2 text-xs font-bold tracking-widest uppercase"
						>
							<Icon icon="ph:arrow-left" className="size-4" />{" "}
							{t("booking.back")}
						</Button>
					)}
				</div>

				<div className="grid grid-cols-1 gap-12 lg:grid-cols-12">
					{/* Main Flow */}
					<div className="space-y-8 lg:col-span-8">
						{/* STEP 1: SERVICE */}
						{step === "service" && (
							<div className="animate-fade-in-up space-y-6">
								<h2 className="text-2xl font-bold">
									{t("booking.selectService")}
								</h2>
								<div className="grid grid-cols-1 gap-4">
									{services.map((service) => (
										<button
											key={service.id}
											onClick={() => {
												setSelectedService(service);
												handleNext();
											}}
											className={cn(
												"bg-card group flex items-center justify-between border-2 p-6 text-left transition-all",
												selectedService?.id === service.id
													? "border-highlight"
													: "hover:border-highlight/30 border-transparent",
											)}
										>
											<div className="space-y-1">
												<p className="group-hover:text-highlight text-lg font-bold transition-colors">
													{service.name}
												</p>
												<p className="text-muted-foreground text-sm">
													{service.duration} min
												</p>
											</div>
											<p className="text-highlight font-bold">
												{formatPrice(service.price)}
											</p>
										</button>
									))}
								</div>
							</div>
						)}

						{/* STEP 2: BARBER */}
						{step === "barber" && (
							<div className="animate-fade-in-up space-y-6">
								<h2 className="text-2xl font-bold">
									{t("booking.selectBarber")}
								</h2>
								<div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
									{barbers.map((barber) => (
										<button
											key={barber.id}
											onClick={() => {
												setSelectedBarber(barber);
												handleNext();
											}}
											className={cn(
												"bg-card group border-2 p-6 text-center transition-all",
												selectedBarber?.id === barber.id
													? "border-highlight"
													: "hover:border-highlight/30 border-transparent",
											)}
										>
											<div className="bg-muted border-border mx-auto mb-4 size-20 overflow-hidden rounded-full border">
												{barber.avatar ? (
													<img
														src={barber.avatar}
														className="h-full w-full object-cover"
														alt=""
													/>
												) : (
													<div className="flex h-full w-full items-center justify-center">
														<Icon
															icon="ph:user"
															className="text-muted-foreground/30 size-10"
														/>
													</div>
												)}
											</div>
											<p className="group-hover:text-highlight text-lg font-bold transition-colors">
												{barber.name}
											</p>
											<p className="text-muted-foreground line-clamp-1 text-sm">
												{barber.specialties?.join(" · ")}
											</p>
										</button>
									))}
								</div>
							</div>
						)}

						{/* STEP 3: DATE & TIME */}
						{step === "datetime" && (
							<div className="animate-fade-in-up space-y-8">
								<div className="grid grid-cols-1 gap-8 md:grid-cols-2">
									<div className="space-y-4">
										<h2 className="text-2xl font-bold">
											{t("booking.selectDate")}
										</h2>
										<div className="bg-card border-border rounded-none border p-4">
											<Calendar
												mode="single"
												selected={selectedDate}
												onSelect={setSelectedDate}
												disabled={(date) =>
													date < new Date(new Date().setHours(0, 0, 0, 0))
												}
												className="mx-auto"
											/>
										</div>
									</div>

									<div className="space-y-4">
										<h2 className="text-2xl font-bold">
											{t("booking.selectTime")}
										</h2>
										{isLoadingSlots ? (
											<div className="grid grid-cols-3 gap-2">
												{[...Array(9)].map((_, i) => (
													<div
														key={i}
														className="bg-muted h-12 animate-pulse"
													/>
												))}
											</div>
										) : slotsData?.slots?.length ? (
											<ScrollArea className="h-[340px] pr-4">
												<div className="grid grid-cols-2 gap-2">
													{slotsData.slots.map((slot: string) => (
														<button
															key={slot}
															onClick={() => setSelectedTime(slot)}
															className={cn(
																"border px-4 py-3 text-center text-sm font-bold transition-all",
																selectedTime === slot
																	? "bg-highlight border-highlight text-highlight-foreground"
																	: "bg-card border-border hover:border-highlight",
															)}
														>
															{format(new Date(slot), "HH:mm")}
														</button>
													))}
												</div>
											</ScrollArea>
										) : (
											<div className="bg-muted border-border text-muted-foreground border border-dashed p-8 text-center italic">
												{t("booking.noSlotsForDay")}
											</div>
										)}
									</div>
								</div>

								<div className="flex justify-end pt-4">
									<Button
										size="lg"
										disabled={!selectedTime}
										onClick={handleNext}
										className="bg-highlight hover:bg-highlight/90 text-highlight-foreground h-14 px-12 font-bold tracking-widest uppercase"
									>
										{t("booking.next")}{" "}
										<Icon icon="ph:arrow-right" className="ml-2" />
									</Button>
								</div>
							</div>
						)}

						{/* STEP 4: INFO */}
						{step === "info" && (
							<form
								onSubmit={handleFinalSubmit}
								className="animate-fade-in-up space-y-8"
							>
								<h2 className="text-2xl font-bold">
									{t("booking.yourDetails")}
								</h2>
								<div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
									<div className="space-y-2">
										<Label
											htmlFor="name"
											className="text-xs font-bold tracking-wider uppercase"
										>
											{t("booking.name")}
										</Label>
										<Input
											id="name"
											required
											value={customerInfo.name}
											onChange={(e) =>
												setCustomerInfo({
													...customerInfo,
													name: e.target.value,
												})
											}
											className="bg-card border-border h-12 rounded-none"
											placeholder="John Doe"
										/>
									</div>
									<div className="space-y-2">
										<Label
											htmlFor="email"
											className="text-xs font-bold tracking-wider uppercase"
										>
											{t("booking.email")}
										</Label>
										<Input
											id="email"
											type="email"
											required
											value={customerInfo.email}
											onChange={(e) =>
												setCustomerInfo({
													...customerInfo,
													email: e.target.value,
												})
											}
											className="bg-card border-border h-12 rounded-none"
											placeholder="john@example.com"
										/>
									</div>
									<div className="space-y-2 sm:col-span-2">
										<Label
											htmlFor="phone"
											className="text-xs font-bold tracking-wider uppercase"
										>
											{t("booking.phoneOptional")}
										</Label>
										<Input
											id="phone"
											value={customerInfo.phone}
											onChange={(e) =>
												setCustomerInfo({
													...customerInfo,
													phone: e.target.value,
												})
											}
											className="bg-card border-border h-12 rounded-none"
											placeholder="+421 ..."
										/>
									</div>
									<div className="space-y-2 sm:col-span-2">
										<Label
											htmlFor="notes"
											className="text-xs font-bold tracking-wider uppercase"
										>
											{t("booking.notesForBarber")}
										</Label>
										<Input
											id="notes"
											value={customerInfo.notes}
											onChange={(e) =>
												setCustomerInfo({
													...customerInfo,
													notes: e.target.value,
												})
											}
											className="bg-card border-border h-12 rounded-none"
											placeholder={t("booking.notesPlaceholder")}
										/>
									</div>
								</div>

								<div className="border-border border-t pt-8">
									<Button
										type="submit"
										size="lg"
										disabled={bookingMutation.isPending}
										className="bg-highlight hover:bg-highlight/90 text-highlight-foreground h-16 w-full text-lg font-bold tracking-widest uppercase"
									>
										{bookingMutation.isPending
											? t("booking.booking")
											: t("booking.confirmBooking")}
									</Button>
								</div>
							</form>
						)}
					</div>

					{/* Sidebar Summary */}
					<div className="lg:col-span-4">
						<div className="sticky top-24 space-y-6">
							<Card className="border-border bg-card rounded-none">
								<CardHeader>
									<CardTitle className="text-xl font-bold">
										Booking Summary
									</CardTitle>
								</CardHeader>
								<CardContent className="space-y-6">
									{selectedService && (
										<div className="flex gap-4">
											<div className="bg-muted flex size-10 shrink-0 items-center justify-center">
												<Icon
													icon="ph:clock-bold"
													className="text-muted-foreground size-5"
												/>
											</div>
											<div>
												<p className="text-muted-foreground text-xs font-bold tracking-widest uppercase">
													Service
												</p>
												<p className="font-bold">{selectedService.name}</p>
												<p className="text-highlight text-sm">
													{formatPrice(selectedService.price)}
												</p>
											</div>
										</div>
									)}

									{selectedBarber && (
										<div className="flex gap-4">
											<div className="bg-muted flex size-10 shrink-0 items-center justify-center overflow-hidden">
												{selectedBarber.avatar ? (
													<img
														src={selectedBarber.avatar}
														className="h-full w-full object-cover"
														alt=""
													/>
												) : (
													<Icon
														icon="ph:user-bold"
														className="text-muted-foreground size-5"
													/>
												)}
											</div>
											<div>
												<p className="text-muted-foreground text-xs font-bold tracking-widest uppercase">
													Barber
												</p>
												<p className="font-bold">{selectedBarber.name}</p>
											</div>
										</div>
									)}

									{selectedDate && selectedTime && (
										<div className="flex gap-4">
											<div className="bg-muted flex size-10 shrink-0 items-center justify-center">
												<Icon
													icon="ph:calendar-bold"
													className="text-muted-foreground size-5"
												/>
											</div>
											<div>
												<p className="text-muted-foreground text-xs font-bold tracking-widest uppercase">
													Appointment
												</p>
												<p className="font-bold">
													{format(selectedDate, "PPP")}
												</p>
												<p className="text-highlight text-sm font-bold">
													{format(new Date(selectedTime), "HH:mm")}
												</p>
											</div>
										</div>
									)}

									{!selectedService && (
										<div className="text-muted-foreground py-12 text-center text-sm italic">
											Select a service to start
										</div>
									)}
								</CardContent>
								{selectedService && (
									<CardFooter className="flex items-center justify-between border-t pt-4">
										<span className="text-lg font-bold">
											{t("booking.total")}
										</span>
										<span className="text-highlight text-2xl font-bold">
											{formatPrice(selectedService.price)}
										</span>
									</CardFooter>
								)}
							</Card>

							<div className="bg-muted/50 border-border space-y-4 border p-6">
								<h3 className="text-sm font-bold tracking-widest uppercase">
									{t("booking.policy.title")}
								</h3>
								<ul className="text-muted-foreground space-y-2 text-xs leading-relaxed">
									<li>• {t("booking.policy.arrive")}</li>
									<li>• {t("booking.policy.cancel")}</li>
									<li>• {t("booking.policy.payment")}</li>
								</ul>
							</div>
						</div>
					</div>
				</div>
			</div>
		</div>
	);
}
