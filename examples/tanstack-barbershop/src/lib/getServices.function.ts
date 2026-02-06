import { createServerFn } from "@tanstack/react-start";
import { getRequestHeaders } from "@tanstack/react-start/server";
import { client } from "@/lib/cms-client";

function getLocaleFromCookie(cookieHeader?: string): "en" | "sk" {
  if (!cookieHeader) return "en";
  const match = cookieHeader.match(/barbershop-locale=([^;]+)/);
  return match?.[1] === "sk" ? "sk" : "en";
}

export const getAllServices = createServerFn({ method: "GET" })
  .inputValidator((data: { locale?: string } | undefined) => data)
  .handler(async ({ data }) => {
    const headers = getRequestHeaders();
    const cookie = headers.get("cookie");
    const locale = data?.locale || getLocaleFromCookie(cookie || undefined);

    const result = await client.collections.services.find({
      where: { isActive: true },
      orderBy: { price: "asc" },
      with: { image: true },
      locale,
    } satisfies Parameters<typeof client.collections.services.find>[0]);

    return {
      services: result.docs.map((s) => ({
        id: s.id,
        name: s.name,
        description: s.description,
        price: s.price,
        duration: s.duration,
        image: s.image,
      })),
    };
  });
