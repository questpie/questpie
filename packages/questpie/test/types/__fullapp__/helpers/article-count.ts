export function countArticles(
	collections: Questpie.ServiceCreateContext["collections"],
	title: string,
) {
	return collections.articles.count({ where: { title: { eq: title } } });
}
