/**
 * English translations for the barbershop frontend
 */
export const en = {
  // Navigation
  "nav.home": "Home",
  "nav.services": "Services",
  "nav.barbers": "Our Team",
  "nav.about": "About",
  "nav.contact": "Contact",
  "nav.booking": "Book Now",

  // Booking
  "booking.title": "Book Appointment",
  "booking.step.service": "Service",
  "booking.step.barber": "Barber",
  "booking.step.datetime": "Date & Time",
  "booking.step.details": "Your Details",
  "booking.step.confirm": "Confirm",
  "booking.selectService": "Select a Service",
  "booking.selectBarber": "Choose Your Barber",
  "booking.anyBarber": "Any Available Barber",
  "booking.selectDate": "Pick a Date",
  "booking.selectTime": "Available Times",
  "booking.noSlots": "No available times for this date",
  "booking.yourDetails": "Your Details",
  "booking.name": "Full Name",
  "booking.email": "Email",
  "booking.phone": "Phone",
  "booking.notes": "Notes (optional)",
  "booking.summary": "Booking Summary",
  "booking.confirm": "Confirm Booking",
  "booking.back": "Back",
  "booking.next": "Continue",
  "booking.success.title": "Booking Confirmed!",
  "booking.success.message": "We've sent a confirmation to your email.",
  "booking.success.details": "Booking Details",
  "booking.success.backHome": "Back to Home",
  "booking.error.slotTaken": "This time slot is no longer available",
  "booking.error.generic": "Something went wrong. Please try again.",

  // Services
  "services.title": "Our Services",
  "services.subtitle": "Quality grooming services tailored to your style",
  "services.duration": "{duration} min",
  "services.book": "Book This Service",
  "services.viewAll": "View All Services",

  // Barbers
  "barbers.title": "Our Team",
  "barbers.subtitle": "Skilled professionals dedicated to your look",
  "barbers.viewProfile": "View Profile",
  "barbers.bookWith": "Book with {name}",
  "barbers.available": "Available",
  "barbers.unavailable": "Unavailable",
  "barbers.specialties": "Specialties",
  "barbers.workingHours": "Working Hours",
  "barbers.about": "About",
  "barbers.services": "Services Offered",
  "barbers.reviews": "Reviews",

  // Reviews
  "reviews.title": "What Clients Say",
  "reviews.empty": "No reviews yet",

  // Contact
  "contact.title": "Contact Us",
  "contact.subtitle": "We'd love to hear from you",
  "contact.details": "Contact Details",
  "contact.address": "Our Location",
  "contact.phone": "Phone Number",
  "contact.email": "Email Address",
  "contact.hours": "Business Hours",
  "contact.closed": "Closed",
  "contact.getDirections": "Get Directions",
  "contact.mapPlaceholder": "Interactive Map Placeholder",
  "contact.holidayNote": "* Hours may vary on public holidays.",

  // Footer
  "footer.tagline": "Your Style, Our Passion",
  "footer.quickLinks": "Quick Links",
  "footer.hours": "Hours",
  "footer.followUs": "Follow Us",
  "footer.rights": "All rights reserved.",

  // Common
  "common.loading": "Loading...",
  "common.error": "Something went wrong",
  "common.retry": "Try again",
  "common.learnMore": "Learn More",
  "common.viewAll": "View All",
  "common.close": "Close",
  "common.open": "Open",
  "common.menu": "Menu",
  "common.price": "Price",

  // Theme
  "theme.light": "Light",
  "theme.dark": "Dark",
  "theme.system": "System",
  "theme.toggle": "Toggle theme",

  // Language
  "language.en": "English",
  "language.sk": "Slovenčina",
  "language.switch": "Switch language",

  // Mobile menu
  "mobile.theme": "Theme",
  "mobile.language": "Language",

  // Days (full)
  "day.monday": "Monday",
  "day.tuesday": "Tuesday",
  "day.wednesday": "Wednesday",
  "day.thursday": "Thursday",
  "day.friday": "Friday",
  "day.saturday": "Saturday",
  "day.sunday": "Sunday",

  // Days (short)
  "day.mon": "Mon",
  "day.tue": "Tue",
  "day.wed": "Wed",
  "day.thu": "Thu",
  "day.fri": "Fri",
  "day.sat": "Sat",
  "day.sun": "Sun",

  // CTA
  "cta.bookNow": "Book Now",
  "cta.getStarted": "Get Started",
  "cta.contactUs": "Contact Us",
  "cta.viewServices": "View Services",
  "cta.meetTeam": "Meet the Team",
} as const;

export type TranslationKey = keyof typeof en;
