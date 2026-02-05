/**
 * German Admin UI Messages
 */
export const adminMessagesDE = {
	// Common
	"common.save": "Speichern",
	"common.cancel": "Abbrechen",
	"common.delete": "Löschen",
	"common.edit": "Bearbeiten",
	"common.create": "Erstellen",
	"common.add": "Hinzufügen",
	"common.remove": "Entfernen",
	"common.close": "Schließen",
	"common.form": "Formular",
	"common.search": "Suchen",
	"common.filter": "Filter",
	"common.refresh": "Aktualisieren",
	"common.loading": "Laden...",
	"common.confirm": "Bestätigen",
	"common.back": "Zurück",
	"common.next": "Weiter",
	"common.previous": "Zurück",
	"common.actions": "Aktionen",
	"common.more": "Mehr",
	"common.yes": "Ja",
	"common.no": "Nein",
	"common.ok": "OK",
	"common.apply": "Anwenden",
	"common.reset": "Zurücksetzen",
	"common.clear": "Löschen",
	"common.selectAll": "Alle auswählen",
	"common.deselectAll": "Auswahl aufheben",
	"common.duplicate": "Duplizieren",
	"common.copy": "Kopieren",
	"common.paste": "Einfügen",
	"common.upload": "Hochladen",
	"common.download": "Herunterladen",
	"common.preview": "Vorschau",
	"common.view": "Ansicht",
	"common.open": "Öffnen",
	"common.retry": "Wiederholen",
	"common.submit": "Absenden",

	// Navigation
	"nav.dashboard": "Dashboard",
	"nav.collections": "Sammlungen",
	"nav.globals": "Globals",
	"nav.media": "Medien",
	"nav.settings": "Einstellungen",
	"nav.logout": "Abmelden",
	"nav.home": "Startseite",
	"nav.back": "Zurück",

	// Dashboard
	"dashboard.title": "Dashboard",
	"dashboard.welcome": "Willkommen zurück",
	"dashboard.recentActivity": "Letzte Aktivität",
	"dashboard.quickActions": "Schnellaktionen",

	// Collections
	"collection.create": "{{name}} erstellen",
	"collection.edit": "{{name}} bearbeiten",
	"collection.delete": "{{name}} löschen",
	"collection.deleteConfirm": "Möchten Sie {{name}} wirklich löschen?",
	"collection.noItems": "Keine {{name}} gefunden",
	"collection.createFirst": "Erstellen Sie Ihr erstes {{name}}",
	"collection.itemCount": {
		one: "{{count}} Element",
		other: "{{count}} Elemente",
	},
	"collection.bulkDelete": "Ausgewählte löschen",
	"collection.bulkDeleteConfirm":
		"Möchten Sie {{count}} Elemente wirklich löschen?",
	"collection.bulkDeleteSuccess": {
		one: "{{count}} Element erfolgreich gelöscht",
		other: "{{count}} Elemente erfolgreich gelöscht",
	},
	"collection.bulkDeleteError": "Fehler beim Löschen der Elemente",
	"collection.bulkDeletePartial": {
		one: "{{success}} Element gelöscht, {{failed}} fehlgeschlagen",
		other: "{{success}} Elemente gelöscht, {{failed}} fehlgeschlagen",
	},
	"collection.bulkActionFailed": "Massenaktion fehlgeschlagen",
	"collection.selected": "{{count}} ausgewählt",
	"collection.selectOnPage": "Alle auf dieser Seite",
	"collection.selectAllMatching": "Alle passenden ({{count}})",
	"collection.clearSelection": "Auswahl aufheben",
	"collection.list": "{{name}} Liste",
	"collection.new": "Neues {{name}}",
	"collection.duplicateSuccess": "{{name}} erfolgreich dupliziert",
	"collection.duplicateError": "Fehler beim Duplizieren von {{name}}",

	// Relations
	"relation.select": "{{name}} auswählen",
	"relation.clear": "Auswahl löschen",
	"relation.search": "{{name}} suchen...",
	"relation.noResults": "Keine {{name}} gefunden",
	"relation.loading": "Laden...",
	"relation.createNew": "Neues {{name}} erstellen",
	"relation.selected": "{{count}} ausgewählt",
	"relation.removeItem": "{{name}} entfernen",
	"relation.addItem": "{{name}} hinzufügen",
	"relation.noneSelected": "Kein {{name}} ausgewählt",
	"relation.noRelated": "Keine verwandten Elemente gefunden",
	"relation.saveFirst":
		"Speichern Sie dieses Element zuerst, um verwandte Elemente zu sehen.",

	// Arrays
	"array.empty": "Noch keine {{name}} hinzugefügt",
	"array.addItem": "{{name}} hinzufügen",

	// Blocks
	"blocks.addAbove": "Darüber hinzufügen",
	"blocks.addBelow": "Darunter hinzufügen",
	"blocks.addChild": "Untergeordneten Block hinzufügen",

	// Forms
	"form.id": "ID",
	"form.created": "Erstellt",
	"form.updated": "Aktualisiert",
	"form.required": "Dieses Feld ist erforderlich",
	"form.invalid": "Ungültiger Wert",
	"form.saveChanges": "Änderungen speichern",
	"form.unsavedChanges": "Sie haben ungespeicherte Änderungen",
	"form.discardChanges": "Änderungen verwerfen",
	"form.discardConfirm":
		"Möchten Sie die Änderungen wirklich verwerfen? Diese Aktion kann nicht rückgängig gemacht werden.",
	"form.fieldRequired": "{{field}} ist erforderlich",
	"form.fieldInvalid": "{{field}} ist ungültig",
	"form.maxLength": "Maximal {{max}} Zeichen",
	"form.minLength": "Mindestens {{min}} Zeichen",
	"form.maxValue": "Maximal {{max}}",
	"form.minValue": "Mindestens {{min}}",
	"form.pattern": "Ungültiges Format",
	"form.email": "Ungültige E-Mail-Adresse",
	"form.url": "Ungültige URL",
	"form.createSuccess": "{{name}} erfolgreich erstellt",
	"form.createError": "Fehler beim Erstellen von {{name}}",
	"form.updateSuccess": "{{name}} erfolgreich aktualisiert",
	"form.updateError": "Fehler beim Aktualisieren von {{name}}",
	"form.deleteSuccess": "{{name}} erfolgreich gelöscht",
	"form.deleteError": "Fehler beim Löschen von {{name}}",

	// Auth
	"auth.login": "Anmelden",
	"auth.logout": "Abmelden",
	"auth.email": "E-Mail",
	"auth.password": "Passwort",
	"auth.forgotPassword": "Passwort vergessen?",
	"auth.resetPassword": "Passwort zurücksetzen",
	"auth.signIn": "Anmelden",
	"auth.signOut": "Abmelden",
	"auth.signUp": "Registrieren",
	"auth.rememberMe": "Angemeldet bleiben",
	"auth.invalidCredentials": "Ungültige E-Mail oder Passwort",
	"auth.sessionExpired":
		"Ihre Sitzung ist abgelaufen. Bitte melden Sie sich erneut an.",
	"auth.emailPlaceholder": "sie@beispiel.de",
	"auth.passwordPlaceholder": "Passwort eingeben",
	"auth.signingIn": "Anmeldung...",
	"auth.creatingAdmin": "Administrator wird erstellt...",
	"auth.name": "Name",
	"auth.namePlaceholder": "Ihr Name",
	"auth.confirmPassword": "Passwort bestätigen",
	"auth.confirmPasswordPlaceholder": "Passwort bestätigen",
	"auth.acceptInvite": "Einladung annehmen",
	"auth.acceptingInvite": "Einladung wird angenommen...",
	"auth.dontHaveAccount": "Noch kein Konto?",
	"auth.alreadyHaveAccount": "Bereits ein Konto?",
	"auth.emailRequired": "E-Mail ist erforderlich",
	"auth.passwordRequired": "Passwort ist erforderlich",
	"auth.passwordMinLength": "Passwort muss mindestens {{min}} Zeichen haben",
	"auth.nameRequired": "Name ist erforderlich",
	"auth.nameMinLength": "Name muss mindestens {{min}} Zeichen haben",
	"auth.invalidEmail": "Ungültige E-Mail-Adresse",
	"auth.passwordMismatch": "Passwörter stimmen nicht überein",
	"auth.newPassword": "Neues Passwort",
	"auth.newPasswordPlaceholder": "Neues Passwort eingeben",
	"auth.sendResetLink": "Reset-Link senden",
	"auth.sendingResetLink": "Wird gesendet...",
	"auth.resetLinkSent": "Passwort-Reset-Link wurde an Ihre E-Mail gesendet",
	"auth.resettingPassword": "Passwort wird zurückgesetzt...",
	"auth.createFirstAdmin": "Ersten Administrator erstellen",
	"auth.setupTitle": "Einrichtung",
	"auth.setupDescription": "Erstellen Sie Ihr erstes Administratorkonto.",
	"auth.profile": "Profil",
	"auth.myAccount": "Mein Konto",
	"auth.logoutFailed":
		"Abmeldung fehlgeschlagen. Bitte versuchen Sie es erneut.",

	// Errors
	"error.notFound": "Nicht gefunden",
	"error.serverError": "Serverfehler",
	"error.networkError": "Netzwerkfehler. Bitte überprüfen Sie Ihre Verbindung.",
	"error.unauthorized": "Sie sind nicht berechtigt, diese Aktion auszuführen",
	"error.forbidden": "Zugriff verweigert",
	"error.validation": "Validierung fehlgeschlagen",
	"error.unknown": "Ein unbekannter Fehler ist aufgetreten",
	"error.timeout":
		"Zeitüberschreitung der Anfrage. Bitte versuchen Sie es erneut.",
	"error.conflict":
		"Ein Konflikt ist aufgetreten. Bitte aktualisieren Sie und versuchen Sie es erneut.",

	// Table
	"table.rowsPerPage": "Zeilen pro Seite",
	"table.of": "von",
	"table.noResults": "Keine Ergebnisse",
	"table.selectAll": "Alle auswählen",
	"table.selectRow": "Zeile auswählen",
	"table.showing": "Zeige {{from}} bis {{to}} von {{total}}",
	"table.page": "Seite {{page}}",
	"table.firstPage": "Erste Seite",
	"table.lastPage": "Letzte Seite",
	"table.nextPage": "Nächste Seite",
	"table.previousPage": "Vorherige Seite",
	"table.sortAsc": "Aufsteigend sortieren",
	"table.sortDesc": "Absteigend sortieren",
	"table.columns": "Spalten",
	"table.hideColumn": "Spalte ausblenden",
	"table.showColumn": "Spalte anzeigen",

	// Upload
	"upload.dropzone": "Dateien hier ablegen oder klicken zum Hochladen",
	"upload.browse": "Dateien durchsuchen",
	"upload.uploading": "Wird hochgeladen...",
	"upload.complete": "Hochladen abgeschlossen",
	"upload.error": "Hochladen fehlgeschlagen",
	"upload.maxSize": "Datei muss kleiner als {{size}} sein",
	"upload.invalidType": "Ungültiger Dateityp. Erlaubt: {{types}}",
	"upload.remove": "Datei entfernen",
	"upload.replace": "Datei ersetzen",
	"upload.preview": "Vorschau",
	"upload.noFile": "Keine Datei ausgewählt",
	"upload.dragDrop": "Dateien hier ablegen",

	// Editor
	"editor.bold": "Fett",
	"editor.italic": "Kursiv",
	"editor.underline": "Unterstrichen",
	"editor.strikethrough": "Durchgestrichen",
	"editor.heading": "Überschrift {{level}}",
	"editor.link": "Link einfügen",
	"editor.image": "Bild einfügen",
	"editor.list": "Liste",
	"editor.orderedList": "Nummerierte Liste",
	"editor.unorderedList": "Aufzählungsliste",
	"editor.quote": "Zitat",
	"editor.code": "Code",
	"editor.codeBlock": "Code-Block",
	"editor.table": "Tabelle einfügen",
	"editor.undo": "Rückgängig",
	"editor.redo": "Wiederherstellen",
	"editor.alignLeft": "Linksbündig",
	"editor.alignCenter": "Zentriert",
	"editor.alignRight": "Rechtsbündig",
	"editor.alignJustify": "Blocksatz",
	"editor.horizontalRule": "Horizontale Linie",
	"editor.addRowBefore": "Zeile davor einfügen",
	"editor.addRowAfter": "Zeile danach einfügen",
	"editor.addColumnBefore": "Spalte davor einfügen",
	"editor.addColumnAfter": "Spalte danach einfügen",
	"editor.deleteRow": "Zeile löschen",
	"editor.deleteColumn": "Spalte löschen",
	"editor.deleteTable": "Tabelle löschen",
	"editor.toggleHeaderRow": "Kopfzeile umschalten",
	"editor.toggleHeaderColumn": "Kopfspalte umschalten",
	"editor.mergeCells": "Zellen zusammenführen",
	"editor.splitCell": "Zelle teilen",
	"editor.insertUrl": "URL einfügen",
	"editor.altText": "Alternativtext (optional)",
	"editor.uploadFile": "Datei hochladen",
	"editor.chooseFile": "Datei auswählen",
	"editor.uploading": "Wird hochgeladen...",
	"editor.browseLibrary": "Bibliothek durchsuchen",

	// Toasts
	"toast.success": "Erfolg",
	"toast.error": "Fehler",
	"toast.warning": "Warnung",
	"toast.info": "Info",
	"toast.saving": "Wird gespeichert...",
	"toast.saveFailed": "Fehler beim Speichern der Änderungen",
	"toast.saveSuccess": "Änderungen erfolgreich gespeichert",
	"toast.creating": "Wird erstellt...",
	"toast.createSuccess": "Erfolgreich erstellt",
	"toast.createFailed": "Fehler beim Erstellen",
	"toast.deleting": "Wird gelöscht...",
	"toast.deleteFailed": "Fehler beim Löschen",
	"toast.deleteSuccess": "Erfolgreich gelöscht",
	"toast.loadFailed": "Fehler beim Laden der Daten",
	"toast.uploadFailed": "Fehler beim Hochladen der Datei",
	"toast.uploadSuccess": "Datei erfolgreich hochgeladen",
	"toast.copySuccess": "In Zwischenablage kopiert",
	"toast.copyFailed": "Fehler beim Kopieren in die Zwischenablage",
	"toast.idCopied": "ID in Zwischenablage kopiert",
	"toast.validationFailed": "Validierung fehlgeschlagen",
	"toast.validationDescription": "Bitte überprüfen Sie das Formular auf Fehler",
	"toast.created": "{{name}} erstellt",
	"toast.updated": "{{name}} aktualisiert",
	"toast.resourceSaveFailed": "Fehler beim Speichern von {{name}}",
	"toast.editComingSoon": "Bearbeitungsfunktion demnächst verfügbar",
	"toast.maxFilesWarning":
		"Nur noch {{remaining}} Datei(en) können hinzugefügt werden (max {{max}})",
	"toast.settingsSaveFailed": "Fehler beim Speichern der Einstellungen",
	"toast.actionSuccess": "Aktion erfolgreich abgeschlossen",
	"toast.actionFailed": "Aktion fehlgeschlagen",
	"toast.localeChangedUnsaved": "Inhaltssprache geändert",
	"toast.localeChangedUnsavedDescription":
		"Ihre ungespeicherten Änderungen wurden durch den Inhalt in der neuen Sprache ersetzt.",

	// Confirm
	"confirm.delete":
		"Möchten Sie dies wirklich löschen? Diese Aktion kann nicht rückgängig gemacht werden.",
	"confirm.discard":
		"Möchten Sie die Änderungen wirklich verwerfen? Diese Aktion kann nicht rückgängig gemacht werden.",
	"confirm.unsavedChanges":
		"Sie haben ungespeicherte Änderungen. Möchten Sie wirklich verlassen?",
	"confirm.action": "Möchten Sie wirklich fortfahren?",
	"confirm.irreversible": "Diese Aktion kann nicht rückgängig gemacht werden.",
	"confirm.localeChange": "Ungespeicherte Änderungen verwerfen?",
	"confirm.localeChangeDescription":
		"Sie haben ungespeicherte Änderungen. Das Wechseln der Inhaltssprache verwirft Ihre Änderungen und lädt den Inhalt in der neuen Sprache.",
	"confirm.localeChangeStay": "Bleiben",
	"confirm.localeChangeDiscard": "Verwerfen & wechseln",

	// Status
	"status.draft": "Entwurf",
	"status.published": "Veröffentlicht",
	"status.archived": "Archiviert",
	"status.pending": "Ausstehend",
	"status.active": "Aktiv",
	"status.inactive": "Inaktiv",

	// Dates
	"date.today": "Heute",
	"date.yesterday": "Gestern",
	"date.tomorrow": "Morgen",
	"date.selectDate": "Datum auswählen",
	"date.selectTime": "Zeit auswählen",
	"date.clear": "Datum löschen",

	// Accessibility
	"a11y.openMenu": "Menü öffnen",
	"a11y.closeMenu": "Menü schließen",
	"a11y.expand": "Erweitern",
	"a11y.collapse": "Zusammenklappen",
	"a11y.loading": "Laden",
	"a11y.required": "Erforderlich",
	"a11y.optional": "Optional",
	"a11y.selected": "Ausgewählt",
	"a11y.notSelected": "Nicht ausgewählt",

	// Locale
	"locale.language": "Sprache",
	"locale.switchLanguage": "Sprache wechseln",
	"locale.contentLanguage": "Inhaltssprache",
	"locale.uiLanguage": "Oberflächensprache",

	// ===========================================
	// Default Collections
	// ===========================================

	// Users Collection
	"defaults.users.label": "Benutzer",
	"defaults.users.description": "Admin-Benutzer und deren Rollen verwalten",
	"defaults.users.fields.name.label": "Name",
	"defaults.users.fields.name.placeholder": "Benutzernamen eingeben",
	"defaults.users.fields.email.label": "E-Mail",
	"defaults.users.fields.email.description":
		"E-Mail-Adresse (schreibgeschützt)",
	"defaults.users.fields.role.label": "Rolle",
	"defaults.users.fields.role.options.admin": "Administrator",
	"defaults.users.fields.role.options.user": "Benutzer",
	"defaults.users.fields.emailVerified.label": "E-Mail verifiziert",
	"defaults.users.fields.emailVerified.description":
		"Ob der Benutzer seine E-Mail-Adresse verifiziert hat",
	"defaults.users.fields.banned.label": "Gesperrt",
	"defaults.users.fields.banned.description":
		"Benutzer den Zugriff auf das System verweigern",
	"defaults.users.fields.banReason.label": "Sperrgrund",
	"defaults.users.fields.banReason.placeholder":
		"Grund für die Sperre eingeben...",
	"defaults.users.sections.basicInfo": "Grundinformationen",
	"defaults.users.sections.permissions": "Berechtigungen",
	"defaults.users.sections.accessControl": "Zugriffskontrolle",
	"defaults.users.actions.createUser.label": "Benutzer erstellen",
	"defaults.users.actions.createUser.title": "Benutzer erstellen",
	"defaults.users.actions.createUser.description":
		"Neues Benutzerkonto mit Anmeldedaten erstellen.",
	"defaults.users.actions.createUser.fields.password.label": "Passwort",
	"defaults.users.actions.createUser.fields.password.placeholder":
		"Passwort eingeben",
	"defaults.users.actions.createUser.submit": "Benutzer erstellen",
	"defaults.users.actions.createUser.success":
		"Benutzer {{email}} erfolgreich erstellt. Teilen Sie die Anmeldedaten mit dem Benutzer.",
	"defaults.users.actions.createUser.errorNoAuth":
		"Auth-Client nicht konfiguriert. Benutzer kann nicht erstellt werden.",
	"defaults.users.actions.resetPassword.label": "Passwort zurücksetzen",
	"defaults.users.actions.resetPassword.title": "Passwort zurücksetzen",
	"defaults.users.actions.resetPassword.description":
		"Neues Passwort für diesen Benutzer festlegen.",
	"defaults.users.actions.resetPassword.fields.newPassword.label":
		"Neues Passwort",
	"defaults.users.actions.resetPassword.fields.newPassword.placeholder":
		"Neues Passwort eingeben",
	"defaults.users.actions.resetPassword.fields.confirmPassword.label":
		"Passwort bestätigen",
	"defaults.users.actions.resetPassword.fields.confirmPassword.placeholder":
		"Neues Passwort bestätigen",
	"defaults.users.actions.resetPassword.submit": "Passwort zurücksetzen",
	"defaults.users.actions.resetPassword.success":
		"Passwort erfolgreich zurückgesetzt!",
	"defaults.users.actions.resetPassword.errorMismatch":
		"Passwörter stimmen nicht überein",
	"defaults.users.actions.delete.label": "Benutzer löschen",

	// Assets Collection
	"defaults.assets.label": "Medien",
	"defaults.assets.description": "Hochgeladene Dateien und Bilder verwalten",
	"defaults.assets.fields.preview.label": "Vorschau",
	"defaults.assets.fields.filename.label": "Dateiname",
	"defaults.assets.fields.filename.description":
		"Originaler Dateiname der hochgeladenen Datei",
	"defaults.assets.fields.mimeType.label": "Typ",
	"defaults.assets.fields.mimeType.description": "MIME-Typ der Datei",
	"defaults.assets.fields.size.label": "Größe (Bytes)",
	"defaults.assets.fields.size.description": "Dateigröße in Bytes",
	"defaults.assets.fields.alt.label": "Alternativtext",
	"defaults.assets.fields.alt.placeholder":
		"Bild für Barrierefreiheit beschreiben",
	"defaults.assets.fields.alt.description": "Alternativtext für Screenreader",
	"defaults.assets.fields.caption.label": "Untertitel",
	"defaults.assets.fields.caption.placeholder": "Untertitel hinzufügen...",
	"defaults.assets.fields.visibility.label": "Sichtbarkeit",
	"defaults.assets.fields.visibility.options.public": "Öffentlich",
	"defaults.assets.fields.visibility.options.private": "Privat",
	"defaults.assets.fields.visibility.description":
		"Öffentliche Dateien sind ohne Authentifizierung zugänglich. Private Dateien erfordern eine signierte URL.",
	"defaults.assets.sections.fileInfo": "Dateiinformationen",
	"defaults.assets.sections.metadata": "Metadaten",
	"defaults.assets.sections.metadata.description":
		"Beschreibende Informationen für Barrierefreiheit und SEO hinzufügen",
	"defaults.assets.actions.upload.label": "Dateien hochladen",

	// Default Sidebar
	"defaults.sidebar.administration": "Administration",

	// View Options (Filter Builder)
	"viewOptions.title": "Ansichtsoptionen",
	"viewOptions.columns": "Spalten",
	"viewOptions.filters": "Filter",
	"viewOptions.savedViews": "Gespeicherte Ansichten",
	"viewOptions.apply": "Anwenden",
	"viewOptions.reset": "Zurücksetzen",

	// Saved Views Tab
	"viewOptions.saveCurrentConfig": "Aktuelle Konfiguration speichern",
	"viewOptions.viewNamePlaceholder": "Ansichtsname...",
	"viewOptions.saveDescription":
		"Speichert aktuelle Spalten, Filter und Sortierung.",
	"viewOptions.noChangesToSave":
		"Keine Filter oder Spaltenänderungen zum Speichern.",
	"viewOptions.noSavedViews": "Noch keine gespeicherten Ansichten.",
	"viewOptions.filtersCount": {
		one: "{{count}} Filter",
		other: "{{count}} Filter",
	},
	"viewOptions.columnsCount": {
		one: "{{count}} Spalte",
		other: "{{count}} Spalten",
	},
	"viewOptions.defaultView": "Standard",

	// Columns Tab
	"viewOptions.columnsDragHint":
		"Ziehen zum Neuanordnen, umschalten zum Ein-/Ausblenden von Spalten.",
	"viewOptions.noFieldsAvailable": "Keine Felder verfügbar.",

	// Filters Tab
	"viewOptions.filtersDescription":
		"Ergebnisse mit benutzerdefinierten Regeln eingrenzen.",
	"viewOptions.filterNumber": "Filter #{{number}}",
	"viewOptions.selectField": "Feld auswählen",
	"viewOptions.selectOperator": "Operator auswählen",
	"viewOptions.valuePlaceholder": "Wert...",
	"viewOptions.noActiveFilters": "Keine aktiven Filter.",
	"viewOptions.addFilter": "Filter hinzufügen",
	"viewOptions.clearAll": "Alle löschen",
	"viewOptions.activeFilters": {
		one: "{{count}} aktiver Filter",
		other: "{{count}} aktive Filter",
	},
	"viewOptions.clearFilters": "Filter löschen",

	// Filter Operators
	"filter.contains": "Enthält",
	"filter.notContains": "Enthält nicht",
	"filter.equals": "Gleich",
	"filter.notEquals": "Ungleich",
	"filter.startsWith": "Beginnt mit",
	"filter.endsWith": "Endet mit",
	"filter.greaterThan": "Größer als",
	"filter.greaterThanOrEqual": "Größer oder gleich",
	"filter.lessThan": "Kleiner als",
	"filter.lessThanOrEqual": "Kleiner oder gleich",
	"filter.in": "Ist eines von",
	"filter.notIn": "Ist keines von",
	"filter.some": "Hat irgendeines",
	"filter.every": "Hat alle",
	"filter.none": "Hat keines",
	"filter.isEmpty": "Ist leer",
	"filter.isNotEmpty": "Ist nicht leer",

	// Preview
	"preview.show": "Vorschau",
	"preview.hide": "Vorschau ausblenden",
	"preview.title": "Vorschau",
	"preview.livePreview": "Live-Vorschau",
	"preview.fullscreen": "Vollbild",
	"preview.close": "Vorschau schließen",
	"preview.loading": "Vorschau wird geladen...",

	// Autosave
	"autosave.saving": "Wird gespeichert...",
	"autosave.saved": "Gespeichert",
	"autosave.unsavedChanges": "Ungespeicherte Änderungen",
	"autosave.justNow": "gerade eben",
	"autosave.secondsAgo": { one: "vor {{count}}s", other: "vor {{count}}s" },
	"autosave.minutesAgo": { one: "vor {{count}}m", other: "vor {{count}}m" },
	"autosave.hoursAgo": { one: "vor {{count}}h", other: "vor {{count}}h" },

	// Global Search
	"globalSearch.placeholder":
		"Sammlungen, Globals, Aktionen, Datensätze durchsuchen...",
	"globalSearch.collections": "Sammlungen",
	"globalSearch.globals": "Globals",
	"globalSearch.quickActions": "Schnellaktionen",
	"globalSearch.records": "Datensätze",
	"globalSearch.createNew": "Neues {{name}} erstellen",
	"globalSearch.noResults": "Keine Ergebnisse gefunden",
	"globalSearch.searching": "Suche läuft...",
	"globalSearch.navigate": "zur Navigation",
	"globalSearch.select": "zur Auswahl",

	// Collection Search
	"collectionSearch.placeholder": "Datensätze durchsuchen...",
	"collectionSearch.noResults": "Keine passenden Datensätze gefunden",
	"collectionSearch.searching": "Suche läuft...",
} as const;
