/**
 * Czech Admin UI Messages
 */
export default {
	// Common
	"common.save": "Uložit",
	"common.cancel": "Zrušit",
	"common.delete": "Smazat",
	"common.edit": "Upravit",
	"common.create": "Vytvořit",
	"common.add": "Přidat",
	"common.remove": "Odstranit",
	"common.close": "Zavřít",
	"common.form": "Formulář",
	"common.search": "Vyhledat",
	"common.filter": "Filtr",
	"common.refresh": "Obnovit",
	"common.loading": "Načítání...",
	"common.confirm": "Potvrdit",
	"common.back": "Zpět",
	"common.next": "Další",
	"common.previous": "Předchozí",
	"common.actions": "Akce",
	"common.more": "Více",
	"common.yes": "Ano",
	"common.no": "Ne",
	"common.ok": "OK",
	"common.apply": "Použít",
	"common.reset": "Resetovat",
	"common.clear": "Vymazat",
	"common.selectAll": "Vybrat vše",
	"common.deselectAll": "Zrušit výběr",
	"common.duplicate": "Duplikovat",
	"common.copy": "Kopírovat",
	"common.paste": "Vložit",
	"common.upload": "Nahrát",
	"common.download": "Stáhnout",
	"common.preview": "Náhled",
	"common.view": "Zobrazit",
	"common.open": "Otevřít",
	"common.retry": "Opakovat",
	"common.submit": "Odeslat",

	// Navigation
	"nav.dashboard": "Dashboard",
	"nav.collections": "Kolekce",
	"nav.globals": "Globály",
	"nav.media": "Média",
	"nav.settings": "Nastavení",
	"nav.logout": "Odhlásit se",
	"nav.home": "Domů",
	"nav.back": "Zpět",

	// Dashboard
	"dashboard.title": "Dashboard",
	"dashboard.welcome": "Vítejte zpět",
	"dashboard.recentActivity": "Nedávná aktivita",
	"dashboard.quickActions": "Rychlé akce",

	// Collections
	"collection.create": "Vytvořit {{name}}",
	"collection.edit": "Upravit {{name}}",
	"collection.delete": "Smazat {{name}}",
	"collection.deleteConfirm": "Opravdu chcete smazat {{name}}?",
	"collection.noItems": "Nenalezeny žádné {{name}}",
	"collection.createFirst": "Vytvořte svůj první {{name}}",
	"collection.itemCount": {
		one: "{{count}} položka",
		other: "{{count}} položek",
	},
	"collection.bulkDelete": "Smazat vybrané",
	"collection.bulkDeleteConfirm": "Opravdu chcete smazat {{count}} položek?",
	"collection.bulkDeleteSuccess": {
		one: "Úspěšně smazána {{count}} položka",
		other: "Úspěšně smazáno {{count}} položek",
	},
	"collection.bulkDeleteError": "Nepodařilo se smazat položky",
	"collection.bulkDeletePartial": {
		one: "Smazána {{success}} položka, {{failed}} selhalo",
		other: "Smazáno {{success}} položek, {{failed}} selhalo",
	},
	"collection.bulkActionFailed": "Hromadná akce selhala",
	"collection.selected": "Vybráno {{count}}",
	"collection.selectOnPage": "Vše na této stránce",
	"collection.selectAllMatching": "Vše vyhovující filtru ({{count}})",
	"collection.clearSelection": "Zrušit výběr",
	"collection.list": "Seznam {{name}}",
	"collection.new": "Nový {{name}}",
	"collection.duplicateSuccess": "{{name}} úspěšně duplikován",
	"collection.duplicateError": "Nepodařilo se duplikovat {{name}}",
	// Actions
	"action.collectionNotFound": 'Kolekce "{{collection}}" nebyla nalezena',
	"action.notFound":
		'Akce "{{action}}" nebyla nalezena v kolekci "{{collection}}"',
	"action.executionFailed": "Provedení akce selhalo",
	"action.itemCreated": "Položka byla úspěšně vytvořena",
	"action.itemIdRequired.save": "Pro akci uložení je vyžadováno ID položky",
	"action.itemSaved": "Položka byla úspěšně uložena",
	"action.itemIdRequired.delete": "Pro akci smazání je vyžadováno ID položky",
	"action.itemDeleted": "Položka byla úspěšně smazána",
	"action.itemIdsRequired.bulkDelete":
		"Pro hromadné mazání jsou vyžadována ID položek",
	"action.itemsDeleted": {
		one: "{{count}} položka byla úspěšně smazána",
		few: "{{count}} položky byly úspěšně smazány",
		other: "{{count}} položek bylo úspěšně smazáno",
	},
	"action.itemIdRequired.restore": "Pro akci obnovení je vyžadováno ID položky",
	"action.restoreUnsupported": "Obnovení není pro tuto kolekci podporováno",
	"action.itemRestored": "Položka byla úspěšně obnovena",
	"action.itemIdsRequired.bulkRestore":
		"Pro hromadné obnovení jsou vyžadována ID položek",
	"action.itemsRestored": {
		one: "{{count}} položka byla úspěšně obnovena",
		few: "{{count}} položky byly úspěšně obnoveny",
		other: "{{count}} položek bylo úspěšně obnoveno",
	},
	"action.itemIdRequired.duplicate":
		"Pro akci duplikace je vyžadováno ID položky",
	"action.itemNotFound": "Položka nebyla nalezena",
	"action.itemDuplicated": "Položka byla úspěšně duplikována",
	"action.itemIdRequired.transition":
		"Pro akci přechodu je vyžadováno ID položky",
	"action.targetStageRequired": "Pro akci přechodu je vyžadována cílová fáze",
	"action.workflowUnsupported":
		"Workflow přechody nejsou pro tuto kolekci podporovány",
	"action.unknownBuiltin": "Neznámá vestavěná akce: {{action}}",
	"action.fieldRequired": 'Pole "{{field}}" je povinné',

	// Relations
	"relation.select": "Vybrat {{name}}",
	"relation.clear": "Vymazat výběr",
	"relation.search": "Hledat {{name}}...",
	"relation.noResults": "Nenalezeny žádné {{name}}",
	"relation.loading": "Načítání...",
	"relation.createNew": "Vytvořit nový {{name}}",
	"relation.selected": "Vybráno {{count}}",
	"relation.removeItem": "Odstranit {{name}}",
	"relation.addItem": "Přidat {{name}}",
	"relation.noneSelected": "Není vybrán žádný {{name}}",
	"relation.noRelated": "Nenalezeny žádné související položky",
	"relation.saveFirst":
		"Nejprve uložte tuto položku pro zobrazení souvisejících položek.",

	// Arrays
	"array.empty": "Zatím nejsou přidány žádné {{name}}",
	"array.addItem": "Přidat {{name}}",

	// Blocks
	"blocks.addAbove": "Přidat nad",
	"blocks.addBelow": "Přidat pod",
	"blocks.addChild": "Přidat podřízený blok",

	// Forms
	"form.id": "ID",
	"form.created": "Vytvořeno",
	"form.updated": "Aktualizováno",
	"form.required": "Toto pole je povinné",
	"form.invalid": "Neplatná hodnota",
	"form.saveChanges": "Uložit změny",
	"form.unsavedChanges": "Máte neuložené změny",
	"form.discardChanges": "Zahodit změny",
	"form.discardConfirm":
		"Opravdu chcete zahodit změny? Tuto akci nelze vrátit zpět.",
	"form.fieldRequired": "{{field}} je povinné",
	"form.fieldInvalid": "{{field}} je neplatné",
	"form.maxLength": "Maximálně {{max}} znaků",
	"form.minLength": "Minimálně {{min}} znaků",
	"form.maxValue": "Maximálně {{max}}",
	"form.minValue": "Minimálně {{min}}",
	"form.pattern": "Neplatný formát",
	"form.email": "Neplatná e-mailová adresa",
	"form.url": "Neplatná URL",
	"form.createSuccess": "{{name}} úspěšně vytvořen",
	"form.createError": "Nepodařilo se vytvořit {{name}}",
	"form.updateSuccess": "{{name}} úspěšně aktualizován",
	"form.updateError": "Nepodařilo se aktualizovat {{name}}",
	"form.deleteSuccess": "{{name}} úspěšně smazán",
	"form.deleteError": "Nepodařilo se smazat {{name}}",

	// Auth
	"auth.login": "Přihlásit se",
	"auth.logout": "Odhlásit se",
	"auth.email": "E-mail",
	"auth.password": "Heslo",
	"auth.forgotPassword": "Zapomenuté heslo?",
	"auth.resetPassword": "Resetovat heslo",
	"auth.signIn": "Přihlásit se",
	"auth.signOut": "Odhlásit se",
	"auth.signUp": "Registrovat se",
	"auth.rememberMe": "Zapamatovat si mě",
	"auth.invalidCredentials": "Neplatný e-mail nebo heslo",
	"auth.sessionExpired": "Vaše relace vypršela. Prosím přihlaste se znovu.",
	"auth.emailPlaceholder": "vy@priklad.cz",
	"auth.passwordPlaceholder": "Zadejte heslo",
	"auth.signingIn": "Přihlašování...",
	"auth.creatingAdmin": "Vytváření administrátora...",
	"auth.name": "Jméno",
	"auth.namePlaceholder": "Vaše jméno",
	"auth.confirmPassword": "Potvrdit heslo",
	"auth.confirmPasswordPlaceholder": "Potvrďte heslo",
	"auth.acceptInvite": "Přijmout pozvánku",
	"auth.acceptingInvite": "Přijímání pozvánky...",
	"auth.dontHaveAccount": "Nemáte účet?",
	"auth.alreadyHaveAccount": "Máte již účet?",
	"auth.emailRequired": "E-mail je povinný",
	"auth.passwordRequired": "Heslo je povinné",
	"auth.passwordMinLength": "Heslo musí mít alespoň {{min}} znaků",
	"auth.nameRequired": "Jméno je povinné",
	"auth.nameMinLength": "Jméno musí mít alespoň {{min}} znaků",
	"auth.invalidEmail": "Neplatná e-mailová adresa",
	"auth.passwordMismatch": "Hesla se neshodují",
	"auth.newPassword": "Nové heslo",
	"auth.newPasswordPlaceholder": "Zadejte nové heslo",
	"auth.sendResetLink": "Odeslat odkaz pro reset",
	"auth.sendingResetLink": "Odesílání...",
	"auth.resetLinkSent": "Odkaz pro reset hesla byl odeslán na váš e-mail",
	"auth.resettingPassword": "Resetování hesla...",
	"auth.createFirstAdmin": "Vytvořit prvního administrátora",
	"auth.setupTitle": "Nastavení",
	"auth.setupDescription": "Vytvořte svůj první administrátorský účet.",
	"auth.profile": "Profil",
	"auth.myAccount": "Můj účet",
	"auth.logoutFailed": "Odhlášení se nezdařilo. Zkuste to prosím znovu.",
	"auth.setupAlreadyCompleted":
		"Nastavení již bylo dokončeno - v systému existují admin uživatelé",
	"auth.failedToCreateUserAccount": "Nepodařilo se vytvořit uživatelský účet",

	// Errors
	"error.notFound": "Nenalezeno",
	"error.serverError": "Chyba serveru",
	"error.networkError": "Chyba sítě. Zkontrolujte připojení.",
	"error.unauthorized": "Nemáte oprávnění k této akci",
	"error.forbidden": "Přístup zamítnut",
	"error.validation": "Validace selhala",
	"error.unknown": "Došlo k neznámé chybě",
	"error.timeout": "Vypršel čas požadavku. Zkuste to znovu.",
	"error.conflict": "Nastala kolize. Obnovte stránku a zkuste to znovu.",

	// Table
	"table.rowsPerPage": "Řádků na stránku",
	"table.of": "z",
	"table.noResults": "Žádné výsledky",
	"table.selectAll": "Vybrat vše",
	"table.selectRow": "Vybrat řádek",
	"table.showing": "Zobrazeno {{from}} až {{to}} z {{total}}",
	"table.page": "Strana {{page}}",
	"table.firstPage": "První strana",
	"table.lastPage": "Poslední strana",
	"table.nextPage": "Další strana",
	"table.previousPage": "Předchozí strana",
	"table.sortAsc": "Seřadit vzestupně",
	"table.sortDesc": "Seřadit sestupně",
	"table.columns": "Sloupce",
	"table.hideColumn": "Skrýt sloupec",
	"table.showColumn": "Zobrazit sloupec",

	// Upload
	"upload.dropzone": "Přetáhněte soubory sem nebo klikněte pro nahrání",
	"upload.browse": "Procházet soubory",
	"upload.uploading": "Nahrávání...",
	"upload.complete": "Nahrání dokončeno",
	"upload.error": "Nahrání selhalo",
	"upload.maxSize": "Soubor musí být menší než {{size}}",
	"upload.invalidType": "Neplatný typ souboru. Povoleno: {{types}}",
	"upload.remove": "Odstranit soubor",
	"upload.replace": "Nahradit soubor",
	"upload.preview": "Náhled",
	"upload.noFile": "Není vybrán žádný soubor",
	"upload.dragDrop": "Přetáhněte soubory sem",

	// Editor
	"editor.bold": "Tučné",
	"editor.italic": "Kurzíva",
	"editor.underline": "Podtržení",
	"editor.strikethrough": "Přeškrtnutí",
	"editor.heading": "Nadpis {{level}}",
	"editor.richTextToolbar": "Panel bohatého textu",
	"editor.blockType": "Typ bloku",
	"editor.selectionBlockType": "Typ vybraného bloku",
	"editor.paragraph": "Odstavec",
	"editor.textBlocks": "Textové bloky",
	"editor.headings": "Nadpisy",
	"editor.blocks": "Bloky",
	"editor.formatting": "Formátování",
	"editor.moreFormatting": "Další formátování",
	"editor.alignment": "Zarovnání",
	"editor.insert": "Vložit",
	"editor.link": "Vložit odkaz",
	"editor.image": "Vložit obrázek",
	"editor.list": "Seznam",
	"editor.orderedList": "Číslovaný seznam",
	"editor.unorderedList": "Odrážkový seznam",
	"editor.quote": "Citace",
	"editor.code": "Kód",
	"editor.codeBlock": "Blok kódu",
	"editor.table": "Vložit tabulku",
	"editor.undo": "Zpět",
	"editor.redo": "Znovu",
	"editor.alignLeft": "Zarovnat vlevo",
	"editor.alignCenter": "Zarovnat na střed",
	"editor.alignRight": "Zarovnat vpravo",
	"editor.alignJustify": "Zarovnat do bloku",
	"editor.horizontalRule": "Horizontální čára",
	"editor.addRowBefore": "Přidat řádek před",
	"editor.addRowAfter": "Přidat řádek za",
	"editor.addColumnBefore": "Přidat sloupec před",
	"editor.addColumnAfter": "Přidat sloupec za",
	"editor.deleteRow": "Smazat řádek",
	"editor.deleteColumn": "Smazat sloupec",
	"editor.deleteTable": "Smazat tabulku",
	"editor.toggleHeaderRow": "Přepnout hlavičku řádku",
	"editor.toggleHeaderColumn": "Přepnout hlavičku sloupce",
	"editor.mergeCells": "Sloučit buňky",
	"editor.splitCell": "Rozdělit buňku",
	"editor.insertUrl": "Vložit URL",
	"editor.altText": "Alternativní text (volitelné)",
	"editor.uploadFile": "Nahrát soubor",
	"editor.chooseFile": "Vybrat soubor",
	"editor.uploading": "Nahrávání...",
	"editor.browseLibrary": "Procházet knihovnu",
	"editor.startWriting": "Začněte psát...",
	"editor.pasteOrTypeLink": "Vložte nebo zadejte odkaz...",
	"editor.paragraphDescription": "Začít obyčejným textem",
	"editor.heading1Description": "Velký sekční nadpis",
	"editor.heading2Description": "Střední sekční nadpis",
	"editor.heading3Description": "Menší sekční nadpis",
	"editor.bulletListDescription": "Vytvořit odrážkový seznam",
	"editor.orderedListDescription": "Vytvořit číslovaný seznam",
	"editor.quoteDescription": "Vložit citaci",
	"editor.codeBlockDescription": "Vložit ukázku kódu",
	"editor.dividerDescription": "Vložit horizontální čáru",
	"editor.tableDescription": "Vložit tabulku 3x3",

	// Toasts
	"toast.success": "Úspěch",
	"toast.error": "Chyba",
	"toast.warning": "Varování",
	"toast.info": "Informace",
	"toast.saving": "Ukládání...",
	"toast.saveFailed": "Nepodařilo se uložit změny",
	"toast.saveSuccess": "Změny úspěšně uloženy",
	"toast.creating": "Vytváření...",
	"toast.createSuccess": "Úspěšně vytvořeno",
	"toast.createFailed": "Nepodařilo se vytvořit",
	"toast.deleting": "Mazání...",
	"toast.deleteFailed": "Nepodařilo se smazat",
	"toast.deleteSuccess": "Úspěšně smazáno",
	"toast.loadFailed": "Nepodařilo se načíst data",
	"toast.uploadFailed": "Nepodařilo se nahrát soubor",
	"toast.uploadSuccess": "Soubor úspěšně nahrán",
	"toast.copySuccess": "Zkopírováno do schránky",
	"toast.copyFailed": "Nepodařilo se zkopírovat do schránky",
	"toast.idCopied": "ID zkopírováno do schránky",
	"toast.validationFailed": "Validace selhala",
	"toast.validationDescription": "Zkontrolujte formulář na chyby",
	"toast.created": "{{name}} vytvořen",
	"toast.updated": "{{name}} aktualizován",
	"toast.resourceSaveFailed": "Nepodařilo se uložit {{name}}",
	"toast.editComingSoon": "Funkce úprav brzy dostupná",
	"toast.maxFilesWarning":
		"Můžete přidat jen {{remaining}} další soubor(y) (max {{max}})",
	"toast.settingsSaveFailed": "Nepodařilo se uložit nastavení",
	"toast.actionSuccess": "Akce úspěšně dokončena",
	"toast.actionFailed": "Akce selhala",
	"toast.localeChangedUnsaved": "Jazyk obsahu změněn",
	"toast.localeChangedUnsavedDescription":
		"Vaše neuložené změny byly nahrazeny obsahem v novém jazyce.",

	// Confirm
	"confirm.delete": "Opravdu chcete smazat? Tuto akci nelze vrátit zpět.",
	"confirm.discard":
		"Opravdu chcete zahodit změny? Tuto akci nelze vrátit zpět.",
	"confirm.unsavedChanges": "Máte neuložené změny. Opravdu chcete odejít?",
	"confirm.action": "Opravdu chcete pokračovat?",
	"confirm.irreversible": "Tuto akci nelze vrátit zpět.",
	"confirm.localeChange": "Zahodit neuložené změny?",
	"confirm.localeChangeDescription":
		"Máte neuložené změny. Přepnutí jazyka zahodí změny a načte obsah v novém jazyce.",
	"confirm.localeChangeStay": "Zůstat",
	"confirm.localeChangeDiscard": "Zahodit a přepnout",

	// Status
	"status.draft": "Koncept",
	"status.published": "Publikováno",
	"status.archived": "Archivováno",
	"status.pending": "Čeká",
	"status.active": "Aktivní",
	"status.inactive": "Neaktivní",

	// Dates
	"date.today": "Dnes",
	"date.yesterday": "Včera",
	"date.tomorrow": "Zítra",
	"date.selectDate": "Vybrat datum",
	"date.selectTime": "Vybrat čas",
	"date.clear": "Vymazat datum",

	// Accessibility
	"a11y.openMenu": "Otevřít menu",
	"a11y.closeMenu": "Zavřít menu",
	"a11y.expand": "Rozbalit",
	"a11y.collapse": "Sbalit",
	"a11y.loading": "Načítání",
	"a11y.required": "Povinné",
	"a11y.optional": "Volitelné",
	"a11y.selected": "Vybráno",
	"a11y.notSelected": "Není vybráno",

	// Locale
	"locale.language": "Jazyk",
	"locale.switchLanguage": "Přepnout jazyk",
	"locale.contentLanguage": "Jazyk obsahu",
	"locale.uiLanguage": "Jazyk rozhraní",

	// ===========================================
	// Default Collections
	// ===========================================

	// Users Collection
	"defaults.users.label": "Uživatelé",
	"defaults.users.description": "Spravovat uživatele a jejich role",
	"defaults.users.fields.name.label": "Jméno",
	"defaults.users.fields.name.placeholder": "Zadejte jméno uživatele",
	"defaults.users.fields.email.label": "E-mail",
	"defaults.users.fields.email.description": "E-mailová adresa (jen pro čtení)",
	"defaults.users.fields.role.label": "Role",
	"defaults.users.fields.role.options.admin": "Administrátor",
	"defaults.users.fields.role.options.user": "Uživatel",
	"defaults.users.fields.emailVerified.label": "E-mail ověřen",
	"defaults.users.fields.emailVerified.description":
		"Zda uživatel ověřil svou e-mailovou adresu",
	"defaults.users.fields.banned.label": "Blokován",
	"defaults.users.fields.banned.description":
		"Zabránit uživateli přístup do systému",
	"defaults.users.fields.banReason.label": "Důvod blokace",
	"defaults.users.fields.banReason.placeholder": "Zadejte důvod blokace...",
	"defaults.users.sections.basicInfo": "Základní informace",
	"defaults.users.sections.permissions": "Oprávnění",
	"defaults.users.sections.accessControl": "Řízení přístupu",
	"defaults.users.actions.createUser.label": "Vytvořit uživatele",
	"defaults.users.actions.createUser.title": "Vytvořit uživatele",
	"defaults.users.actions.createUser.description":
		"Vytvořit nový uživatelský účet s přihlašovacími údaji.",
	"defaults.users.actions.createUser.fields.password.label": "Heslo",
	"defaults.users.actions.createUser.fields.password.placeholder":
		"Zadejte heslo",
	"defaults.users.actions.createUser.submit": "Vytvořit uživatele",
	"defaults.users.actions.createUser.success":
		"Uživatel {{email}} úspěšně vytvořen. Sdílejte přihlašovací údaje s uživatelem.",
	"defaults.users.actions.createUser.errorNoAuth":
		"Auth klient není nakonfigurován. Nelze vytvořit uživatele.",
	"defaults.users.actions.resetPassword.label": "Resetovat heslo",
	"defaults.users.actions.resetPassword.title": "Resetovat heslo",
	"defaults.users.actions.resetPassword.description":
		"Nastavit nové heslo pro tohoto uživatele.",
	"defaults.users.actions.resetPassword.fields.newPassword.label": "Nové heslo",
	"defaults.users.actions.resetPassword.fields.newPassword.placeholder":
		"Zadejte nové heslo",
	"defaults.users.actions.resetPassword.fields.confirmPassword.label":
		"Potvrdit heslo",
	"defaults.users.actions.resetPassword.fields.confirmPassword.placeholder":
		"Potvrďte nové heslo",
	"defaults.users.actions.resetPassword.submit": "Resetovat heslo",
	"defaults.users.actions.resetPassword.success": "Heslo úspěšně resetováno!",
	"defaults.users.actions.resetPassword.errorMismatch": "Hesla se neshodují",
	"defaults.users.actions.delete.label": "Smazat uživatele",

	// Assets Collection
	"defaults.assets.label": "Média",
	"defaults.assets.description": "Spravovat nahrané soubory a obrázky",
	"defaults.assets.fields.preview.label": "Náhled",
	"defaults.assets.fields.filename.label": "Název souboru",
	"defaults.assets.fields.filename.description":
		"Původní název nahraného souboru",
	"defaults.assets.fields.mimeType.label": "Typ",
	"defaults.assets.fields.mimeType.description": "MIME typ souboru",
	"defaults.assets.fields.size.label": "Velikost (bajty)",
	"defaults.assets.fields.size.description": "Velikost souboru v bajtech",
	"defaults.assets.fields.alt.label": "Alternativní text",
	"defaults.assets.fields.alt.placeholder": "Popište obrázek pro přístupnost",
	"defaults.assets.fields.alt.description":
		"Alternativní text pro čtečky obrazovky",
	"defaults.assets.fields.caption.label": "Popisek",
	"defaults.assets.fields.caption.placeholder": "Přidejte popisek...",
	"defaults.assets.fields.visibility.label": "Viditelnost",
	"defaults.assets.fields.visibility.options.public": "Veřejné",
	"defaults.assets.fields.visibility.options.private": "Soukromé",
	"defaults.assets.fields.visibility.description":
		"Veřejné soubory jsou dostupné bez autentizace. Soukromé soubory vyžadují podepsanou URL.",
	"defaults.assets.sections.fileInfo": "Informace o souboru",
	"defaults.assets.sections.metadata": "Metadata",
	"defaults.assets.sections.metadata.description":
		"Přidejte popisné informace pro přístupnost a SEO",
	"defaults.assets.actions.upload.label": "Nahrát soubory",

	// Default Sidebar
	"defaults.sidebar.administration": "Administrace",

	// View Options (Filter Builder)
	"viewOptions.title": "Možnosti zobrazení",
	"viewOptions.columns": "Sloupce",
	"viewOptions.filters": "Filtry",
	"viewOptions.savedViews": "Uložená zobrazení",
	"viewOptions.apply": "Použít",
	"viewOptions.reset": "Resetovat",

	// Saved Views Tab
	"viewOptions.saveCurrentConfig": "Uložit aktuální konfiguraci",
	"viewOptions.viewNamePlaceholder": "Název zobrazení...",
	"viewOptions.saveDescription": "Uloží aktuální sloupce, filtry a řazení.",
	"viewOptions.noChangesToSave": "Žádné filtry nebo změny sloupců k uložení.",
	"viewOptions.noSavedViews": "Zatím žádná uložená zobrazení.",
	"viewOptions.filtersCount": {
		one: "{{count}} filtr",
		other: "{{count}} filtrů",
	},
	"viewOptions.columnsCount": {
		one: "{{count}} sloupec",
		other: "{{count}} sloupců",
	},
	"viewOptions.defaultView": "Výchozí",

	// Columns Tab
	"viewOptions.columnsDragHint":
		"Přetáhněte pro změnu pořadí, přepněte pro zobrazení/skrytí sloupců.",
	"viewOptions.noFieldsAvailable": "Žádná dostupná pole.",

	// Filters Tab
	"viewOptions.filtersDescription": "Zúžte výsledky vlastními pravidly.",
	"viewOptions.filterNumber": "Filtr #{{number}}",
	"viewOptions.selectField": "Vybrat pole",
	"viewOptions.selectOperator": "Vybrat operátor",
	"viewOptions.valuePlaceholder": "Hodnota...",
	"viewOptions.noActiveFilters": "Žádné aktivní filtry.",
	"viewOptions.addFilter": "Přidat filtr",
	"viewOptions.clearAll": "Vymazat vše",
	"viewOptions.activeFilters": {
		one: "{{count}} aktivní filtr",
		other: "{{count}} aktivních filtrů",
	},
	"viewOptions.clearFilters": "Vymazat filtry",

	// Filter Operators
	"filter.contains": "Obsahuje",
	"filter.notContains": "Neobsahuje",
	"filter.equals": "Rovná se",
	"filter.notEquals": "Nerovná se",
	"filter.startsWith": "Začíná na",
	"filter.endsWith": "Končí na",
	"filter.greaterThan": "Větší než",
	"filter.greaterThanOrEqual": "Větší než nebo rovno",
	"filter.lessThan": "Menší než",
	"filter.lessThanOrEqual": "Menší než nebo rovno",
	"filter.in": "Je některý z",
	"filter.notIn": "Není žádný z",
	"filter.some": "Má nějaký",
	"filter.every": "Má všechny",
	"filter.none": "Nemá žádný",
	"filter.isEmpty": "Je prázdné",
	"filter.isNotEmpty": "Není prázdné",

	// Preview
	"preview.show": "Náhled",
	"preview.hide": "Skrýt náhled",
	"preview.title": "Náhled",
	"preview.livePreview": "Živý náhled",
	"preview.fullscreen": "Celá obrazovka",
	"preview.close": "Zavřít náhled",
	"preview.loading": "Načítání náhledu...",
	"preview.pathRequired": "Cesta je povinná",
	"preview.collectionNameRequired": "Název kolekce je povinný",
	"preview.adminSessionRequired": "Je vyžadována admin relace",
	"preview.invalidTokenFormat": "Neplatný formát tokenu",
	"preview.invalidSignature": "Neplatný podpis",
	"preview.invalidPayload": "Neplatná data tokenu",
	"preview.tokenExpired": "Platnost tokenu vypršela",
	"preview.invalidPath": "Neplatná cesta",
	"preview.collectionNotFound": 'Kolekce "{{collection}}" nebyla nalezena',
	"preview.noUrlConfigured": "Pro tuto kolekci není nastavena URL náhledu",
	"preview.disabledForCollection": "Náhled je pro tuto kolekci vypnutý",
	"preview.generateUrlFailed":
		"Nepodařilo se vygenerovat URL náhledu: {{message}}",

	// Autosave
	"autosave.saving": "Ukládání...",
	"autosave.saved": "Uloženo",
	"autosave.unsavedChanges": "Neuložené změny",
	"autosave.justNow": "právě teď",
	"autosave.secondsAgo": {
		one: "{{count}}s zpátky",
		other: "{{count}}s zpátky",
	},
	"autosave.minutesAgo": {
		one: "{{count}}m zpátky",
		other: "{{count}}m zpátky",
	},
	"autosave.hoursAgo": { one: "{{count}}h zpátky", other: "{{count}}h zpátky" },

	// Global Search
	"globalSearch.placeholder": "Hledat kolekce, globály, akce, záznamy...",
	"globalSearch.collections": "Kolekce",
	"globalSearch.globals": "Globály",
	"globalSearch.quickActions": "Rychlé akce",
	"globalSearch.records": "Záznamy",
	"globalSearch.createNew": "Vytvořit nový {{name}}",
	"globalSearch.noResults": "Nenalezeny žádné výsledky",
	"globalSearch.searching": "Hledání...",
	"globalSearch.navigate": "pro navigaci",
	"globalSearch.select": "pro výběr",

	// Collection Search
	"collectionSearch.placeholder": "Hledat záznamy...",
	"collectionSearch.noResults": "Nenalezeny žádné odpovídající záznamy",
	"collectionSearch.searching": "Hledání...",

	// Audit
	"audit.section.activity": "Aktivita",

	// English parity additions
	"common.moreActions": "Další akce",
	"common.backToList": "Zpět na seznam",
	"common.deleted": "Smazáno",
	"common.done": "Hotovo",
	"common.noValue": "Žádná hodnota",
	"nav.breadcrumb": "Drobečková navigace",
	"nav.adminNavigation": "Navigace administrace",

	"dashboard.noWidgets": "Nejsou nakonfigurovány žádné widgety",
	"dashboard.noWidgetsDescription":
		"Přidejte widgety do konfigurace dashboardu, aby se zde zobrazila data.",
	"dashboard.systemStatus": "Stav systému",
	"dashboard.welcomeDescription":
		"Vyberte kolekci z postranního panelu pro správu obsahu.",

	"collection.restoring": "Obnovování...",
	"collection.restoreSuccess": "Položka byla úspěšně obnovena",
	"collection.restoreError": "Položku se nepodařilo obnovit",
	"collection.bulkRestoreSuccess": {
		one: "Úspěšně obnovena {{count}} položka",
		other: "Úspěšně obnoveno {{count}} položek",
	},
	"collection.bulkRestoreError": "Nepodařilo se obnovit položky",
	"collection.bulkRestorePartial": {
		one: "Obnovena {{success}} položka, {{failed}} selhalo",
		other: "Obnoveno {{success}} položek, {{failed}} selhalo",
	},
	"collection.orderSaved": "Pořadí uloženo",
	"collection.orderSaveFailed": "Pořadí se nepodařilo uložit",
	"collection.reorderMode": "Režim změny pořadí",
	"collection.sortedByField": "Seřazeno podle {{field}} {{direction}}.",
	"collection.reorderEnableOrderable":
		"Před změnou pořadí povolte možnost řazení",
	"collection.reorderAddOrderField":
		"Před změnou pořadí přidejte číselné pole pro pořadí",
	"collection.reorderClearSearch": "Pro změnu pořadí vymažte vyhledávání",
	"collection.reorderRemoveGrouping": "Pro změnu pořadí zrušte seskupení",
	"collection.reorderClearFilters": "Pro změnu pořadí vymažte filtry",
	"collection.reorderShowOnePage":
		"Pro změnu pořadí zobrazte jednu stránku položek",
	"collection.reorderExitMode": "Ukončit režim změny pořadí",
	"collection.reorderItems": "Změnit pořadí položek",
	"collection.reorderSwitchSort":
		"Přepnout na řazení podle {{field}} a změnit pořadí",
	"collection.reorderUnavailable": "Změna pořadí není dostupná: {{reason}}",
	"collection.reorderEnterMode": "Spustit režim změny pořadí",

	"blocks.add": "Přidat blok",
	"blocks.addTo": "Přidat do {{parent}}",
	"blocks.addFirst": "Přidejte první blok a začněte",
	"blocks.unknownType":
		'Neznámý typ bloku "{{type}}". Tento typ bloku není zaregistrován.',
	"blocks.searchPlaceholder": "Hledat bloky...",
	"blocks.uncategorized": "Ostatní",
	"blocks.noEditableFields": "Tento blok nemá žádná upravitelná pole.",
	"blocks.noDefinitions": "Nejsou zaregistrovány žádné definice bloků",
	"blocks.noDefinitionsHint":
		"Zaregistrujte bloky pomocí .blocks() v konfiguraci administrace",
	"blocks.emptyTitle": "Zatím žádné bloky",
	"blocks.libraryDescription": "Vyberte typ bloku, který chcete přidat.",
	"blocks.noSearchResults": "Vyhledávání neodpovídají žádné bloky",
	"blocks.tryDifferentSearch": "Zkuste jiný vyhledávací dotaz.",

	"form.deletedBanner":
		"Tento záznam byl smazán {{date}}. Použijte akci Obnovit, aby byl znovu aktivní.",
	"form.lastUpdated": "Naposledy aktualizováno",

	"auth.forgotPasswordTitle": "Zapomenuté heslo",
	"auth.forgotPasswordDescription":
		"Zadejte svůj e-mail a obdržíte odkaz pro reset hesla",
	"auth.checkYourEmail": "Zkontrolujte svůj e-mail",
	"auth.resetLinkSentDescription":
		"Odeslali jsme vám odkaz pro reset hesla. Zkontrolujte doručenou poštu a postupujte podle pokynů.",
	"auth.backToLogin": "Zpět na přihlášení",
	"auth.forgotPasswordFormDescription":
		"Zadejte svou e-mailovou adresu a pošleme vám odkaz pro reset hesla.",
	"auth.rememberYourPassword": "Pamatujete si heslo?",
	"auth.resetPasswordSuccess": "Heslo bylo úspěšně resetováno",
	"auth.resetPasswordSuccessDescription":
		"Vaše heslo bylo úspěšně resetováno. Nyní se můžete přihlásit s novým heslem.",
	"auth.enterNewPassword": "Zadejte níže nové heslo.",
	"auth.createAccountDescription": "Vytvořte si účet a začněte",
	"auth.inviteEmailLabel": "E-mailová adresa",
	"auth.inviteEmailDescription":
		"Na tento e-mail bude odeslán odkaz s pozvánkou",
	"auth.inviteRole": "Role",
	"auth.inviteSelectRole": "Vyberte roli",
	"auth.inviteRoleDescription": "Role určuje, jaká oprávnění bude uživatel mít",
	"auth.inviteMessage": "Osobní zpráva (volitelné)",
	"auth.inviteMessagePlaceholder": "Přidejte k pozvánce osobní zprávu...",
	"auth.inviteMessageDescription":
		"Tato zpráva bude zahrnuta v e-mailu pozvánky",
	"auth.sendingInvitation": "Odesílání pozvánky...",
	"auth.sendInvitation": "Odeslat pozvánku",
	"auth.inviteSentSuccess": "Pozvánka byla úspěšně odeslána",
	"auth.signInDescription":
		"Zadejte své přihlašovací údaje pro přístup do administrace",
	"auth.inviteUser": "Pozvat uživatele",
	"auth.inviteUserDescription":
		"Odešlete pozvánku pro přidání nového uživatele",
	"auth.inviteSentTo": "Pozvánka byla odeslána na {{email}}",
	"auth.completeRegistration": "Dokončit registraci",
	"auth.validatingInvitation": "Ověřování pozvánky",
	"auth.pleaseWait": "Čekejte prosím...",
	"auth.invalidInvitation": "Neplatná pozvánka",
	"auth.invalidInvitationDescription":
		"Tento odkaz s pozvánkou již není platný",
	"auth.invalidOrExpiredInvitation": "Neplatná nebo vypršená pozvánka",
	"auth.invitationExpiredMessage":
		"Platnost pozvánky mohla vypršet nebo již byla použita. Požádejte administrátora o novou pozvánku.",
	"auth.goToLogin": "Přejít na přihlášení",
	"auth.invalidLink": "Neplatný odkaz",
	"auth.invalidLinkDescription":
		"Odkaz pro reset hesla je neplatný nebo jeho platnost vypršela.",
	"auth.requestNewResetLink": "Požádejte o nový odkaz pro reset hesla.",
	"auth.user": "Uživatel",

	"error.somethingWentWrong": "Něco se pokazilo",
	"error.unexpectedError": "Došlo k neočekávané chybě",
	"error.failedToLoad": "Nepodařilo se načíst",
	"error.failedToLoadView": "Nepodařilo se načíst {{viewType}}",
	"error.failedToLoadViewFor":
		"Nepodařilo se načíst {{viewType}} pro {{collection}}",
	"error.widgetError": "Chyba widgetu",
	"error.unknownWidget": "Neznámý widget",
	"error.widgetTypeNotRecognized": 'Typ widgetu "{{type}}" nebyl rozpoznán.',
	"error.componentNotFound": "Komponenta nebyla nalezena",
	"error.failedToLoadComponent": "Komponentu se nepodařilo načíst",
	"error.pageNotFound": "Stránka nebyla nalezena",
	"error.pageNotFoundDescription": "Stránka, kterou hledáte, neexistuje.",
	"error.accessRestricted": "Přístup omezen",
	"error.accessRestrictedDescription":
		"Nemáte oprávnění k přístupu na tuto stránku. Pokud si myslíte, že jde o chybu, kontaktujte administrátora.",
	"error.accessRestrictedResourceDescription":
		'{{type}} "{{name}}" není v administraci dostupný. Může být skrytý nebo k němu nemáte oprávnění.',
	"error.tryAgain": "Zkusit znovu",
	"error.backToDashboard": "Zpět na dashboard",
	"error.noUploadCollection":
		"Není nakonfigurována žádná kolekce pro nahrávání.",
	"error.multipleUploadCollections":
		"Je dostupných více kolekcí pro nahrávání ({{collections}}). Určete, kterou kolekci použít.",
	"error.autosaveFailed": "Automatické uložení selhalo",
	"error.actionFailed": "Akce selhala",
	"error.serverActionFailed": "Serverová akce selhala",
	"error.failedToLoadOptions": "Nepodařilo se načíst možnosti",
	"error.failedToLoadAssets": "Nepodařilo se načíst soubory",
	"error.failedToLoadSelectedItems": "Nepodařilo se načíst vybrané položky",
	"error.invalidCredentials": "Neplatné přihlašovací údaje",
	"error.failedToSendResetEmail": "Nepodařilo se odeslat e-mail pro reset",
	"error.failedToResetPassword": "Nepodařilo se resetovat heslo",
	"error.failedToCreateAccount": "Nepodařilo se vytvořit účet",
	"error.failedToCreateAdminAccount":
		"Nepodařilo se vytvořit administrátorský účet",
	"error.failedToSendInvitation": "Nepodařilo se odeslat pozvánku",
	"error.anErrorOccurred": "Došlo k chybě",
	"error.uploadFailed": "Nahrávání selhalo",
	"error.failedToGeneratePreviewToken":
		"Nepodařilo se vygenerovat token náhledu",
	"error.missingFieldComponent":
		"Pro typ pole není zaregistrována žádná komponenta: {{type}}",
	"error.selectAtLeastOne": "Vyberte alespoň jeden soubor",
	"error.maxItemsAllowed": "Povoleno je maximálně {{max}} položek",
	"error.unregisteredViewDescription":
		'Zobrazení "{{viewId}}" není zaregistrováno v registru zobrazení administrace.',

	"table.show": "Zobrazit",
	"table.noItemsInCollection": "V této kolekci nebyly nalezeny žádné položky",
	"table.emptyDescription": "Záznamy se zde zobrazí po vytvoření.",
	"table.pagination": "Stránkování",
	"table.editing": "Úpravy",

	"upload.bulkTitle": "Nahrát soubory",
	"upload.bulkDescription": "Přidejte do knihovny médií více souborů",
	"upload.bulkHint": "Nahrajte více souborů najednou",
	"upload.bulkSuccess": {
		one: "{{count}} soubor úspěšně nahrán",
		other: "{{count}} souborů úspěšně nahráno",
	},
	"upload.bulkError": {
		one: "{{count}} soubor se nepodařilo nahrát",
		other: "{{count}} souborů se nepodařilo nahrát",
	},
	"upload.waitForComplete": "Počkejte prosím na dokončení nahrávání",
	"upload.filesCount": {
		one: "{{count}} soubor",
		other: "{{count}} souborů",
	},
	"upload.uploadedCount": {
		one: "{{count}} nahrán",
		other: "{{count}} nahráno",
	},
	"upload.failedCount": {
		one: "{{count}} selhal",
		other: "{{count}} selhalo",
	},
	"upload.browseLibrary": "Procházet knihovnu",

	"confirm.deleteSelected": "Smazat vybrané",
	"confirm.deleteSelectedTitle": "Smazat vybrané položky?",
	"confirm.deleteSelectedDescription":
		"Tuto akci nelze vrátit zpět. Všechny vybrané položky budou trvale smazány.",
	"confirm.deleteAll": "Smazat vše",
	"confirm.restoreTitle": "Obnovit položku?",
	"confirm.restoreDescription":
		"Tato položka se znovu zobrazí v běžných seznamech.",
	"confirm.restore": "Obnovit",
	"confirm.deleteItemTitle": "Smazat položku?",
	"confirm.deleteItemDescription":
		"Tuto akci nelze vrátit zpět. Položka bude trvale smazána.",

	"input.selectDate": "Vybrat datum",
	"input.selectDateTime": "Vybrat datum a čas",
	"input.selectDateRange": "Vybrat rozsah dat",
	"input.selectTime": "Vybrat čas",

	"defaults.users.tabs.profile": "Profil",
	"defaults.users.tabs.security": "Zabezpečení",
	"defaults.assets.sections.dimensions": "Rozměry",

	"viewOptions.realtime": "Aktualizace v reálném čase",
	"viewOptions.realtimeDescription":
		"Automaticky obnovovat tuto tabulku při změně dat.",
	"viewOptions.showDeleted": "Zobrazit smazané",
	"viewOptions.showDeletedDescription":
		"Zahrnout do tohoto zobrazení soft-deleted záznamy.",
	"viewOptions.groupBy": "Seskupit podle",
	"viewOptions.groupByDescription":
		"Seskupit aktuální stránku podle nakonfigurovaného pole.",
	"viewOptions.noGrouping": "Bez seskupení",
	"viewOptions.sort": "Řazení",

	"version.history": "Historie verzí",
	"version.historyDescription":
		"Procházejte předchozí verze a v případě potřeby některou obnovte.",
	"version.globalHistoryDescription":
		"Procházejte předchozí verze globálních nastavení a v případě potřeby některou obnovte.",
	"version.empty": "Nebyly nalezeny žádné verze.",
	"version.label": "Verze {{number}}",
	"version.createdAt": "Vytvořeno",
	"version.user": "Uživatel",
	"version.revert": "Obnovit",
	"version.revertSuccess": "Verze byla úspěšně obnovena",
	"version.operationCreate": "Vytvořeno",
	"version.operationUpdate": "Aktualizováno",
	"version.operationDelete": "Smazáno",
	"version.operationUnknown": "Změněno",
	"version.revertConfirmTitle": "Vrátit se k této verzi?",
	"version.revertConfirmDescription":
		"Tato akce nahradí aktuální obsah verzí {{number}}.",

	"viewOptions.noResultsDescription":
		"Aktivním filtrům neodpovídají žádné záznamy. Upravte je nebo je vymažte, abyste viděli více výsledků.",

	"preview.exitPreview": "Ukončit náhled",
	"preview.exitTooltip": "Ukončit režim náhledu a vymazat cookie konceptu",
	"preview.loadingPreview": "Načítání náhledu...",
	"preview.previewError": "Chyba náhledu",
	"preview.refreshing": "Obnovování...",
	"preview.showPreview": "Zobrazit náhled",
	"preview.hidePreview": "Skrýt náhled",
	"preview.mode": "Režim náhledu",

	"collectionSearch.noResultsDescription":
		"Zkuste jiný vyhledávací dotaz nebo vyhledávání vymažte a vraťte se na celý seznam.",

	"audit.collection.label": "Auditní log",
	"audit.collection.description":
		"Procházejte všechny zaznamenané změny a aktivitu uživatelů",
	"audit.sections.event": "Podrobnosti události",
	"audit.sections.user": "Uživatel",
	"audit.sections.changes": "Změny",
	"audit.widget.recentActivity.title": "Nedávná aktivita",
	"audit.widget.recentActivity.empty":
		"Nebyla zaznamenána žádná nedávná aktivita.",

	"history.title": "Historie",
	"history.description": "Změny a aktivita pro tento záznam",
	"history.versionDescription":
		"Procházejte snímky verzí a kontrolujte rozdíly na úrovni polí.",
	"history.tabActivity": "Aktivita",
	"history.tabVersions": "Verze",
	"history.empty": "Nebyla zaznamenána žádná aktivita",
	"history.showChanges": {
		one: "Zobrazit změnu ({{count}})",
		other: "Zobrazit změny ({{count}})",
	},
	"history.hideChanges": "Skrýt změny",
	"history.changedFields": {
		one: "{{count}} změněné pole",
		other: "{{count}} změněných polí",
	},
	"history.moreFields": {
		one: "{{count}} další",
		other: "{{count}} dalších",
	},
	"history.changeAdded": "Přidáno",
	"history.changeRemoved": "Odstraněno",
	"history.changeChanged": "Změněno",
	"history.diffAgainstVersion": "Rozdíl oproti verzi {{number}}",
	"history.initialSnapshot": "Počáteční snímek",
	"history.noFieldChanges": "V tomto snímku nejsou žádné změny na úrovni polí.",
	"history.before": "Před",
	"history.after": "Po",
	"history.stage": "Fáze",
	"history.systemUser": "Systém",
	"history.itemsCount": {
		one: "{{count}} položka",
		other: "{{count}} položek",
	},
	"history.blocksCount": {
		one: "{{count}} blok",
		other: "{{count}} bloků",
	},
	"history.objectWithKeys": {
		one: "Objekt s {{count}} klíčem",
		other: "Objekt s {{count}} klíči",
	},

	"workflow.transition": "Přechod",
	"workflow.currentStage": "Aktuální fáze",
	"workflow.transitionTo": "Přejít do {{stage}}",
	"workflow.transitionDescription":
		'Tato akce provede přechod z "{{from}}" do "{{to}}".',
	"workflow.scheduleLabel": "Naplánovat na později",
	"workflow.scheduledAt": "Naplánované datum a čas",
	"workflow.scheduledDescription":
		"Přechod proběhne automaticky v naplánovaném čase.",
	"workflow.transitionSuccess": 'Úspěšně převedeno do "{{stage}}"',
	"workflow.scheduledSuccess": 'Přechod do "{{stage}}" naplánován na {{date}}',
	"workflow.transitionFailed": "Přechod se nezdařil",
	"workflow.noTransitions": "Z této fáze nejsou dostupné žádné přechody",

	"lock.blockedTitle": "{{name}} právě upravuje",
	"lock.blockedDescription":
		"Tento dokument je uzamčen. Můžete ho zobrazit, ale nemůžete provádět změny, dokud zámek nevyprší.",
	"lock.openElsewhere":
		"Tento dokument máte otevřený v jiné kartě. Změny se automaticky synchronizují.",
	"lock.cannotSave": "Nelze uložit - dokument je uzamčen jiným uživatelem",

	"ui.toggleSidebar": "Přepnout postranní panel",
	"ui.expandSidebar": "Rozbalit postranní panel",
	"ui.skipToMainContent": "Přeskočit na hlavní obsah",
	"ui.processing": "Zpracování...",
	"ui.commandPalette": "Paleta příkazů",
	"ui.commandPaletteDescription": "Vyhledejte příkaz ke spuštění...",
	"ui.searchPlaceholder": "Hledat...",
	"ui.expand": "Rozbalit",
	"ui.toggleTheme": "Přepnout motiv",
	"ui.themeLight": "Světlý",
	"ui.themeDark": "Tmavý",
	"ui.themeSystem": "Systémový",

	"dropzone.label": "Přetáhněte sem soubory nebo klikněte pro procházení",
	"dropzone.invalidType": '"{{name}}" není povolený typ souboru',
	"dropzone.tooLarge": '"{{name}}" překračuje maximální velikost {{maxSize}}',
	"dropzone.uploading": "Nahrávání...",
	"dropzone.typeImages": "Obrázky",
	"dropzone.typeVideos": "Videa",
	"dropzone.typeAudio": "Audio",
	"dropzone.typePDF": "PDF",

	"media.browseLibrary": "Procházet knihovnu médií",
	"media.allFiles": "Všechny soubory",
	"media.images": "Obrázky",
	"media.videos": "Videa",
	"media.audio": "Audio",
	"media.documents": "Dokumenty",
	"media.searchPlaceholder": "Hledat podle názvu souboru...",
	"media.noAssets": "Nebyla nalezena žádná média",

	"field.moveUp": "Přesunout nahoru",
	"field.moveDown": "Přesunout dolů",
	"field.dragToReorder": "Přetažením změnit pořadí",
	"field.editItem": "Upravit položku",
	"field.removeItem": "Odstranit položku",
	"field.noItems": "Žádné položky",
	"field.codeEditor": "Editor kódu",
	"field.formEditor": "Editor formuláře",
	"field.section": "Sekce",

	"cell.file": {
		one: "{{count}} soubor",
		other: "{{count}} souborů",
	},
	"cell.item": {
		one: "{{count}} položka",
		other: "{{count}} položek",
	},
	"cell.more": "+{{count}} dalších",
	"cell.blocks": "Bloky",

	"widget.quickActions.emptyTitle": "Žádné rychlé akce",
	"widget.quickActions.emptyDescription":
		"Rychlé akce se zde zobrazí po nakonfigurování.",
	"widget.chart.emptyTitle": "Žádná data grafu",
	"widget.chart.emptyDescription":
		"Data grafu se zde zobrazí, jakmile budou dostupná.",
	"widget.recentItems.emptyTitle": "Žádné nedávné položky",
	"widget.recentItems.emptyDescription":
		"Nedávné položky se zde zobrazí po vytvoření záznamů.",
	"widget.value.emptyTitle": "Žádná hodnota k zobrazení",
	"widget.value.emptyDescription":
		"Tato hodnota se zobrazí, jakmile budou dostupná data.",
	"widget.progress.emptyTitle": "Žádná data průběhu",
	"widget.progress.emptyDescription":
		"Průběh se zde zobrazí, jakmile budou dostupná data.",
	"widget.timeline.emptyTitle": "Zatím žádná aktivita",
	"widget.timeline.emptyDescription": "Nejsou k zobrazení žádné události.",
	"widget.table.emptyTitle": "Žádné řádky k zobrazení",
	"widget.table.emptyDescription":
		"Pro aktuální kritéria neexistují žádné záznamy.",

	"time.justNow": "právě teď",
	"time.minutesAgoShort": {
		one: "{{count}}m zpátky",
		other: "{{count}}m zpátky",
	},
	"time.hoursAgoShort": {
		one: "{{count}}h zpátky",
		other: "{{count}}h zpátky",
	},
	"time.daysAgoShort": {
		one: "{{count}}d zpátky",
		other: "{{count}}d zpátky",
	},
} as const;
