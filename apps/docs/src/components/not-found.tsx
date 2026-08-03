import { ErrorPage } from "@/components/error-page";

export function NotFound() {
	return (
		<ErrorPage status="404" title="Nothing at this address.">
			<p>
				Check the spelling. Every documentation page that has moved still
				redirects, so an old link should have carried you through.
			</p>
		</ErrorPage>
	);
}
