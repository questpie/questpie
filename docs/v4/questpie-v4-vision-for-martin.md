# QUESTPIE v4: produktova vizia pre Martina

> ADR-0026 nahrádza samostatný Workflow koncept: checkpointy, timery a signály
> patria Jobu. `defineWorkflow` ani druhý workflow runtime nie sú produkt.

Datum: 10. august 2026

Stav: navrh produktu pred implementaciou

## Jedna veta

QUESTPIE v4 je otvoreny, self-hostable a PostgreSQL-native application compiler
a runtime pre TypeScript aplikacie, ktore potrebuju silne transakcie, presne
typy, realtime vysledky, durable pracu a citatelnu prevadzku.

Nie je to dalsi CMS. Nie je to tenka CRUD vrstva nad databazou. Nie je to sada
adapterov pre kazdy webovy framework. Je to aplikacny runtime, na ktorom ludia
stavaju backend.

## Executive summary

QUESTPIE v3 nam dokazal, ze vieme postavit hodnotne spravanie: transakcne CRUD,
policy, outbox, realtime recovery, generovane klienty, queue a workflows. Zaroven
nam ukazal hranice povodnej architektury. Runtime Module merge skryval skutocny
tvar aplikacie. Rovnake nazvy medzi modulmi kolidovali nejasne. Definicia User sa
rozsirovala cez merge a expand mechanizmy, ktore clovek ani AI nevideli bez
citania cudzieho zdroja. Drizzle typy tiekli cez verejne API. Admin rozsiroval
backend cez privatny system. Adaptery a baliky zvacsovali maticu spravania.

Nemame externych v3 userov. To je dolezity fakt. Nemusime chranit zlu
architekturu pod zamienkou kompatibility. V3 preto pouzijeme ako kniznicu
spravania, testov, failure modes a performance limitov. Nebudeme ho pouzivat ako
zdrojovu architekturu v4.

V4 meni produktovu hranicu. QUESTPIE bude vlastnit semantiku aplikacie od
TypeScript definicii po PostgreSQL, runtime a klienta. Staticky compiler zostavi
jeden deterministicky Manifest. Ten urci identity, ownership, policy, databazovy
plan, operacie, durable dispatch, realtime zavislosti a klientsky kontrakt.
Runtime uz nebude menit tvar aplikacie cez plugin merge.

PostgreSQL nie je vymenitelny detail. Je sucast produktu. V4.0 nebude slubovat
databazovu neutralitu. Tato volba znizuje pocet abstrakcii a dovoluje nam
garantovat transakcie, constraints, change capture, durable koordinaciu a
recovery. Supabase, Neon alebo iny kompatibilny provider moze hostovat databazu.
Data ostavaju normalne PostgreSQL data.

Studio nahradi povodny CMS Admin. Studio nebude nastroj na stavbu custom
operator aplikacii. Bude to operational surface pre Manifest, migracie, drift,
policy rozhodnutia, transakcie, dispatch, queue, jobs, workflows, realtime,
logy, traces a audit. Custom back office zostane normalna userland aplikacia.

Biznis nebude stat na predaji kopirovatelnych feature modulov alebo barbershop
template. Open-source Runtime vytvori adopciu a doveru. Neskorsi managed control
plane moze predavat semantic deploys, migration gates, backup a recovery,
observability, team controls, compliance a podporu. Obsah a vzdelavanie budu
distribucia: ukazu ludom, ako stavat transakcne, realtime a durable systemy.

Najprv dokazeme jeden Barbershop tracer. Az potom rozsirme produkt.

## Co sme sa naucili vo v3

### Co zachovame ako spravanie

- Jedna Mutation vlastni databazovu transakciu.
- Durable dispatch sa zapise atomicky s business zmenou.
- Policy a tenancy platia pri citani aj zapise.
- Realtime vidi iba committed stav.
- Recovery pokracuje po pade procesu.
- Klient ma konkretne typy aplikacie.
- Migracie su reviewovatelna historia.
- Queue a workflow maju idempotency, leases, retries a inspectable historiu.

### Co zahodime ako architekturu

