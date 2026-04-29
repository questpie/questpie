/**
 * German Admin UI Messages
 */
export default {
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
	// Actions
	"action.collectionNotFound": 'Sammlung "{{collection}}" nicht gefunden',
	"action.notFound":
		'Aktion "{{action}}" wurde in Sammlung "{{collection}}" nicht gefunden',
	"action.executionFailed": "Ausführung der Aktion fehlgeschlagen",
	"action.itemCreated": "Element erfolgreich erstellt",
	"action.itemIdRequired.save":
		"Element-ID ist für die Speichern-Aktion erforderlich",
	"action.itemSaved": "Element erfolgreich gespeichert",
	"action.itemIdRequired.delete":
		"Element-ID ist für die Löschen-Aktion erforderlich",
	"action.itemDeleted": "Element erfolgreich gelöscht",
	"action.itemIdsRequired.bulkDelete":
		"Element-IDs sind für die Massenlöschung erforderlich",
	"action.itemsDeleted": {
		one: "{{count}} Element erfolgreich gelöscht",
		other: "{{count}} Elemente erfolgreich gelöscht",
	},
	"action.itemIdRequired.restore":
		"Element-ID ist für die Wiederherstellen-Aktion erforderlich",
	"action.restoreUnsupported":
		"Wiederherstellen wird für diese Sammlung nicht unterstützt",
	"action.itemRestored": "Element erfolgreich wiederhergestellt",
	"action.itemIdsRequired.bulkRestore":
		"Element-IDs sind für die Massenwiederherstellung erforderlich",
	"action.itemsRestored": {
		one: "{{count}} Element erfolgreich wiederhergestellt",
		other: "{{count}} Elemente erfolgreich wiederhergestellt",
	},
	"action.itemIdRequired.duplicate":
		"Element-ID ist für die Duplizieren-Aktion erforderlich",
	"action.itemNotFound": "Element nicht gefunden",
	"action.itemDuplicated": "Element erfolgreich dupliziert",
	"action.itemIdRequired.transition":
		"Element-ID ist für die Übergangsaktion erforderlich",
	"action.targetStageRequired":
		"Zielstatus ist für die Übergangsaktion erforderlich",
	"action.workflowUnsupported":
		"Workflow-Übergänge werden für diese Sammlung nicht unterstützt",
	"action.unknownBuiltin": "Unbekannte integrierte Aktion: {{action}}",
	"action.fieldRequired": 'Feld "{{field}}" ist erforderlich',

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
	"auth.setupAlreadyCompleted":
		"Einrichtung bereits abgeschlossen - Admin-Benutzer existieren im System",
	"auth.failedToCreateUserAccount":
		"Benutzerkonto konnte nicht erstellt werden",

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
	"editor.richTextToolbar": "Rich-Text-Werkzeugleiste",
	"editor.blockType": "Blocktyp",
	"editor.selectionBlockType": "Blocktyp der Auswahl",
	"editor.paragraph": "Absatz",
	"editor.textBlocks": "Textblöcke",
	"editor.headings": "Überschriften",
	"editor.blocks": "Blöcke",
	"editor.formatting": "Formatierung",
	"editor.moreFormatting": "Weitere Formatierung",
	"editor.alignment": "Ausrichtung",
	"editor.insert": "Einfügen",
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
	"editor.startWriting": "Mit dem Schreiben beginnen...",
	"editor.pasteOrTypeLink": "Link einfügen oder eingeben...",
	"editor.paragraphDescription": "Mit normalem Text beginnen",
	"editor.heading1Description": "Große Abschnittsüberschrift",
	"editor.heading2Description": "Mittlere Abschnittsüberschrift",
	"editor.heading3Description": "Kleine Abschnittsüberschrift",
	"editor.bulletListDescription": "Aufzählungsliste erstellen",
	"editor.orderedListDescription": "Nummerierte Liste erstellen",
	"editor.quoteDescription": "Zitat einfügen",
	"editor.codeBlockDescription": "Codebeispiel einfügen",
	"editor.dividerDescription": "Horizontale Linie einfügen",
	"editor.tableDescription": "3x3-Tabelle einfügen",

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
	"preview.pathRequired": "Pfad ist erforderlich",
	"preview.collectionNameRequired": "Sammlungsname ist erforderlich",
	"preview.adminSessionRequired": "Admin-Sitzung erforderlich",
	"preview.invalidTokenFormat": "Ungültiges Token-Format",
	"preview.invalidSignature": "Ungültige Signatur",
	"preview.invalidPayload": "Ungültige Nutzdaten",
	"preview.tokenExpired": "Token abgelaufen",
	"preview.invalidPath": "Ungültiger Pfad",
	"preview.collectionNotFound": 'Sammlung "{{collection}}" nicht gefunden',
	"preview.noUrlConfigured":
		"Für diese Sammlung ist keine Vorschau-URL konfiguriert",
	"preview.disabledForCollection":
		"Vorschau ist für diese Sammlung deaktiviert",
	"preview.generateUrlFailed":
		"Vorschau-URL konnte nicht generiert werden: {{message}}",

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

	// Audit
	"audit.section.activity": "Aktivität",

	// English parity additions
	"common.moreActions": "Weitere Aktionen",
	"common.backToList": "Zurück zur Liste",
	"common.deleted": "Gelöscht",
	"common.done": "Fertig",
	"common.noValue": "Kein Wert",
	"nav.breadcrumb": "Breadcrumb",
	"nav.adminNavigation": "Admin-Navigation",

	"dashboard.noWidgets": "Keine Widgets konfiguriert",
	"dashboard.noWidgetsDescription":
		"Fügen Sie Widgets zu Ihrer Dashboard-Konfiguration hinzu, um hier Daten anzuzeigen.",
	"dashboard.systemStatus": "Systemstatus",
	"dashboard.welcomeDescription":
		"Wählen Sie eine Sammlung aus der Seitenleiste, um Ihre Inhalte zu verwalten.",

	"collection.restoring": "Wird wiederhergestellt...",
	"collection.restoreSuccess": "Element erfolgreich wiederhergestellt",
	"collection.restoreError": "Element konnte nicht wiederhergestellt werden",
	"collection.bulkRestoreSuccess": {
		one: "{{count}} Element erfolgreich wiederhergestellt",
		other: "{{count}} Elemente erfolgreich wiederhergestellt",
	},
	"collection.bulkRestoreError":
		"Elemente konnten nicht wiederhergestellt werden",
	"collection.bulkRestorePartial": {
		one: "{{success}} Element wiederhergestellt, {{failed}} fehlgeschlagen",
		other: "{{success}} Elemente wiederhergestellt, {{failed}} fehlgeschlagen",
	},
	"collection.orderSaved": "Reihenfolge gespeichert",
	"collection.orderSaveFailed": "Reihenfolge konnte nicht gespeichert werden",
	"collection.reorderMode": "Sortiermodus",
	"collection.sortedByField": "Sortiert nach {{field}} {{direction}}.",
	"collection.reorderEnableOrderable":
		"Sortierbarkeit vor dem Neuanordnen aktivieren",
	"collection.reorderAddOrderField":
		"Vor dem Neuanordnen ein numerisches Reihenfolge-Feld hinzufügen",
	"collection.reorderClearSearch": "Suche löschen, um neu anzuordnen",
	"collection.reorderRemoveGrouping":
		"Gruppierung entfernen, um neu anzuordnen",
	"collection.reorderClearFilters": "Filter löschen, um neu anzuordnen",
	"collection.reorderShowOnePage":
		"Eine Seite mit Elementen anzeigen, um neu anzuordnen",
	"collection.reorderExitMode": "Sortiermodus verlassen",
	"collection.reorderItems": "Elemente neu anordnen",
	"collection.reorderSwitchSort":
		"Zur Sortierung nach {{field}} wechseln und neu anordnen",
	"collection.reorderUnavailable": "Neuanordnen nicht verfügbar: {{reason}}",
	"collection.reorderEnterMode": "Sortiermodus starten",

	"blocks.add": "Block hinzufügen",
	"blocks.addTo": "Zu {{parent}} hinzufügen",
	"blocks.addFirst": "Fügen Sie Ihren ersten Block hinzu, um zu beginnen",
	"blocks.unknownType":
		'Unbekannter Blocktyp "{{type}}". Dieser Blocktyp ist nicht registriert.',
	"blocks.searchPlaceholder": "Blöcke suchen...",
	"blocks.uncategorized": "Sonstige",
	"blocks.noEditableFields": "Dieser Block hat keine bearbeitbaren Felder.",
	"blocks.noDefinitions": "Keine Blockdefinitionen registriert",
	"blocks.noDefinitionsHint":
		"Registrieren Sie Blöcke mit .blocks() in Ihrer Admin-Konfiguration",
	"blocks.emptyTitle": "Noch keine Blöcke",
	"blocks.libraryDescription": "Wählen Sie einen Blocktyp zum Hinzufügen aus.",
	"blocks.noSearchResults": "Keine Blöcke entsprechen Ihrer Suche",
	"blocks.tryDifferentSearch": "Versuchen Sie einen anderen Suchbegriff.",

	"form.deletedBanner":
		"Dieser Datensatz wurde am {{date}} gelöscht. Verwenden Sie die Wiederherstellen-Aktion, um ihn wieder zu aktivieren.",
	"form.lastUpdated": "Zuletzt aktualisiert",

	"auth.forgotPasswordTitle": "Passwort vergessen",
	"auth.forgotPasswordDescription":
		"Geben Sie Ihre E-Mail-Adresse ein, um einen Link zum Zurücksetzen des Passworts zu erhalten",
	"auth.checkYourEmail": "Überprüfen Sie Ihre E-Mail",
	"auth.resetLinkSentDescription":
		"Wir haben Ihnen einen Link zum Zurücksetzen des Passworts gesendet. Prüfen Sie Ihren Posteingang und folgen Sie den Anweisungen.",
	"auth.backToLogin": "Zurück zur Anmeldung",
	"auth.forgotPasswordFormDescription":
		"Geben Sie Ihre E-Mail-Adresse ein und wir senden Ihnen einen Link zum Zurücksetzen Ihres Passworts.",
	"auth.rememberYourPassword": "Erinnern Sie sich an Ihr Passwort?",
	"auth.resetPasswordSuccess": "Passwort erfolgreich zurückgesetzt",
	"auth.resetPasswordSuccessDescription":
		"Ihr Passwort wurde erfolgreich zurückgesetzt. Sie können sich jetzt mit Ihrem neuen Passwort anmelden.",
	"auth.enterNewPassword": "Geben Sie unten Ihr neues Passwort ein.",
	"auth.createAccountDescription": "Erstellen Sie Ihr Konto, um zu beginnen",
	"auth.inviteEmailLabel": "E-Mail-Adresse",
	"auth.inviteEmailDescription":
		"Ein Einladungslink wird an diese E-Mail gesendet",
	"auth.inviteRole": "Rolle",
	"auth.inviteSelectRole": "Rolle auswählen",
	"auth.inviteRoleDescription":
		"Die Rolle bestimmt, welche Berechtigungen der Benutzer hat",
	"auth.inviteMessage": "Persönliche Nachricht (optional)",
	"auth.inviteMessagePlaceholder":
		"Fügen Sie der Einladung eine persönliche Nachricht hinzu...",
	"auth.inviteMessageDescription":
		"Diese Nachricht wird in der Einladungs-E-Mail enthalten sein",
	"auth.sendingInvitation": "Einladung wird gesendet...",
	"auth.sendInvitation": "Einladung senden",
	"auth.inviteSentSuccess": "Einladung erfolgreich gesendet",
	"auth.signInDescription":
		"Geben Sie Ihre Anmeldedaten ein, um auf den Admin-Bereich zuzugreifen",
	"auth.inviteUser": "Benutzer einladen",
	"auth.inviteUserDescription":
		"Senden Sie eine Einladung, um einen neuen Benutzer hinzuzufügen",
	"auth.inviteSentTo": "Einladung an {{email}} gesendet",
	"auth.completeRegistration": "Registrierung abschließen",
	"auth.validatingInvitation": "Einladung wird geprüft",
	"auth.pleaseWait": "Bitte warten...",
	"auth.invalidInvitation": "Ungültige Einladung",
	"auth.invalidInvitationDescription":
		"Dieser Einladungslink ist nicht mehr gültig",
	"auth.invalidOrExpiredInvitation": "Ungültige oder abgelaufene Einladung",
	"auth.invitationExpiredMessage":
		"Die Einladung ist möglicherweise abgelaufen oder wurde bereits verwendet. Bitte wenden Sie sich für eine neue Einladung an Ihren Administrator.",
	"auth.goToLogin": "Zur Anmeldung",
	"auth.invalidLink": "Ungültiger Link",
	"auth.invalidLinkDescription":
		"Der Link zum Zurücksetzen des Passworts ist ungültig oder abgelaufen.",
	"auth.requestNewResetLink":
		"Bitte fordern Sie einen neuen Link zum Zurücksetzen des Passworts an.",
	"auth.user": "Benutzer",

	"error.somethingWentWrong": "Etwas ist schiefgelaufen",
	"error.unexpectedError": "Ein unerwarteter Fehler ist aufgetreten",
	"error.failedToLoad": "Laden fehlgeschlagen",
	"error.failedToLoadView": "{{viewType}} konnte nicht geladen werden",
	"error.failedToLoadViewFor":
		"{{viewType}} für {{collection}} konnte nicht geladen werden",
	"error.widgetError": "Widget-Fehler",
	"error.unknownWidget": "Unbekanntes Widget",
	"error.widgetTypeNotRecognized": 'Widget-Typ "{{type}}" wird nicht erkannt.',
	"error.componentNotFound": "Komponente nicht gefunden",
	"error.failedToLoadComponent": "Komponente konnte nicht geladen werden",
	"error.pageNotFound": "Seite nicht gefunden",
	"error.pageNotFoundDescription": "Die gesuchte Seite existiert nicht.",
	"error.accessRestricted": "Zugriff eingeschränkt",
	"error.accessRestrictedDescription":
		"Sie haben keine Berechtigung, auf diese Seite zuzugreifen. Wenden Sie sich an Ihren Administrator, wenn Sie dies für einen Fehler halten.",
	"error.accessRestrictedResourceDescription":
		'{{type}} "{{name}}" ist im Admin-Bereich nicht verfügbar. Es ist möglicherweise ausgeblendet oder Sie haben keine Berechtigung, darauf zuzugreifen.',
	"error.tryAgain": "Erneut versuchen",
	"error.backToDashboard": "Zurück zum Dashboard",
	"error.noUploadCollection": "Keine Upload-Sammlung ist konfiguriert.",
	"error.multipleUploadCollections":
		"Mehrere Upload-Sammlungen sind verfügbar ({{collections}}). Geben Sie an, welche Sammlung verwendet werden soll.",
	"error.autosaveFailed": "Automatisches Speichern fehlgeschlagen",
	"error.actionFailed": "Aktion fehlgeschlagen",
	"error.serverActionFailed": "Serveraktion fehlgeschlagen",
	"error.failedToLoadOptions": "Optionen konnten nicht geladen werden",
	"error.failedToLoadAssets": "Medien konnten nicht geladen werden",
	"error.failedToLoadSelectedItems":
		"Ausgewählte Elemente konnten nicht geladen werden",
	"error.invalidCredentials": "Ungültige Anmeldedaten",
	"error.failedToSendResetEmail":
		"E-Mail zum Zurücksetzen konnte nicht gesendet werden",
	"error.failedToResetPassword": "Passwort konnte nicht zurückgesetzt werden",
	"error.failedToCreateAccount": "Konto konnte nicht erstellt werden",
	"error.failedToCreateAdminAccount":
		"Administratorkonto konnte nicht erstellt werden",
	"error.failedToSendInvitation": "Einladung konnte nicht gesendet werden",
	"error.anErrorOccurred": "Ein Fehler ist aufgetreten",
	"error.uploadFailed": "Upload fehlgeschlagen",
	"error.failedToGeneratePreviewToken":
		"Vorschau-Token konnte nicht generiert werden",
	"error.missingFieldComponent":
		"Keine Komponente für Feldtyp registriert: {{type}}",
	"error.selectAtLeastOne": "Bitte wählen Sie mindestens ein Medium aus",
	"error.maxItemsAllowed": "Maximal {{max}} Elemente erlaubt",
	"error.unregisteredViewDescription":
		'Ansicht "{{viewId}}" ist nicht in der Admin-Ansichtsregistrierung registriert.',

	"table.show": "Anzeigen",
	"table.noItemsInCollection": "Keine Elemente in dieser Sammlung gefunden",
	"table.emptyDescription":
		"Datensätze erscheinen hier, sobald sie erstellt wurden.",
	"table.pagination": "Seitennavigation",
	"table.editing": "Bearbeitung",

	"upload.bulkTitle": "Dateien hochladen",
	"upload.bulkDescription":
		"Mehrere Dateien zu Ihrer Medienbibliothek hinzufügen",
	"upload.bulkHint": "Mehrere Dateien auf einmal hochladen",
	"upload.bulkSuccess": {
		one: "{{count}} Datei erfolgreich hochgeladen",
		other: "{{count}} Dateien erfolgreich hochgeladen",
	},
	"upload.bulkError": {
		one: "{{count}} Datei konnte nicht hochgeladen werden",
		other: "{{count}} Dateien konnten nicht hochgeladen werden",
	},
	"upload.waitForComplete":
		"Bitte warten Sie, bis die Uploads abgeschlossen sind",
	"upload.filesCount": {
		one: "{{count}} Datei",
		other: "{{count}} Dateien",
	},
	"upload.uploadedCount": {
		one: "{{count}} hochgeladen",
		other: "{{count}} hochgeladen",
	},
	"upload.failedCount": {
		one: "{{count}} fehlgeschlagen",
		other: "{{count}} fehlgeschlagen",
	},
	"upload.browseLibrary": "Bibliothek durchsuchen",

	"confirm.deleteSelected": "Ausgewählte löschen",
	"confirm.deleteSelectedTitle": "Ausgewählte Elemente löschen?",
	"confirm.deleteSelectedDescription":
		"Diese Aktion kann nicht rückgängig gemacht werden. Alle ausgewählten Elemente werden dauerhaft gelöscht.",
	"confirm.deleteAll": "Alle löschen",
	"confirm.restoreTitle": "Element wiederherstellen?",
	"confirm.restoreDescription":
		"Dieses Element wird wieder in normalen Listenansichten sichtbar.",
	"confirm.restore": "Wiederherstellen",
	"confirm.deleteItemTitle": "Element löschen?",
	"confirm.deleteItemDescription":
		"Diese Aktion kann nicht rückgängig gemacht werden. Das Element wird dauerhaft gelöscht.",

	"input.selectDate": "Datum auswählen",
	"input.selectDateTime": "Datum und Uhrzeit auswählen",
	"input.selectDateRange": "Datumsbereich auswählen",
	"input.selectTime": "Zeit auswählen",

	"defaults.users.tabs.profile": "Profil",
	"defaults.users.tabs.security": "Sicherheit",
	"defaults.assets.sections.dimensions": "Abmessungen",

	"viewOptions.realtime": "Echtzeitaktualisierungen",
	"viewOptions.realtimeDescription":
		"Diese Tabelle automatisch aktualisieren, wenn sich Daten ändern.",
	"viewOptions.showDeleted": "Gelöschte anzeigen",
	"viewOptions.showDeletedDescription":
		"Soft-gelöschte Datensätze in diese Ansicht einschließen.",
	"viewOptions.groupBy": "Gruppieren nach",
	"viewOptions.groupByDescription":
		"Die aktuelle Seite nach einem konfigurierten Feld gruppieren.",
	"viewOptions.noGrouping": "Keine Gruppierung",
	"viewOptions.sort": "Sortierung",

	"version.history": "Versionsverlauf",
	"version.historyDescription":
		"Durchsuchen Sie frühere Versionen und stellen Sie bei Bedarf eine wieder her.",
	"version.globalHistoryDescription":
		"Durchsuchen Sie frühere globale Versionen und stellen Sie bei Bedarf eine wieder her.",
	"version.empty": "Keine Versionen gefunden.",
	"version.label": "Version {{number}}",
	"version.createdAt": "Erstellt",
	"version.user": "Benutzer",
	"version.revert": "Zurücksetzen",
	"version.revertSuccess": "Version erfolgreich wiederhergestellt",
	"version.operationCreate": "Erstellt",
	"version.operationUpdate": "Aktualisiert",
	"version.operationDelete": "Gelöscht",
	"version.operationUnknown": "Geändert",
	"version.revertConfirmTitle": "Zu dieser Version zurückkehren?",
	"version.revertConfirmDescription":
		"Dies ersetzt den aktuellen Inhalt durch Version {{number}}.",

	"viewOptions.noResultsDescription":
		"Keine Datensätze entsprechen den aktiven Filtern. Passen Sie sie an oder löschen Sie sie, um mehr Ergebnisse zu sehen.",

	"preview.exitPreview": "Vorschau verlassen",
	"preview.exitTooltip": "Vorschaumodus verlassen und Entwurfs-Cookie löschen",
	"preview.loadingPreview": "Vorschau wird geladen...",
	"preview.previewError": "Vorschaufehler",
	"preview.refreshing": "Wird aktualisiert...",
	"preview.showPreview": "Vorschau anzeigen",
	"preview.hidePreview": "Vorschau ausblenden",
	"preview.mode": "Vorschaumodus",

	"collectionSearch.noResultsDescription":
		"Versuchen Sie einen anderen Suchbegriff oder löschen Sie die Suche, um zur vollständigen Liste zurückzukehren.",

	"audit.collection.label": "Audit-Protokoll",
	"audit.collection.description":
		"Alle aufgezeichneten Änderungen und Benutzeraktivitäten durchsuchen",
	"audit.sections.event": "Ereignisdetails",
	"audit.sections.user": "Benutzer",
	"audit.sections.changes": "Änderungen",
	"audit.widget.recentActivity.title": "Letzte Aktivität",
	"audit.widget.recentActivity.empty":
		"Keine aktuelle Aktivität aufgezeichnet.",

	"history.title": "Verlauf",
	"history.description": "Änderungen und Aktivität für diesen Datensatz",
	"history.versionDescription":
		"Versions-Snapshots durchsuchen und Unterschiede auf Feldebene prüfen.",
	"history.tabActivity": "Aktivität",
	"history.tabVersions": "Versionen",
	"history.empty": "Keine Aktivität aufgezeichnet",
	"history.showChanges": {
		one: "Änderung anzeigen ({{count}})",
		other: "Änderungen anzeigen ({{count}})",
	},
	"history.hideChanges": "Änderungen ausblenden",
	"history.changedFields": {
		one: "{{count}} geändertes Feld",
		other: "{{count}} geänderte Felder",
	},
	"history.moreFields": {
		one: "{{count}} weiteres",
		other: "{{count}} weitere",
	},
	"history.changeAdded": "Hinzugefügt",
	"history.changeRemoved": "Entfernt",
	"history.changeChanged": "Geändert",
	"history.diffAgainstVersion": "Diff gegen Version {{number}}",
	"history.initialSnapshot": "Initialer Snapshot",
	"history.noFieldChanges":
		"Keine Änderungen auf Feldebene in diesem Snapshot.",
	"history.before": "Vorher",
	"history.after": "Nachher",
	"history.stage": "Phase",
	"history.systemUser": "System",
	"history.itemsCount": {
		one: "{{count}} Element",
		other: "{{count}} Elemente",
	},
	"history.blocksCount": {
		one: "{{count}} Block",
		other: "{{count}} Blöcke",
	},
	"history.objectWithKeys": {
		one: "Objekt mit {{count}} Schlüssel",
		other: "Objekt mit {{count}} Schlüsseln",
	},

	"workflow.transition": "Übergang",
	"workflow.currentStage": "Aktuelle Phase",
	"workflow.transitionTo": "Zu {{stage}} wechseln",
	"workflow.transitionDescription": 'Dies wechselt von "{{from}}" zu "{{to}}".',
	"workflow.scheduleLabel": "Für später planen",
	"workflow.scheduledAt": "Geplantes Datum und Uhrzeit",
	"workflow.scheduledDescription":
		"Der Übergang erfolgt automatisch zum geplanten Zeitpunkt.",
	"workflow.transitionSuccess": 'Erfolgreich zu "{{stage}}" gewechselt',
	"workflow.scheduledSuccess": 'Übergang zu "{{stage}}" für {{date}} geplant',
	"workflow.transitionFailed": "Übergang fehlgeschlagen",
	"workflow.noTransitions": "Keine Übergänge aus dieser Phase verfügbar",

	"lock.blockedTitle": "{{name}} bearbeitet gerade",
	"lock.blockedDescription":
		"Dieses Dokument ist gesperrt. Sie können es anzeigen, aber keine Änderungen vornehmen, bis die Sperre abläuft.",
	"lock.openElsewhere":
		"Sie haben dieses Dokument in einem anderen Tab geöffnet. Änderungen werden automatisch synchronisiert.",
	"lock.cannotSave":
		"Speichern nicht möglich - Dokument ist von einem anderen Benutzer gesperrt",

	"ui.toggleSidebar": "Seitenleiste umschalten",
	"ui.expandSidebar": "Seitenleiste erweitern",
	"ui.skipToMainContent": "Zum Hauptinhalt springen",
	"ui.processing": "Wird verarbeitet...",
	"ui.commandPalette": "Befehlspalette",
	"ui.commandPaletteDescription": "Nach einem auszuführenden Befehl suchen...",
	"ui.searchPlaceholder": "Suchen...",
	"ui.expand": "Erweitern",
	"ui.toggleTheme": "Design umschalten",
	"ui.themeLight": "Hell",
	"ui.themeDark": "Dunkel",
	"ui.themeSystem": "System",

	"dropzone.label": "Dateien hier ablegen oder zum Durchsuchen klicken",
	"dropzone.invalidType": '"{{name}}" ist kein zulässiger Dateityp',
	"dropzone.tooLarge":
		'"{{name}}" überschreitet die maximale Größe von {{maxSize}}',
	"dropzone.uploading": "Wird hochgeladen...",
	"dropzone.typeImages": "Bilder",
	"dropzone.typeVideos": "Videos",
	"dropzone.typeAudio": "Audio",
	"dropzone.typePDF": "PDF",

	"media.browseLibrary": "Medienbibliothek durchsuchen",
	"media.allFiles": "Alle Dateien",
	"media.images": "Bilder",
	"media.videos": "Videos",
	"media.audio": "Audio",
	"media.documents": "Dokumente",
	"media.searchPlaceholder": "Nach Dateiname suchen...",
	"media.noAssets": "Keine Medien gefunden",

	"field.moveUp": "Nach oben verschieben",
	"field.moveDown": "Nach unten verschieben",
	"field.dragToReorder": "Ziehen zum Neuanordnen",
	"field.editItem": "Element bearbeiten",
	"field.removeItem": "Element entfernen",
	"field.noItems": "Keine Elemente",
	"field.codeEditor": "Code-Editor",
	"field.formEditor": "Formular-Editor",
	"field.section": "Abschnitt",

	"cell.file": {
		one: "{{count}} Datei",
		other: "{{count}} Dateien",
	},
	"cell.item": {
		one: "{{count}} Element",
		other: "{{count}} Elemente",
	},
	"cell.more": "+{{count}} weitere",
	"cell.blocks": "Blöcke",

	"widget.quickActions.emptyTitle": "Keine Schnellaktionen",
	"widget.quickActions.emptyDescription":
		"Schnellaktionen erscheinen hier, sobald sie konfiguriert sind.",
	"widget.chart.emptyTitle": "Keine Diagrammdaten",
	"widget.chart.emptyDescription":
		"Diagrammdaten erscheinen hier, sobald sie verfügbar sind.",
	"widget.recentItems.emptyTitle": "Keine aktuellen Elemente",
	"widget.recentItems.emptyDescription":
		"Aktuelle Elemente erscheinen hier, sobald Datensätze erstellt wurden.",
	"widget.value.emptyTitle": "Kein Wert zum Anzeigen",
	"widget.value.emptyDescription":
		"Dieser Wert erscheint, sobald Daten verfügbar sind.",
	"widget.progress.emptyTitle": "Keine Fortschrittsdaten",
	"widget.progress.emptyDescription":
		"Der Fortschritt erscheint hier, sobald Daten verfügbar sind.",
	"widget.timeline.emptyTitle": "Noch keine Aktivität",
	"widget.timeline.emptyDescription": "Es gibt keine Ereignisse zum Anzeigen.",
	"widget.table.emptyTitle": "Keine Zeilen zum Anzeigen",
	"widget.table.emptyDescription":
		"Für die aktuellen Kriterien gibt es keine Datensätze.",

	"time.justNow": "gerade eben",
	"time.minutesAgoShort": {
		one: "vor {{count}}m",
		other: "vor {{count}}m",
	},
	"time.hoursAgoShort": {
		one: "vor {{count}}h",
		other: "vor {{count}}h",
	},
	"time.daysAgoShort": {
		one: "vor {{count}}d",
		other: "vor {{count}}d",
	},
} as const;
