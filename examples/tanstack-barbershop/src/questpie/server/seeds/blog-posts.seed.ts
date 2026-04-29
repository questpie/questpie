import { seed } from "questpie";

import { richText, richTextFormatted, uploadAllImages } from "./_helpers.js";

export default seed({
	id: "blogPosts",
	description: "Demo blog posts (EN + SK)",
	category: "dev",
	dependsOn: ["demoData"],
	async run({ collections, createContext, log }) {
		const ctxEn = await createContext({
			accessMode: "system",
			locale: "en",
		});
		const ctxSk = await createContext({
			accessMode: "system",
			locale: "sk",
		});

		// Idempotency check
		const existing = await collections.blog_posts.find(
			{ where: { slug: { eq: "ultimate-guide-to-fades" } }, limit: 1 },
			ctxEn,
		);
		if (existing.totalDocs > 0) {
			log("Blog posts already exist, skipping");
			return;
		}

		// Upload blog images
		log("Uploading blog images...");
		const img = await uploadAllImages(collections, ctxEn, log);

		// ================================================================
		// Blog Post 1: Ultimate Guide to Fades
		// ================================================================
		log("Creating blog post: Ultimate Guide to Fades...");
		const post1 = await collections.blog_posts.create(
			{
				title: "The Ultimate Guide to Fade Haircuts",
				slug: "ultimate-guide-to-fades",
				excerpt:
					"Everything you need to know about fade haircuts — from low fades to skin fades, and how to choose the right one for your face shape.",
				content: richTextFormatted([
					[
						{
							text: "Fade haircuts have become the most popular style in modern barbering.",
							bold: true,
						},
						{
							text: " Whether you're going for a subtle low fade or a dramatic skin fade, understanding the options helps you communicate exactly what you want to your barber.",
						},
					],
					"A fade is a gradual transition from short to long hair. The key difference between fade types is where the transition starts and how dramatic it is.",
					[
						{ text: "Low Fade", bold: true },
						{
							text: " — starts just above the ears. It's the most conservative and versatile option, working well with both casual and professional settings.",
						},
					],
					[
						{ text: "Mid Fade", bold: true },
						{
							text: " — begins at the temple area. This is the most common choice and offers a balanced, clean look.",
						},
					],
					[
						{ text: "High Fade", bold: true },
						{
							text: " — starts near the top of the head. It's bold and works great with longer styles on top.",
						},
					],
					[
						{ text: "Skin Fade", bold: true },
						{
							text: " — goes all the way down to the skin. The most dramatic option, requiring more frequent maintenance.",
						},
					],
					"When choosing your fade, consider your face shape, hair type, and lifestyle. A good barber will always help you find the right balance.",
					"At Sharp Cuts, we specialize in precision fades. Book a consultation and let's find your perfect look.",
				]),
				readingTime: 4,
				status: "published",
				publishedAt: new Date("2026-02-15T10:00:00Z"),
				coverImage: img.blogFade,
				tags: "haircuts, fades, style guide",
			},
			ctxEn,
		);

		// SK translation
		await collections.blog_posts.updateById(
			{
				id: post1.id,
				data: {
					title: "Kompletný sprievodca fade strihmi",
					excerpt:
						"Všetko, čo potrebujete vedieť o fade strihoch — od low fade po skin fade a ako si vybrať ten správny pre váš tvar tváre.",
					content: richTextFormatted([
						[
							{
								text: "Fade strihy sa stali najobľúbenejším štýlom v modernom barberstve.",
								bold: true,
							},
							{
								text: " Či už idete po jemný low fade alebo dramatický skin fade, pochopenie možností vám pomôže presne povedať barberovi, čo chcete.",
							},
						],
						"Fade je postupný prechod z krátkych na dlhšie vlasy. Kľúčový rozdiel medzi typmi fade je to, kde prechod začína a aký je dramatický.",
						[
							{ text: "Low Fade", bold: true },
							{
								text: " — začína tesne nad ušami. Je to najkonzervatívnejšia a najuniverzálnejšia voľba.",
							},
						],
						[
							{ text: "Mid Fade", bold: true },
							{
								text: " — začína v oblasti spánkov. Najčastejšia voľba s vyváženým, čistým vzhľadom.",
							},
						],
						[
							{ text: "High Fade", bold: true },
							{
								text: " — začína blízko vrchu hlavy. Odvážna voľba, ktorá skvele funguje s dlhšími štýlmi navrchu.",
							},
						],
						[
							{ text: "Skin Fade", bold: true },
							{
								text: " — ide až na kožu. Najdramatickejšia voľba vyžadujúca častejšiu údržbu.",
							},
						],
						"Pri výbere fade-u zvážte tvar tváre, typ vlasov a životný štýl. Dobrý barber vám vždy pomôže nájsť správnu rovnováhu.",
						"V Sharp Cuts sa špecializujeme na precízne fade strihy. Rezervujte si konzultáciu a nájdime váš dokonalý look.",
					]),
					tags: "strihy, fade, sprievodca štýlom",
				},
			},
			ctxSk,
		);

		// ================================================================
		// Blog Post 2: Beard Grooming
		// ================================================================
		log("Creating blog post: Beard Grooming 101...");
		const post2 = await collections.blog_posts.create(
			{
				title: "Beard Grooming 101: Tips from Our Barbers",
				slug: "beard-grooming-101",
				excerpt:
					"Our master barbers share their top tips for maintaining a healthy, well-groomed beard at home between visits.",
				content: richTextFormatted([
					[
						{
							text: "A great beard doesn't happen by accident.",
							bold: true,
						},
						{
							text: " It takes consistent care, the right products, and a bit of know-how. Here are our barbers' top tips for keeping your beard looking sharp between visits.",
						},
					],
					[
						{ text: "1. Wash it properly.", bold: true },
						{
							text: " Use a dedicated beard wash, not regular shampoo. Regular shampoo strips natural oils and leaves your beard dry and brittle.",
						},
					],
					[
						{ text: "2. Oil daily.", bold: true },
						{
							text: " Beard oil keeps your facial hair soft and moisturizes the skin underneath. Apply a few drops after showering while your beard is still slightly damp.",
						},
					],
					[
						{ text: "3. Brush and comb.", bold: true },
						{
							text: " A boar bristle brush distributes oils evenly and trains your beard to grow in the direction you want. Comb through after applying oil.",
						},
					],
					[
						{ text: "4. Trim regularly.", bold: true },
						{
							text: " Even if you're growing it out, regular trims keep split ends at bay and maintain a clean shape.",
						},
					],
					[
						{ text: "5. Know your neckline.", bold: true },
						{
							text: " The neckline makes or breaks a beard. A good rule: place two fingers above your Adam's apple — that's where your neckline should be.",
						},
					],
					"For professional beard shaping and grooming, visit us at Sharp Cuts. Our barbers will help you achieve the beard you've always wanted.",
				]),
				readingTime: 3,
				status: "published",
				publishedAt: new Date("2026-02-22T10:00:00Z"),
				coverImage: img.blogBeard,
				tags: "beard, grooming, tips",
			},
			ctxEn,
		);

		// SK translation
		await collections.blog_posts.updateById(
			{
				id: post2.id,
				data: {
					title: "Starostlivosť o bradu 101: Tipy od našich barberov",
					excerpt:
						"Naši majstri barberi zdieľajú svoje top tipy na udržiavanie zdravej, upravenej brady doma medzi návštevami.",
					content: richTextFormatted([
						[
							{
								text: "Skvelá brada sa neudeje náhodou.",
								bold: true,
							},
							{
								text: " Vyžaduje si konzistentnú starostlivosť, správne produkty a trochu know-how. Tu sú top tipy našich barberov.",
							},
						],
						[
							{ text: "1. Správne umývanie.", bold: true },
							{
								text: " Používajte špeciálny šampón na bradu, nie bežný šampón na vlasy. Ten zbavuje bradu prirodzených olejov.",
							},
						],
						[
							{ text: "2. Denné olejovanie.", bold: true },
							{
								text: " Olej na bradu udržiava vlasy mäkké a hydratuje pokožku pod nimi. Naneste pár kvapiek po sprchovaní.",
							},
						],
						[
							{ text: "3. Kefovanie a česanie.", bold: true },
							{
								text: " Kefa z diviačích štetín rovnomerne rozotrie oleje a naučí bradu rásť požadovaným smerom.",
							},
						],
						[
							{ text: "4. Pravidelné zastrihovanie.", bold: true },
							{
								text: " Aj keď bradu púšťate, pravidelné zastrihovanie udržuje tvar a zabraňuje rozštiepeným končekom.",
							},
						],
						[
							{ text: "5. Poznajte svoj neckline.", bold: true },
							{
								text: " Neckline robí alebo kazí bradu. Dobré pravidlo: položte dva prsty nad ohryzok — tam by mal byť váš neckline.",
							},
						],
						"Pre profesionálne tvarovanie brady nás navštívte v Sharp Cuts. Naši barberi vám pomôžu dosiahnuť bradu, o ktorej ste vždy snívali.",
					]),
					tags: "brada, starostlivosť, tipy",
				},
			},
			ctxSk,
		);

		// ================================================================
		// Blog Post 3: Grooming Trends 2026
		// ================================================================
		log("Creating blog post: Grooming Trends 2026...");
		const post3 = await collections.blog_posts.create(
			{
				title: "Top 5 Men's Grooming Trends for 2026",
				slug: "grooming-trends-2026",
				excerpt:
					"From textured crops to wellness-focused grooming, here are the top trends our barbers are seeing this year.",
				content: richTextFormatted([
					[
						{
							text: "The grooming landscape is evolving fast.",
							bold: true,
						},
						{
							text: " Here are the five biggest trends we're seeing at Sharp Cuts in 2026.",
						},
					],
					[
						{ text: "1. Textured Crops", bold: true },
						{
							text: " — the textured crop is taking over. It's low-maintenance, works with most face shapes, and looks effortlessly cool. Think messy fringe with a clean fade on the sides.",
						},
					],
					[
						{ text: "2. Scalp Care", bold: true },
						{
							text: " — men are finally paying attention to scalp health. Scalp treatments, exfoliation, and proper moisturizing are becoming standard parts of the grooming routine.",
						},
					],
					[
						{ text: "3. Natural Styling Products", bold: true },
						{
							text: " — heavy gels are out, matte clays and sea salt sprays are in. The trend is toward natural-looking hold with texture.",
						},
					],
					[
						{ text: "4. The Modern Mullet", bold: true },
						{
							text: " — love it or hate it, the mullet is back — but refined. Short on top, textured in the back, with a fade on the sides.",
						},
					],
					[
						{ text: "5. Wellness Grooming", bold: true },
						{
							text: " — grooming is becoming self-care. More clients are booking relaxation services alongside haircuts: hot towel treatments, scalp massages, and aromatherapy.",
						},
					],
					"Stay ahead of the trends — book your next appointment at Sharp Cuts and let our barbers help you find a style that works for your lifestyle.",
				]),
				readingTime: 3,
				status: "published",
				publishedAt: new Date("2026-03-01T10:00:00Z"),
				coverImage: img.blogGrooming,
				tags: "trends, grooming, 2026",
			},
			ctxEn,
		);

		// SK translation
		await collections.blog_posts.updateById(
			{
				id: post3.id,
				data: {
					title: "Top 5 trendov v mužskej starostlivosti pre rok 2026",
					excerpt:
						"Od textúrovaných cropov po wellness grooming — tu sú najväčšie trendy, ktoré naši barberi vidia tento rok.",
					content: richTextFormatted([
						[
							{
								text: "Svet mužskej starostlivosti sa rýchlo vyvíja.",
								bold: true,
							},
							{
								text: " Tu je päť najväčších trendov, ktoré vidíme v Sharp Cuts v roku 2026.",
							},
						],
						[
							{ text: "1. Textúrované Cropy", bold: true },
							{
								text: " — textúrovaný crop preberá vládu. Je nenáročný na údržbu, funguje s väčšinou tvarov tváre a vyzerá nedbanlivo cool.",
							},
						],
						[
							{ text: "2. Starostlivosť o pokožku hlavy", bold: true },
							{
								text: " — muži konečne venujú pozornosť zdraviu pokožky hlavy. Ošetrenia, exfoliácia a správna hydratácia sa stávajú štandardom.",
							},
						],
						[
							{ text: "3. Prírodné stylingové produkty", bold: true },
							{
								text: " — ťažké gély sú out, matné hliny a soľné spreje sú in. Trend smeruje k prirodzene vyzerajúcemu držaniu s textúrou.",
							},
						],
						[
							{ text: "4. Moderný Mullet", bold: true },
							{
								text: " — milujte ho alebo nenáviďte, mullet je späť — ale rafinovaný. Krátky navrchu, textúrovaný vzadu, s fade po stranách.",
							},
						],
						[
							{ text: "5. Wellness Grooming", bold: true },
							{
								text: " — starostlivosť sa stáva sebaláskou. Viac klientov si rezervuje relaxačné služby popri strihoch: horúce uteráky, masáže hlavy, aromaterapia.",
							},
						],
						"Buďte o krok vpred — rezervujte si ďalší termín v Sharp Cuts a nechajte našich barberov nájsť štýl, ktorý vám sedí.",
					]),
					tags: "trendy, starostlivosť, 2026",
				},
			},
			ctxSk,
		);

		log(`Created 3 blog posts with EN + SK translations`);
	},
});