- Runtime Module merge a last-wins spravanie.
- Skryte expand a merge definicie.
- Ambient TypeScript registry augmentation.
- Verejne Drizzle generics a ORM typy.
- Rekurzivne builder typy celej aplikacie.
- Host adapter matrix pre Hono, Elysia, Next a dalsie frameworky.
- CMS Admin builder a jeho privatny extension system.
- Package-per-capability organizaciu ako ciel samu o sebe.
- Feature kits ako primarny produkt a biznis.

### Preco je rewrite racionalny

Nemame externych userov ani compatibility debt. Mame vsak velke mnozstvo
technickych dokazov. To je idealna situacia pre deletion-driven rewrite.

Riziko nie je migracia userov. Riziko je dalsi rok architektonickeho ucenia bez
jedneho ostreho dokazu. Preto neimplementujeme cely katalog funkcii. Najprv
postavime tracer, ktory moze navrh vyvratit.

## Produktova hranica v4

### QUESTPIE vlastni

- staticku kompoziciu aplikacie;
- Resource Identity, Owner, Origin a autorizovanu Augmentation;
- PostgreSQL schema plan, migracie, fingerprint a drift;
- Collections, Fields, Relations, Constraints a Policy;
- Query, Mutation, Action a Route;
- transaction scope a Transactional Dispatch;
- Change Ledger a Live Query recomputation;
- generovany App Contract a frontend-neutral client;
- jobs, queues a neskor workflows na jednom durable spine;
- Execution Envelope pre logy, traces, audit, CLI, Studio a Cloud;
- startup, shutdown, workers, realtime sessions a health.

### QUESTPIE nevlastni

- frontend framework;
- custom operator UI;
- credential provider ako povinnu sucast core;
- vseobecny SQL editor;
- lubovolny webovy lifecycle;
- univerzalny database adapter interface;
- magicke runtime plugin merging.

Runtime ma jeden nizkourovnovy Fetch boundary. Ten sluzi na testy, specialne
embedding scenare a postupnu adopciu. QUESTPIE nebude udrziavat rovnocenny
adapter pre kazdy host framework.

## Staticky compiler a jednotne primitiva

Kazdy aplikacny resource ma stabilnu identitu. Presny owner ho vytvori. Kazdy
vstup ma zaznamenany origin. Ina cast aplikacie ho moze zmenit iba cez explicitne
povolenu Augmentation. Rovnake meno uz nie je otazka poradia importov. Compiler
bud pozna legalnu kompoziciu, alebo skonci s presnou chybou.

Rovnaky mechanizmus plati pre first-party framework kod, externy package a
userland aplikaciu. Framework nema tajnu cestu na pridanie Collections, Fields,
Policy alebo operacii. Toto pravidlo nie je ideologia. Je to disciplina, ktora
zabrani druhemu privatnemu frameworku v core.

Pravidlo mozeme porusit iba v nizkourovnovom bootstrape, ked verejne primitivum
este nemoze existovat. Takato vynimka musi byt mala, zdokumentovana a nesmie
vytvorit iny aplikacny model.

Compiler vytvori:

1. Compiled Manifest pre runtime a tooling.
2. Origin Map pre ownership, diagnostics a Studio.
3. Migration Plan pre PostgreSQL.
4. Concrete App Contract pre TypeScript.
5. Frontend-neutral client contract.

Runtime nacita hotovy vysledok. Nespusta strukturalne pluginy a nevyhodnocuje
poradie merge.

## TypeScript a AI developer experience

V3 sa snazil inferovat aplikaciu cez velky retazec builder generics. TypeScript
musel opakovane skladat celu aplikaciu. Verejne typy casto obsahovali Drizzle.
Rozdielna verzia alebo duplicitna dependencia mohla sposobit hlboke chyby alebo
`any` escape.

V4 presunie drahu pracu na compiler boundary. Compiler vygeneruje konkretne
typy pre jednu aplikaciu. Handler dostane presny context. Klient vidi iba
operacie a resources, ktore existuju. Absencia produktu je absencia property,
nie optional union na kazdom calle.

