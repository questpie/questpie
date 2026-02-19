/**
 * Booking Wizard Route
 *
 * A multi-step flow for scheduling an appointment.
 */

import {
	ArrowLeft,
	ArrowRight,
	Calendar as CalendarIcon,
	CheckCircle,
	Clock,
	User,
} from "@phosphor-icons/react";
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
			client.rpc.getAvailableTimeSlots({
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
					(slotsError as any)?.message || t("booking.error.loadSlotsDesc"),
			});
		}
	}, [isSlotsError, slotsError, t]);

	const bookingMutation = useMutation({
		mutationFn: (data: any) => client.rpc.createBooking(data),
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
			<div className="min-h-[80vh] flex items-center justify-center px-6">
				<div className="max-w-md w-full text-center space-y-8 animate-fade-in-up">
					<div className="flex justify-center">
						<div className="size-24 bg-highlight/10 rounded-full flex items-center justify-center">
							<CheckCircle weight="fill" className="size-16 text-highlight" />
						</div>
					</div>
					<div className="space-y-4">
						<h1 className="text-4xl font-bold tracking-tight">
							{t("booking.confirmed.title")}
						</h1>
						<p className="text-muted-foreground text-lg">
							{t("booking.confirmed.message")}{" "}
							<span className="font-bold text-foreground">
								{customerInfo.email}
							</span>
							.
						</p>
					</div>
					<div className="pt-8 space-y-4">
						<Link
							to="/"
							className="block w-full py-4 bg-foreground text-background font-bold uppercase tracking-widest hover:bg-highlight transition-all"
						>
							{t("booking.returnHome")}
						</Link>
						<p className="text-sm text-muted-foreground">
							{t("booking.needToChange")} +421 900 000 000
						</p>
					</div>
				</div>
			</div>
		);
	}

	return (
		<div className="py-20 px-6 bg-muted/30 min-h-screen">
			<div className="container max-w-4xl mx-auto">
				{/* Progress Header */}
				<div className="mb-12 flex justify-between items-center">
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
							className="gap-2 font-bold uppercase tracking-widest text-xs"
						>
							<ArrowLeft className="size-4" /> {t("booking.back")}
						</Button>
					)}
				</div>

				<div className="grid grid-cols-1 lg:grid-cols-12 gap-12">
					{/* Main Flow */}
					<div className="lg:col-span-8 space-y-8">
						{/* STEP 1: SERVICE */}
						{step === "service" && (
							<div className="space-y-6 animate-fade-in-up">
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
												"flex items-center justify-between p-6 bg-card border-2 text-left transition-all group",
												selectedService?.id === service.id
													? "border-highlight"
													: "border-transparent hover:border-highlight/30",
											)}
										>
											<div className="space-y-1">
												<p className="font-bold text-lg group-hover:text-highlight transition-colors">
													{service.name}
												</p>
												<p className="text-sm text-muted-foreground">
													{service.duration} min
												</p>
											</div>
											<p className="font-bold text-highlight">
												{formatPrice(service.price)}
											</p>
										</button>
									))}
								</div>
							</div>
						)}

						{/* STEP 2: BARBER */}
						{step === "barber" && (
							<div className="space-y-6 animate-fade-in-up">
								<h2 className="text-2xl font-bold">
									{t("booking.selectBarber")}
								</h2>
								<div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
									{barbers.map((barber) => (
										<button
											key={barber.id}
											onClick={() => {
												setSelectedBarber(barber);
												handleNext();
											}}
											className={cn(
												"p-6 bg-card border-2 text-center transition-all group",
												selectedBarber?.id === barber.id
													? "border-highlight"
													: "border-transparent hover:border-highlight/30",
											)}
										>
											<div className="size-20 bg-muted mx-auto mb-4 overflow-hidden rounded-full border border-border">
												{barber.avatar ? (
													<img
														src={barber.avatar}
														className="w-full h-full object-cover"
														alt=""
													/>
												) : (
													<div className="w-full h-full flex items-center justify-center">
														<User className="size-10 text-muted-foreground/30" />
													</div>
												)}
											</div>
											<p className="font-bold text-lg group-hover:text-highlight transition-colors">
												{barber.name}
											</p>
											<p className="text-sm text-muted-foreground line-clamp-1">
												{barber.specialties?.join(" · ")}
											</p>
										</button>
									))}
								</div>
							</div>
						)}

						{/* STEP 3: DATE & TIME */}
						{step === "datetime" && (
							<div className="space-y-8 animate-fade-in-up">
								<div className="grid grid-cols-1 md:grid-cols-2 gap-8">
									<div className="space-y-4">
										<h2 className="text-2xl font-bold">
											{t("booking.selectDate")}
										</h2>
										<div className="p-4 bg-card border border-border rounded-none">
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
														className="h-12 bg-muted animate-pulse"
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
																"py-3 px-4 border text-center font-bold text-sm transition-all",
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
											<div className="p-8 text-center bg-muted border border-dashed border-border text-muted-foreground italic">
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
										className="bg-highlight hover:bg-highlight/90 text-highlight-foreground font-bold uppercase tracking-widest h-14 px-12"
									>
										{t("booking.next")} <ArrowRight className="ml-2" />
									</Button>
								</div>
							</div>
						)}

						{/* STEP 4: INFO */}
						{step === "info" && (
							<form
								onSubmit={handleFinalSubmit}
								className="space-y-8 animate-fade-in-up"
							>
								<h2 className="text-2xl font-bold">
									{t("booking.yourDetails")}
								</h2>
								<div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
									<div className="space-y-2">
										<Label
											htmlFor="name"
											className="font-bold uppercase tracking-wider text-xs"
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
											className="bg-card h-12 rounded-none border-border"
											placeholder="John Doe"
										/>
									</div>
									<div className="space-y-2">
										<Label
											htmlFor="email"
											className="font-bold uppercase tracking-wider text-xs"
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
											className="bg-card h-12 rounded-none border-border"
											placeholder="john@example.com"
										/>
									</div>
									<div className="sm:col-span-2 space-y-2">
										<Label
											htmlFor="phone"
											className="font-bold uppercase tracking-wider text-xs"
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
											className="bg-card h-12 rounded-none border-border"
											placeholder="+421 ..."
										/>
									</div>
									<div className="sm:col-span-2 space-y-2">
										<Label
											htmlFor="notes"
											className="font-bold uppercase tracking-wider text-xs"
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
											className="bg-card h-12 rounded-none border-border"
											placeholder={t("booking.notesPlaceholder")}
										/>
									</div>
								</div>

								<div className="pt-8 border-t border-border">
									<Button
										type="submit"
										size="lg"
										disabled={bookingMutation.isPending}
										className="w-full bg-highlight hover:bg-highlight/90 text-highlight-foreground font-bold uppercase tracking-widest h-16 text-lg"
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
							<Card className="rounded-none border-border bg-card">
								<CardHeader>
									<CardTitle className="text-xl font-bold">
										Booking Summary
									</CardTitle>
								</CardHeader>
								<CardContent className="space-y-6">
									{selectedService && (
										<div className="flex gap-4">
											<div className="size-10 bg-muted flex items-center justify-center shrink-0">
												<Clock
													weight="bold"
													className="size-5 text-muted-foreground"
												/>
											</div>
											<div>
												<p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
													Service
												</p>
												<p className="font-bold">{selectedService.name}</p>
												<p className="text-sm text-highlight">
													{formatPrice(selectedService.price)}
												</p>
											</div>
										</div>
									)}

									{selectedBarber && (
										<div className="flex gap-4">
											<div className="size-10 bg-muted flex items-center justify-center shrink-0 overflow-hidden">
												{selectedBarber.avatar ? (
													<img
														src={selectedBarber.avatar}
														className="w-full h-full object-cover"
														alt=""
													/>
												) : (
													<User
														weight="bold"
														className="size-5 text-muted-foreground"
													/>
												)}
											</div>
											<div>
												<p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
													Barber
												</p>
												<p className="font-bold">{selectedBarber.name}</p>
											</div>
										</div>
									)}

									{selectedDate && selectedTime && (
										<div className="flex gap-4">
											<div className="size-10 bg-muted flex items-center justify-center shrink-0">
												<CalendarIcon
													weight="bold"
													className="size-5 text-muted-foreground"
												/>
											</div>
											<div>
												<p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
													Appointment
												</p>
												<p className="font-bold">
													{format(selectedDate, "PPP")}
												</p>
												<p className="text-sm font-bold text-highlight">
													{format(new Date(selectedTime), "HH:mm")}
												</p>
											</div>
										</div>
									)}

									{!selectedService && (
										<div className="py-12 text-center text-muted-foreground text-sm italic">
											Select a service to start
										</div>
									)}
								</CardContent>
								{selectedService && (
									<CardFooter className="flex justify-between items-center border-t pt-4">
										<span className="font-bold text-lg">
											{t("booking.total")}
										</span>
										<span className="font-bold text-2xl text-highlight">
											{formatPrice(selectedService.price)}
										</span>
									</CardFooter>
								)}
							</Card>

							<div className="p-6 bg-muted/50 border border-border space-y-4">
								<h3 className="font-bold text-sm uppercase tracking-widest">
									{t("booking.policy.title")}
								</h3>
								<ul className="text-xs text-muted-foreground space-y-2 leading-relaxed">
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
