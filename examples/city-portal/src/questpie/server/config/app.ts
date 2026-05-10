import { appConfig } from "questpie/app";
export default appConfig({
    locale: {
        locales: [{ code: "en", label: "English", fallback: true, flagCountryCode: "gb" }],
        defaultLocale: "en",
    },
    context: async ({ request }) => {
        const cityId = request.headers.get("x-selected-city");
        return { cityId: cityId || null };
    },
});