Normalny `.d.ts` nebude obsahovat Drizzle ani Kysely symboly. Raw PostgreSQL
escape hatch bude explicitny a uzsi. Pouzivatel nebude rucne enumerovat
`ctx.services.payments` v kazdej funkcii. Compiler pozna concrete service graph
a vytvori context pre danu aplikaciu a scope.

AI ziska rovnake vyhody ako clovek:

- jeden citatelny Manifest namiesto skryteho merge;
- stabilne identity a source locations;
- presne diagnostics s navrhom opravy;
- deterministic codegen;
- explicitny Migration Plan;
- klientsky kontrakt bez citania internals;
- jednotne primitiva v core aj userlande.

## Reviewovatelny schema lifecycle

V4 rozlisuje tri fakty:

- Compiled Manifest je pozadovany stav.
- Committed Migrations su reviewovana historia.
- Schema Fingerprint je skutocny stav PostgreSQL.

Standardny tok je:

1. Compile.
2. Plan.
3. Review.
4. Commit.
5. Apply.
6. Verify drift.

Nebude existovat nezdokumentovany `db push`, ktory zmeni databazu bez historie.
Rychly local mode moze spojit plan a apply, ale musi ukazat a zachovat ten isty
Migration Plan.

Kazda migracia ma stabilnu identitu a checksum. Destructive change je viditelny
pred apply. Kazdy Seed ma identitu, zavislosti, idempotency kontrakt a run
history. Agent tak vie, co chce zdroj, co sa reviewovalo a co je realne v DB.

## Transakcie, realtime a durable praca

Mutation je centralny zapisovy boundary. V jednej PostgreSQL transakcii zmeni
business data a zapise durable intent. Po commite worker spracuje intent aspon
raz. Idempotency kluc a execution history umoznia bezpecny retry.

Change Ledger zachyti relevantne committed zmeny. Wake mechanizmus moze byt
lossy, pretoze Ledger je durable source pre recovery. Runtime nestrati zmenu iba
preto, ze proces alebo WebSocket spojenie spadlo.

Live Query nesleduje iba tabulku. Runtime zaznamena podporovane reads, ktore
handler realne vykona: Policy, Tenant, relations, filters, ordering a pagination.
Po kazdom prepocitani dependency set nahradi. Raw SQL potrebuje explicitny
dependency token, inak Query nie je reactive. Po relevantnom commite runtime
znovu vypocita autorizovany vysledok jednej Query, nie iba surovy row event.

Atomicky prechod medzi viacerymi nezavislymi Live Queries este nie je slub. Musi
ho definovat samostatny checkpoint contract a executable proof.

Queue, Jobs a Workflows nie su nahodny zoznam integracii. Pouzivaju rovnaky
transaction, dispatch, lease, retry, idempotency, recovery a observability
spine. Plny workflow engine pride az po dokaze tohto zakladu.

## Studio

Studio je okno do semantiky aplikacie. Nezobrazuje iba tabulky.

Studio postupne ukaze:

- Manifest, identity, owners, origins a augmentations;
- Migration Plans, checksums, apply historiu a drift;
- Seeds a ich idempotency;
- Query, Mutation, Action a Route executions;
- Principal, Tenant, Authority a Policy rozhodnutia;
- transaction, dispatch a causal link medzi nimi;
- queue depth, job attempts, leases, retries a dead letters;
- workflow timeline, signals, waits a compensation;
- Change Ledger cursor, realtime lag a recomputation;
- logs, traces, metrics a audit history.

Runtime emituje append-only event family. Kazda udalost nesie rovnaky verzovany
Execution Envelope correlation format. Studio, CLI, OpenTelemetry, testy a
neskorsi Cloud citaju ten isty kontrakt. Observability tak nie je dodatocna
integracia. Je sucast runtime semantiky.

## Porovnanie s Convexom

Convex uz velmi dobre vlastni loop Query, Mutation, optimistic concurrency,
dependency tracking, WebSocket a konzistentny klient. Nazvy tychto funkcii nie
su moat.

QUESTPIE sa odlisi tam, kde potrebuje integrovat zdielane domeny na normalnom
PostgreSQL:

