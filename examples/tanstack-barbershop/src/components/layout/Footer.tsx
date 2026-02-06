/**
 * Footer Component
 *
 * Displays:
 * - Shop name and tagline (from CMS)
 * - Footer links (from CMS, localized)
 * - Business hours (from CMS)
 * - Contact info (from CMS)
 * - Social links (from CMS)
 * - Copyright
 */

import {
  EnvelopeSimple,
  FacebookLogo,
  InstagramLogo,
  MapPin,
  Phone,
  Scissors,
  TiktokLogo,
  TwitterLogo,
  YoutubeLogo,
} from "@phosphor-icons/react";
import { useTranslation } from "@/lib/providers/locale-provider";

// Types matching site-settings global
export type SocialPlatform =
  | "instagram"
  | "facebook"
  | "twitter"
  | "tiktok"
  | "youtube";

export interface SocialLink {
  platform: SocialPlatform;
  url: string;
}

export interface FooterLink {
  label: string;
  href: string;
  isExternal?: boolean;
}

export interface BusinessHours {
  monday: { isOpen: boolean; start: string; end: string };
  tuesday: { isOpen: boolean; start: string; end: string };
  wednesday: { isOpen: boolean; start: string; end: string };
  thursday: { isOpen: boolean; start: string; end: string };
  friday: { isOpen: boolean; start: string; end: string };
  saturday: { isOpen: boolean; start: string; end: string };
  sunday: { isOpen: boolean; start: string; end: string };
}

export interface FooterProps {
  shopName?: string;
  tagline?: string;
  footerLinks?: FooterLink[];
  socialLinks?: SocialLink[];
  businessHours?: BusinessHours;
  contactEmail?: string;
  contactPhone?: string;
  address?: string;
  city?: string;
  zipCode?: string;
  country?: string;
  copyrightText?: string;
}

const socialIcons: Record<SocialPlatform, typeof InstagramLogo> = {
  instagram: InstagramLogo,
  facebook: FacebookLogo,
  twitter: TwitterLogo,
  tiktok: TiktokLogo,
  youtube: YoutubeLogo,
};

export function Footer({
  shopName = "Sharp Cuts",
  tagline,
  footerLinks = [],
  socialLinks = [],
  businessHours,
  contactEmail,
  contactPhone,
  address,
  city,
  zipCode,
  country,
  copyrightText,
}: FooterProps) {
  const { t } = useTranslation();
  const currentYear = new Date().getFullYear();

  const fullAddress = [address, city, zipCode, country]
    .filter(Boolean)
    .join(", ");

  const dayKeys = [
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday",
    "sunday",
  ] as const;

  return (
    <footer className="bg-muted/50 border-t border-border">
      <div className="container py-12 md:py-16">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8 lg:gap-12">
          {/* Brand */}
          <div className="space-y-4">
            <div className="flex items-center gap-2 font-bold text-xl">
              <Scissors className="size-6" weight="bold" />
              <span>{shopName}</span>
            </div>
            {tagline && (
              <p className="text-muted-foreground text-sm">{tagline}</p>
            )}
            {/* Social Links */}
            {socialLinks.length > 0 && (
              <div className="flex items-center gap-3 pt-2">
                {socialLinks.map((social) => {
                  const Icon = socialIcons[social.platform];
                  return (
                    <a
                      key={social.platform}
                      href={social.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-muted-foreground hover:text-foreground transition-colors"
                      aria-label={social.platform}
                    >
                      <Icon className="size-5" />
                    </a>
                  );
                })}
              </div>
            )}
          </div>

          {/* Quick Links */}
          {footerLinks.length > 0 && (
            <div className="space-y-4">
              <h3 className="font-semibold text-sm uppercase tracking-wider">
                {t("footer.quickLinks")}
              </h3>
              <nav className="flex flex-col gap-2">
                {footerLinks.map((link) => (
                  <a
                    key={link.href}
                    href={link.href}
                    className="text-muted-foreground hover:text-foreground transition-colors text-sm"
                    {...(link.isExternal && {
                      target: "_blank",
                      rel: "noopener noreferrer",
                    })}
                  >
                    {link.label}
                  </a>
                ))}
              </nav>
            </div>
          )}

          {/* Business Hours */}
          {businessHours && (
            <div className="space-y-4">
              <h3 className="font-semibold text-sm uppercase tracking-wider">
                {t("footer.hours")}
              </h3>
              <div className="space-y-1 text-sm">
                {dayKeys.map((day) => {
                  const hours = businessHours[day];
                  return (
                    <div
                      key={day}
                      className="flex justify-between gap-4 text-muted-foreground"
                    >
                      <span>{t(`day.${day}` as any)}</span>
                      <span>
                        {hours?.isOpen
                          ? `${hours.start} - ${hours.end}`
                          : t("contact.closed")}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Contact Info */}
          <div className="space-y-4">
            <h3 className="font-semibold text-sm uppercase tracking-wider">
              {t("contact.title")}
            </h3>
            <div className="space-y-3 text-sm">
              {fullAddress && (
                <div className="flex items-start gap-3 text-muted-foreground">
                  <MapPin className="size-4 mt-0.5 shrink-0" />
                  <span>{fullAddress}</span>
                </div>
              )}
              {contactPhone && (
                <a
                  href={`tel:${contactPhone.replace(/\s/g, "")}`}
                  className="flex items-center gap-3 text-muted-foreground hover:text-foreground transition-colors"
                >
                  <Phone className="size-4 shrink-0" />
                  <span>{contactPhone}</span>
                </a>
              )}
              {contactEmail && (
                <a
                  href={`mailto:${contactEmail}`}
                  className="flex items-center gap-3 text-muted-foreground hover:text-foreground transition-colors"
                >
                  <EnvelopeSimple className="size-4 shrink-0" />
                  <span>{contactEmail}</span>
                </a>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Copyright */}
      <div className="border-t border-border">
        <div className="container py-4">
          <p className="text-center text-xs text-muted-foreground">
            &copy; {currentYear}{" "}
            {copyrightText || `${shopName}. ${t("footer.rights")}`}
          </p>
        </div>
      </div>
    </footer>
  );
}