- data ostavaju viditelne a prenositelne PostgreSQL data;
- Policy je sucast compiled execution plan;
- resources maju explicitny owner, origin a legalnu augmentation;
- compiler vytvori concrete App Contract;
- Migration Plan a drift su first-class;
- SQL escape hatch a data exit ostavaju realne.

Convex je benchmark pre produktovu jednoduchost a realtime loop. QUESTPIE
nesmie expose-nut interny Contribution IR ako bezny userland koncept. Ak bude
bezny API posobit ako compiler framework, prehrali sme KISS audit.

## Porovnanie so Supabase

Supabase uz vlastni siroky pitch PostgreSQL, generated CRUD API a types, RLS,
Auth, Storage, row events, Queues, Cron, Studio a Cloud. QUESTPIE nema vyhrat
kopirovanim tohto zoznamu.

Supabase odraza existujucu databazu do API a klientskych typov. QUESTPIE
kompiluje aplikacnu semantiku zo zdrojov do Manifestu, runtime a klienta.

Najostrejsie rozdiely su:

- semantic Operations namiesto iba reflected CRUD;
- Mutation-owned atomic dispatch;
- observed-read Live Query recomputation namiesto raw row-change feedu;
- explicitny ownership a augmentation pre zdielane domeny;
- Origin Map, Policy diagnostics a Execution Envelope;
- reviewovatelny schema lifecycle z jedneho aplikacneho modelu.

Supabase moze hostovat PostgreSQL pre QUESTPIE, ak prejde QUESTPIE provider
profile. Produkty tak mozu byt komplementarne.
QUESTPIE Studio nema klonovat Supabase Studio. Ma vysvetlit aplikacnu semantiku,
ktoru vseobecny DB dashboard nepozna.

## Preco je to silnejsie ako predaj modulov

Feature template alebo booking module sa lahko skopiruje. Kazda aplikacia ho
rychlo upravi. Potom vznika fork, support matrix a malo opakovatelneho revenue.
AI este viac znizuje cenu generickeho feature kodu. Predaj barbershopov,
e-shopov alebo CMS blokov preto nie je dobry primarny moat.

QUESTPIE Runtime je hlbsia vrstva. Ked aplikacia pouziva jeho transakcie,
migracie, policy, realtime, durable pracu, klienta a observability, QUESTPIE
riesi opakovany prevadzkovy problem. Hodnota rastie s kvalitou a doverou, nie s
poctom template.

Ekosystem packages mozu stale existovat. Budu distribuovat normalne Definitions
a integracie. Nebudu magicky aktivovat skryte resources. Nie su hlavny biznis.

## Mozny biznis model

### 1. Open data plane

Compiler, Runtime, PostgreSQL schema, client a zakladne Studio ostanu open source
a self-hostable. Pouzivatel ma data exit a moze prevadzkovat system sam.

### 2. Managed control plane

Po dokaze standalone hodnoty moze QUESTPIE Cloud predavat:

- semantic deploy z Compiled Manifestu;
- migration review, gates, apply a rollback workflow;
- managed Runtime, workers a realtime sessions;
- backups, restore a disaster recovery;
- observability, history, alerts a SLO;
- team roles, approvals, environments a audit;
- security, compliance a enterprise support.

Control plane nemusi vlastnit databazovy protokol ani uzamknut data. Moze
prevadzkovat QUESTPIE nad vlastnym alebo zakaznikovym PostgreSQL.

### 3. Obsah a vzdelavanie

Content nie je vedlajsi marketing. Je distribucny kanal a dokaz kvality.

Budeme ucit:

- ako navrhnut transaction boundary;
- ako urobit durable side effect;
- ako funguje idempotency a recovery;
- ako funguje live query a authorization;
- ako agent bezpecne meni schemu;
- ako citat Manifest, traces a migration plan.

Barbershop a dalsie domeny budu executable lessons a conformance proofs, nie
produkty na predaj.

### 4. AI-native vyhoda

Framework, ktory ma deterministic Manifest, presne diagnostics, concrete types
a jednu cestu pre migracie, je prirodzene vhodny pre coding agents. Ak AI vie
bezpecne pochopit a menit aplikaciu, znizuje to cenu adopcie a zvysuje hodnotu
managed operations.

## Roadmap cez dokaz, nie cez baliky

### Faza 0: hotova specifikacia

Dokoncit exact API a failure semantics pre schema, migrations, seeds, drift a
idempotency. Nasledne uzamknut compiler input, operations a realtime contracts.

### Faza 1: Barbershop tracer

Tracer musi dokazat:

- dve Definitions so stabilnou identitou;
- jedneho ownera a jednu legalnu augmentation;
- collision failure s presnym originom;
- PostgreSQL migration plan, apply a drift;
- Policy-protected Query;
- transactional Mutation a durable dispatch;
- Change Ledger a Live Query recomputation;
- exact generated client;
- forced crash a recovery;
- external PostgreSQL write, cascade a raw SQL capture;
- duplicate Mutation delivery a strateny response po commite;
- zakaz unsafe external Service v retryable transakcii;
- execution, dependency, subscription a fanout limity;
- minimal Studio execution view;
- local PostgreSQL a jeden managed PostgreSQL.

### Faza 2: durable runtime

Rozsirit jobs, queues, leases, retries, dead letters a scheduling na dokazanom
spine. Az potom dokoncit workflow semantics.

### Faza 3: produktove integracie

Postupne riesit Auth, files, search, KV, OpenAPI a MCP. Kazdy slice musi pouzit
rovnake identity, transaction, policy, types a observability. Docasne
connected-client eventy si aplikacia sklada priamo s providerom; nie su dalsi
QUESTPIE Resource.

### Faza 4: Cloud experiment

Overit semantic deploy, managed migration a operational Studio s realnymi
aplikaciami. Neinvestovat do velkeho control plane pred dokazom dopytu.

## Hlavne rizika

- Live Query dependency precision moze byt prilis draha alebo nepredvidatelna.
- PostgreSQL change capture a recovery mozu vyzadovat vacsi operational budget.
- Compiler moze presunut zlozitost namiesto jej odstranenia.
- Concrete codegen moze byt pomaly alebo produkovat prilis velke typy.
- Studio a workflow breadth mozu znova rozostrit prvy produkt.
- Supabase a Convex maju zrelejsi produkt, Cloud a distribuciu.
- Nemame externych userov, preto je nasa produktova teza stale neoverena.

Mitigacia je jedna: kazdu abstrakciu musi dokazat tracer, meranie alebo realna
aplikacia. Ak ju nepotrebujeme na garanciu, odstranime ju.

## Co potrebujeme rozhodnut teraz

1. Potvrdit standalone PostgreSQL-native hranicu.
2. Potvrdit, ze v4 nie je kompatibilny internal rewrite v3.
3. Potvrdit Studio ako operational surface, nie CMS Admin.
4. Potvrdit open Runtime a neskorsi managed control plane ako biznis smer.
5. Dokoncit schema lifecycle grilling pred prvym runtime kodom.
6. Dat Barbershop traceru pravo vymazat navrhnute abstrakcie.

## Zaver

QUESTPIE v4 dava zmysel, ak bude mensi v pocte konceptov a silnejsi v
garanciach. Jeho hodnota nebude v tom, ze ma najviac capabilities. Bude v tom,
ze jedna aplikacna definicia vedie k presnym typom, reviewovatelnej databaze,
transakcnemu runtime, konzistentnemu realtime, durable praci a citatelnej
prevadzke.

To je produkt, na ktorom ludia mozu stavat. A to je zaklad, na ktorom moze
neskor vzniknut doveryhodny managed biznis.

## Zdroje a evidencia

- QUESTPIE v4 `SPEC.md`, `CONTEXT.md` a aktualne ADR.
- QUESTPIE v3 repository audity a behavior tests.
- Convex documentation: functions, transactions, realtime, components, schema
  and generated clients.
- Supabase documentation: architecture, generated APIs and types, Realtime,
  Queues, Cron and self-hosting.
- Interny research:
  `docs/v4/research/convex-comparison.md`.
- Interny research:
  `docs/v4/research/supabase-v3-v4-comparison.md`.
- Interny research:
  `docs/v4/research/data-engine-and-framework-boundary.md`.
