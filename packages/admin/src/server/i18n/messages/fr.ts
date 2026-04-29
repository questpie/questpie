/**
 * French Admin UI Messages
 */
export default {
	// Common
	"common.save": "Enregistrer",
	"common.cancel": "Annuler",
	"common.delete": "Supprimer",
	"common.edit": "Modifier",
	"common.create": "Créer",
	"common.add": "Ajouter",
	"common.remove": "Supprimer",
	"common.close": "Fermer",
	"common.form": "Formulaire",
	"common.search": "Rechercher",
	"common.filter": "Filtrer",
	"common.refresh": "Actualiser",
	"common.loading": "Chargement...",
	"common.confirm": "Confirmer",
	"common.back": "Retour",
	"common.next": "Suivant",
	"common.previous": "Précédent",
	"common.actions": "Actions",
	"common.more": "Plus",
	"common.yes": "Oui",
	"common.no": "Non",
	"common.ok": "OK",
	"common.apply": "Appliquer",
	"common.reset": "Réinitialiser",
	"common.clear": "Effacer",
	"common.selectAll": "Tout sélectionner",
	"common.deselectAll": "Tout désélectionner",
	"common.duplicate": "Dupliquer",
	"common.copy": "Copier",
	"common.paste": "Coller",
	"common.upload": "Téléverser",
	"common.download": "Télécharger",
	"common.preview": "Aperçu",
	"common.view": "Voir",
	"common.open": "Ouvrir",
	"common.retry": "Réessayer",
	"common.submit": "Soumettre",

	// Navigation
	"nav.dashboard": "Tableau de bord",
	"nav.collections": "Collections",
	"nav.globals": "Globales",
	"nav.media": "Médias",
	"nav.settings": "Paramètres",
	"nav.logout": "Se déconnecter",
	"nav.home": "Accueil",
	"nav.back": "Retour",

	// Dashboard
	"dashboard.title": "Tableau de bord",
	"dashboard.welcome": "Bon retour",
	"dashboard.recentActivity": "Activité récente",
	"dashboard.quickActions": "Actions rapides",

	// Collections
	"collection.create": "Créer {{name}}",
	"collection.edit": "Modifier {{name}}",
	"collection.delete": "Supprimer {{name}}",
	"collection.deleteConfirm": "Êtes-vous sûr de vouloir supprimer {{name}} ?",
	"collection.noItems": "Aucun {{name}} trouvé",
	"collection.createFirst": "Créez votre premier {{name}}",
	"collection.itemCount": {
		one: "{{count}} élément",
		other: "{{count}} éléments",
	},
	"collection.bulkDelete": "Supprimer la sélection",
	"collection.bulkDeleteConfirm":
		"Êtes-vous sûr de vouloir supprimer {{count}} éléments ?",
	"collection.bulkDeleteSuccess": {
		one: "{{count}} élément supprimé avec succès",
		other: "{{count}} éléments supprimés avec succès",
	},
	"collection.bulkDeleteError": "Échec de la suppression des éléments",
	"collection.bulkDeletePartial": {
		one: "{{success}} élément supprimé, {{failed}} échec",
		other: "{{success}} éléments supprimés, {{failed}} échecs",
	},
	"collection.bulkActionFailed": "Action groupée échouée",
	"collection.selected": "{{count}} sélectionné(s)",
	"collection.selectOnPage": "Tous sur cette page",
	"collection.selectAllMatching": "Tous correspondant ({{count}})",
	"collection.clearSelection": "Effacer la sélection",
	"collection.list": "Liste {{name}}",
	"collection.new": "Nouveau {{name}}",
	"collection.duplicateSuccess": "{{name}} dupliqué avec succès",
	"collection.duplicateError": "Échec de la duplication de {{name}}",
	// Actions
	"action.collectionNotFound": 'Collection "{{collection}}" introuvable',
	"action.notFound":
		'Action "{{action}}" introuvable sur la collection "{{collection}}"',
	"action.executionFailed": "L'exécution de l'action a échoué",
	"action.itemCreated": "Élément créé avec succès",
	"action.itemIdRequired.save":
		"L'ID de l'élément est requis pour l'action d'enregistrement",
	"action.itemSaved": "Élément enregistré avec succès",
	"action.itemIdRequired.delete":
		"L'ID de l'élément est requis pour l'action de suppression",
	"action.itemDeleted": "Élément supprimé avec succès",
	"action.itemIdsRequired.bulkDelete":
		"Les IDs des éléments sont requis pour la suppression groupée",
	"action.itemsDeleted": {
		one: "{{count}} élément supprimé avec succès",
		other: "{{count}} éléments supprimés avec succès",
	},
	"action.itemIdRequired.restore":
		"L'ID de l'élément est requis pour l'action de restauration",
	"action.restoreUnsupported":
		"La restauration n'est pas prise en charge pour cette collection",
	"action.itemRestored": "Élément restauré avec succès",
	"action.itemIdsRequired.bulkRestore":
		"Les IDs des éléments sont requis pour la restauration groupée",
	"action.itemsRestored": {
		one: "{{count}} élément restauré avec succès",
		other: "{{count}} éléments restaurés avec succès",
	},
	"action.itemIdRequired.duplicate":
		"L'ID de l'élément est requis pour l'action de duplication",
	"action.itemNotFound": "Élément introuvable",
	"action.itemDuplicated": "Élément dupliqué avec succès",
	"action.itemIdRequired.transition":
		"L'ID de l'élément est requis pour l'action de transition",
	"action.targetStageRequired":
		"L'étape cible est requise pour l'action de transition",
	"action.workflowUnsupported":
		"Les transitions de workflow ne sont pas prises en charge pour cette collection",
	"action.unknownBuiltin": "Action intégrée inconnue : {{action}}",
	"action.fieldRequired": 'Le champ "{{field}}" est obligatoire',

	// Relations
	"relation.select": "Sélectionner {{name}}",
	"relation.clear": "Effacer la sélection",
	"relation.search": "Rechercher {{name}}...",
	"relation.noResults": "Aucun {{name}} trouvé",
	"relation.loading": "Chargement...",
	"relation.createNew": "Créer nouveau {{name}}",
	"relation.selected": "{{count}} sélectionné(s)",
	"relation.removeItem": "Supprimer {{name}}",
	"relation.addItem": "Ajouter {{name}}",
	"relation.noneSelected": "Aucun {{name}} sélectionné",
	"relation.noRelated": "Aucun élément lié trouvé",
	"relation.saveFirst":
		"Enregistrez d'abord cet élément pour voir les éléments liés.",

	// Arrays
	"array.empty": "Aucun {{name}} ajouté pour le moment",
	"array.addItem": "Ajouter {{name}}",

	// Blocks
	"blocks.addAbove": "Ajouter au-dessus",
	"blocks.addBelow": "Ajouter en-dessous",
	"blocks.addChild": "Ajouter bloc enfant",

	// Forms
	"form.id": "ID",
	"form.created": "Créé",
	"form.updated": "Mis à jour",
	"form.required": "Ce champ est obligatoire",
	"form.invalid": "Valeur invalide",
	"form.saveChanges": "Enregistrer les modifications",
	"form.unsavedChanges": "Vous avez des modifications non enregistrées",
	"form.discardChanges": "Abandonner les modifications",
	"form.discardConfirm":
		"Êtes-vous sûr de vouloir abandonner les modifications ? Cette action est irréversible.",
	"form.fieldRequired": "{{field}} est obligatoire",
	"form.fieldInvalid": "{{field}} est invalide",
	"form.maxLength": "Maximum {{max}} caractères",
	"form.minLength": "Minimum {{min}} caractères",
	"form.maxValue": "Maximum {{max}}",
	"form.minValue": "Minimum {{min}}",
	"form.pattern": "Format invalide",
	"form.email": "Adresse e-mail invalide",
	"form.url": "URL invalide",
	"form.createSuccess": "{{name}} créé avec succès",
	"form.createError": "Échec de la création de {{name}}",
	"form.updateSuccess": "{{name}} mis à jour avec succès",
	"form.updateError": "Échec de la mise à jour de {{name}}",
	"form.deleteSuccess": "{{name}} supprimé avec succès",
	"form.deleteError": "Échec de la suppression de {{name}}",

	// Auth
	"auth.login": "Se connecter",
	"auth.logout": "Se déconnecter",
	"auth.email": "E-mail",
	"auth.password": "Mot de passe",
	"auth.forgotPassword": "Mot de passe oublié ?",
	"auth.resetPassword": "Réinitialiser le mot de passe",
	"auth.signIn": "Se connecter",
	"auth.signOut": "Se déconnecter",
	"auth.signUp": "S'inscrire",
	"auth.rememberMe": "Se souvenir de moi",
	"auth.invalidCredentials": "E-mail ou mot de passe invalide",
	"auth.sessionExpired": "Votre session a expiré. Veuillez vous reconnecter.",
	"auth.emailPlaceholder": "vous@exemple.fr",
	"auth.passwordPlaceholder": "Entrez votre mot de passe",
	"auth.signingIn": "Connexion en cours...",
	"auth.creatingAdmin": "Création de l'administrateur...",
	"auth.name": "Nom",
	"auth.namePlaceholder": "Votre nom",
	"auth.confirmPassword": "Confirmer le mot de passe",
	"auth.confirmPasswordPlaceholder": "Confirmez votre mot de passe",
	"auth.acceptInvite": "Accepter l'invitation",
	"auth.acceptingInvite": "Acceptation de l'invitation...",
	"auth.dontHaveAccount": "Vous n'avez pas de compte ?",
	"auth.alreadyHaveAccount": "Vous avez déjà un compte ?",
	"auth.emailRequired": "L'e-mail est obligatoire",
	"auth.passwordRequired": "Le mot de passe est obligatoire",
	"auth.passwordMinLength":
		"Le mot de passe doit avoir au moins {{min}} caractères",
	"auth.nameRequired": "Le nom est obligatoire",
	"auth.nameMinLength": "Le nom doit avoir au moins {{min}} caractères",
	"auth.invalidEmail": "Adresse e-mail invalide",
	"auth.passwordMismatch": "Les mots de passe ne correspondent pas",
	"auth.newPassword": "Nouveau mot de passe",
	"auth.newPasswordPlaceholder": "Entrez nouveau mot de passe",
	"auth.sendResetLink": "Envoyer le lien de réinitialisation",
	"auth.sendingResetLink": "Envoi en cours...",
	"auth.resetLinkSent": "Lien de réinitialisation envoyé à votre e-mail",
	"auth.resettingPassword": "Réinitialisation du mot de passe...",
	"auth.createFirstAdmin": "Créer le premier administrateur",
	"auth.setupTitle": "Configuration",
	"auth.setupDescription":
		"Créez votre premier compte administrateur pour commencer.",
	"auth.profile": "Profil",
	"auth.myAccount": "Mon compte",
	"auth.logoutFailed": "Échec de la déconnexion. Veuillez réessayer.",
	"auth.setupAlreadyCompleted":
		"La configuration est déjà terminée - des administrateurs existent dans le système",
	"auth.failedToCreateUserAccount": "Impossible de créer le compte utilisateur",

	// Errors
	"error.notFound": "Non trouvé",
	"error.serverError": "Erreur serveur",
	"error.networkError": "Erreur réseau. Veuillez vérifier votre connexion.",
	"error.unauthorized": "Vous n'êtes pas autorisé à effectuer cette action",
	"error.forbidden": "Accès refusé",
	"error.validation": "Validation échouée",
	"error.unknown": "Une erreur inconnue s'est produite",
	"error.timeout": "Délai de demande dépassé. Veuillez réessayer.",
	"error.conflict":
		"Un conflit s'est produit. Veuillez actualiser et réessayer.",

	// Table
	"table.rowsPerPage": "Lignes par page",
	"table.of": "sur",
	"table.noResults": "Aucun résultat",
	"table.selectAll": "Tout sélectionner",
	"table.selectRow": "Sélectionner la ligne",
	"table.showing": "Affichage de {{from}} à {{to}} sur {{total}}",
	"table.page": "Page {{page}}",
	"table.firstPage": "Première page",
	"table.lastPage": "Dernière page",
	"table.nextPage": "Page suivante",
	"table.previousPage": "Page précédente",
	"table.sortAsc": "Trier croissant",
	"table.sortDesc": "Trier décroissant",
	"table.columns": "Colonnes",
	"table.hideColumn": "Masquer colonne",
	"table.showColumn": "Afficher colonne",

	// Upload
	"upload.dropzone": "Déposez les fichiers ici ou cliquez pour téléverser",
	"upload.browse": "Parcourir les fichiers",
	"upload.uploading": "Téléversement...",
	"upload.complete": "Téléversement terminé",
	"upload.error": "Échec du téléversement",
	"upload.maxSize": "Le fichier doit être plus petit que {{size}}",
	"upload.invalidType": "Type de fichier invalide. Autorisés : {{types}}",
	"upload.remove": "Supprimer fichier",
	"upload.replace": "Remplacer fichier",
	"upload.preview": "Aperçu",
	"upload.noFile": "Aucun fichier sélectionné",
	"upload.dragDrop": "Glissez-déposez les fichiers ici",

	// Editor
	"editor.bold": "Gras",
	"editor.italic": "Italique",
	"editor.underline": "Souligné",
	"editor.strikethrough": "Barré",
	"editor.heading": "Titre {{level}}",
	"editor.richTextToolbar": "Barre de texte enrichi",
	"editor.blockType": "Type de bloc",
	"editor.selectionBlockType": "Type de bloc sélectionné",
	"editor.paragraph": "Paragraphe",
	"editor.textBlocks": "Blocs de texte",
	"editor.headings": "Titres",
	"editor.blocks": "Blocs",
	"editor.formatting": "Mise en forme",
	"editor.moreFormatting": "Plus de mise en forme",
	"editor.alignment": "Alignement",
	"editor.insert": "Insérer",
	"editor.link": "Insérer lien",
	"editor.image": "Insérer image",
	"editor.list": "Liste",
	"editor.orderedList": "Liste numérotée",
	"editor.unorderedList": "Liste à puces",
	"editor.quote": "Citation",
	"editor.code": "Code",
	"editor.codeBlock": "Bloc de code",
	"editor.table": "Insérer tableau",
	"editor.undo": "Annuler",
	"editor.redo": "Rétablir",
	"editor.alignLeft": "Aligner à gauche",
	"editor.alignCenter": "Centrer",
	"editor.alignRight": "Aligner à droite",
	"editor.alignJustify": "Justifier",
	"editor.horizontalRule": "Ligne horizontale",
	"editor.addRowBefore": "Ajouter ligne avant",
	"editor.addRowAfter": "Ajouter ligne après",
	"editor.addColumnBefore": "Ajouter colonne avant",
	"editor.addColumnAfter": "Ajouter colonne après",
	"editor.deleteRow": "Supprimer ligne",
	"editor.deleteColumn": "Supprimer colonne",
	"editor.deleteTable": "Supprimer tableau",
	"editor.toggleHeaderRow": "Basculer ligne d'en-tête",
	"editor.toggleHeaderColumn": "Basculer colonne d'en-tête",
	"editor.mergeCells": "Fusionner cellules",
	"editor.splitCell": "Diviser cellule",
	"editor.insertUrl": "Insérer URL",
	"editor.altText": "Texte alternatif (optionnel)",
	"editor.uploadFile": "Téléverser fichier",
	"editor.chooseFile": "Choisir fichier",
	"editor.uploading": "Téléversement...",
	"editor.browseLibrary": "Parcourir la bibliothèque",
	"editor.startWriting": "Commencez à écrire...",
	"editor.pasteOrTypeLink": "Collez ou saisissez un lien...",
	"editor.paragraphDescription": "Commencer avec du texte simple",
	"editor.heading1Description": "Grand titre de section",
	"editor.heading2Description": "Titre de section moyen",
	"editor.heading3Description": "Petit titre de section",
	"editor.bulletListDescription": "Créer une liste à puces",
	"editor.orderedListDescription": "Créer une liste numérotée",
	"editor.quoteDescription": "Insérer une citation",
	"editor.codeBlockDescription": "Insérer un extrait de code",
	"editor.dividerDescription": "Insérer une ligne horizontale",
	"editor.tableDescription": "Insérer un tableau 3x3",

	// Toasts
	"toast.success": "Succès",
	"toast.error": "Erreur",
	"toast.warning": "Avertissement",
	"toast.info": "Information",
	"toast.saving": "Enregistrement...",
	"toast.saveFailed": "Échec de l'enregistrement des modifications",
	"toast.saveSuccess": "Modifications enregistrées avec succès",
	"toast.creating": "Création...",
	"toast.createSuccess": "Créé avec succès",
	"toast.createFailed": "Échec de la création",
	"toast.deleting": "Suppression...",
	"toast.deleteFailed": "Échec de la suppression",
	"toast.deleteSuccess": "Supprimé avec succès",
	"toast.loadFailed": "Échec du chargement des données",
	"toast.uploadFailed": "Échec du téléversement du fichier",
	"toast.uploadSuccess": "Fichier téléversé avec succès",
	"toast.copySuccess": "Copié dans le presse-papiers",
	"toast.copyFailed": "Échec de la copie dans le presse-papiers",
	"toast.idCopied": "ID copié dans le presse-papiers",
	"toast.validationFailed": "Validation échouée",
	"toast.validationDescription":
		"Veuillez vérifier le formulaire pour les erreurs",
	"toast.created": "{{name}} créé",
	"toast.updated": "{{name}} mis à jour",
	"toast.resourceSaveFailed": "Échec de l'enregistrement de {{name}}",
	"toast.editComingSoon": "Fonction de modification bientôt disponible",
	"toast.maxFilesWarning":
		"Seulement {{remaining}} fichier(s) supplémentaire(s) peuvent être ajoutés (max {{max}})",
	"toast.settingsSaveFailed": "Échec de l'enregistrement des paramètres",
	"toast.actionSuccess": "Action terminée avec succès",
	"toast.actionFailed": "Action échouée",
	"toast.localeChangedUnsaved": "Langue du contenu modifiée",
	"toast.localeChangedUnsavedDescription":
		"Vos modifications non enregistrées ont été remplacées par le contenu dans la nouvelle langue.",

	// Confirm
	"confirm.delete":
		"Êtes-vous sûr de vouloir supprimer ceci ? Cette action est irréversible.",
	"confirm.discard":
		"Êtes-vous sûr de vouloir abandonner les modifications ? Cette action est irréversible.",
	"confirm.unsavedChanges":
		"Vous avez des modifications non enregistrées. Êtes-vous sûr de vouloir quitter ?",
	"confirm.action": "Êtes-vous sûr de vouloir continuer ?",
	"confirm.irreversible": "Cette action est irréversible.",
	"confirm.localeChange": "Abandonner les modifications non enregistrées ?",
	"confirm.localeChangeDescription":
		"Vous avez des modifications non enregistrées. Changer la langue du contenu abandonnera vos modifications et chargera le contenu dans la nouvelle langue.",
	"confirm.localeChangeStay": "Rester",
	"confirm.localeChangeDiscard": "Abandonner et changer",

	// Status
	"status.draft": "Brouillon",
	"status.published": "Publié",
	"status.archived": "Archivé",
	"status.pending": "En attente",
	"status.active": "Actif",
	"status.inactive": "Inactif",

	// Dates
	"date.today": "Aujourd'hui",
	"date.yesterday": "Hier",
	"date.tomorrow": "Demain",
	"date.selectDate": "Sélectionner date",
	"date.selectTime": "Sélectionner heure",
	"date.clear": "Effacer date",

	// Accessibility
	"a11y.openMenu": "Ouvrir menu",
	"a11y.closeMenu": "Fermer menu",
	"a11y.expand": "Développer",
	"a11y.collapse": "Réduire",
	"a11y.loading": "Chargement",
	"a11y.required": "Obligatoire",
	"a11y.optional": "Optionnel",
	"a11y.selected": "Sélectionné",
	"a11y.notSelected": "Non sélectionné",

	// Locale
	"locale.language": "Langue",
	"locale.switchLanguage": "Changer de langue",
	"locale.contentLanguage": "Langue du contenu",
	"locale.uiLanguage": "Langue de l'interface",

	// ===========================================
	// Default Collections
	// ===========================================

	// Users Collection
	"defaults.users.label": "Utilisateurs",
	"defaults.users.description": "Gérer les utilisateurs et leurs rôles",
	"defaults.users.fields.name.label": "Nom",
	"defaults.users.fields.name.placeholder": "Entrez le nom de l'utilisateur",
	"defaults.users.fields.email.label": "E-mail",
	"defaults.users.fields.email.description": "Adresse e-mail (lecture seule)",
	"defaults.users.fields.role.label": "Rôle",
	"defaults.users.fields.role.options.admin": "Administrateur",
	"defaults.users.fields.role.options.user": "Utilisateur",
	"defaults.users.fields.emailVerified.label": "E-mail vérifié",
	"defaults.users.fields.emailVerified.description":
		"Si l'utilisateur a vérifié son adresse e-mail",
	"defaults.users.fields.banned.label": "Banni",
	"defaults.users.fields.banned.description":
		"Empêcher l'utilisateur d'accéder au système",
	"defaults.users.fields.banReason.label": "Raison du bannissement",
	"defaults.users.fields.banReason.placeholder":
		"Entrez la raison du bannissement...",
	"defaults.users.sections.basicInfo": "Informations de base",
	"defaults.users.sections.permissions": "Permissions",
	"defaults.users.sections.accessControl": "Contrôle d'accès",
	"defaults.users.actions.createUser.label": "Créer utilisateur",
	"defaults.users.actions.createUser.title": "Créer utilisateur",
	"defaults.users.actions.createUser.description":
		"Créer un nouveau compte utilisateur avec identifiants de connexion.",
	"defaults.users.actions.createUser.fields.password.label": "Mot de passe",
	"defaults.users.actions.createUser.fields.password.placeholder":
		"Entrez le mot de passe",
	"defaults.users.actions.createUser.submit": "Créer utilisateur",
	"defaults.users.actions.createUser.success":
		"Utilisateur {{email}} créé avec succès. Partagez les identifiants avec l'utilisateur.",
	"defaults.users.actions.createUser.errorNoAuth":
		"Client d'authentification non configuré. Impossible de créer l'utilisateur.",
	"defaults.users.actions.resetPassword.label": "Réinitialiser mot de passe",
	"defaults.users.actions.resetPassword.title": "Réinitialiser mot de passe",
	"defaults.users.actions.resetPassword.description":
		"Définir un nouveau mot de passe pour cet utilisateur.",
	"defaults.users.actions.resetPassword.fields.newPassword.label":
		"Nouveau mot de passe",
	"defaults.users.actions.resetPassword.fields.newPassword.placeholder":
		"Entrez nouveau mot de passe",
	"defaults.users.actions.resetPassword.fields.confirmPassword.label":
		"Confirmer mot de passe",
	"defaults.users.actions.resetPassword.fields.confirmPassword.placeholder":
		"Confirmez nouveau mot de passe",
	"defaults.users.actions.resetPassword.submit": "Réinitialiser mot de passe",
	"defaults.users.actions.resetPassword.success":
		"Mot de passe réinitialisé avec succès !",
	"defaults.users.actions.resetPassword.errorMismatch":
		"Les mots de passe ne correspondent pas",
	"defaults.users.actions.delete.label": "Supprimer utilisateur",

	// Assets Collection
	"defaults.assets.label": "Médias",
	"defaults.assets.description": "Gérer les fichiers et images téléversés",
	"defaults.assets.fields.preview.label": "Aperçu",
	"defaults.assets.fields.filename.label": "Nom de fichier",
	"defaults.assets.fields.filename.description":
		"Nom original du fichier téléversé",
	"defaults.assets.fields.mimeType.label": "Type",
	"defaults.assets.fields.mimeType.description": "Type MIME du fichier",
	"defaults.assets.fields.size.label": "Taille (octets)",
	"defaults.assets.fields.size.description": "Taille du fichier en octets",
	"defaults.assets.fields.alt.label": "Texte alternatif",
	"defaults.assets.fields.alt.placeholder":
		"Décrivez l'image pour l'accessibilité",
	"defaults.assets.fields.alt.description":
		"Texte alternatif pour les lecteurs d'écran",
	"defaults.assets.fields.caption.label": "Légende",
	"defaults.assets.fields.caption.placeholder": "Ajouter une légende...",
	"defaults.assets.fields.visibility.label": "Visibilité",
	"defaults.assets.fields.visibility.options.public": "Public",
	"defaults.assets.fields.visibility.options.private": "Privé",
	"defaults.assets.fields.visibility.description":
		"Les fichiers publics sont accessibles sans authentification. Les fichiers privés nécessitent une URL signée.",
	"defaults.assets.sections.fileInfo": "Informations du fichier",
	"defaults.assets.sections.metadata": "Métadonnées",
	"defaults.assets.sections.metadata.description":
		"Ajoutez des informations descriptives pour l'accessibilité et le SEO",
	"defaults.assets.actions.upload.label": "Téléverser fichiers",

	// Default Sidebar
	"defaults.sidebar.administration": "Administration",

	// View Options (Filter Builder)
	"viewOptions.title": "Options de vue",
	"viewOptions.columns": "Colonnes",
	"viewOptions.filters": "Filtres",
	"viewOptions.savedViews": "Vues enregistrées",
	"viewOptions.apply": "Appliquer",
	"viewOptions.reset": "Réinitialiser",

	// Saved Views Tab
	"viewOptions.saveCurrentConfig": "Enregistrer la configuration actuelle",
	"viewOptions.viewNamePlaceholder": "Nom de la vue...",
	"viewOptions.saveDescription":
		"Enregistre les colonnes, filtres et tri actuels.",
	"viewOptions.noChangesToSave":
		"Aucun filtre ou changement de colonnes à enregistrer.",
	"viewOptions.noSavedViews": "Aucune vue enregistrée pour le moment.",
	"viewOptions.filtersCount": {
		one: "{{count}} filtre",
		other: "{{count}} filtres",
	},
	"viewOptions.columnsCount": { one: "{{count}} col", other: "{{count}} cols" },
	"viewOptions.defaultView": "Par défaut",

	// Columns Tab
	"viewOptions.columnsDragHint":
		"Glissez pour réordonner, activez/désactivez pour afficher/masquer les colonnes.",
	"viewOptions.noFieldsAvailable": "Aucun champ disponible.",

	// Filters Tab
	"viewOptions.filtersDescription":
		"Affinez vos résultats avec des règles personnalisées.",
	"viewOptions.filterNumber": "Filtre #{{number}}",
	"viewOptions.selectField": "Sélectionner champ",
	"viewOptions.selectOperator": "Sélectionner opérateur",
	"viewOptions.valuePlaceholder": "Valeur...",
	"viewOptions.noActiveFilters": "Aucun filtre actif.",
	"viewOptions.addFilter": "Ajouter filtre",
	"viewOptions.clearAll": "Tout effacer",
	"viewOptions.activeFilters": {
		one: "{{count}} filtre actif",
		other: "{{count}} filtres actifs",
	},
	"viewOptions.clearFilters": "Effacer filtres",

	// Filter Operators
	"filter.contains": "Contient",
	"filter.notContains": "Ne contient pas",
	"filter.equals": "Égal à",
	"filter.notEquals": "Différent de",
	"filter.startsWith": "Commence par",
	"filter.endsWith": "Termine par",
	"filter.greaterThan": "Supérieur à",
	"filter.greaterThanOrEqual": "Supérieur ou égal à",
	"filter.lessThan": "Inférieur à",
	"filter.lessThanOrEqual": "Inférieur ou égal à",
	"filter.in": "Est l'un de",
	"filter.notIn": "N'est aucun de",
	"filter.some": "A au moins un",
	"filter.every": "A tous",
	"filter.none": "N'en a aucun",
	"filter.isEmpty": "Est vide",
	"filter.isNotEmpty": "N'est pas vide",

	// Preview
	"preview.show": "Aperçu",
	"preview.hide": "Masquer aperçu",
	"preview.title": "Aperçu",
	"preview.livePreview": "Aperçu en direct",
	"preview.fullscreen": "Plein écran",
	"preview.close": "Fermer aperçu",
	"preview.loading": "Chargement de l'aperçu...",
	"preview.pathRequired": "Le chemin est requis",
	"preview.collectionNameRequired": "Le nom de la collection est requis",
	"preview.adminSessionRequired": "Session administrateur requise",
	"preview.invalidTokenFormat": "Format de token invalide",
	"preview.invalidSignature": "Signature invalide",
	"preview.invalidPayload": "Payload invalide",
	"preview.tokenExpired": "Token expiré",
	"preview.invalidPath": "Chemin invalide",
	"preview.collectionNotFound": 'Collection "{{collection}}" introuvable',
	"preview.noUrlConfigured":
		"Aucune URL de prévisualisation n'est configurée pour cette collection",
	"preview.disabledForCollection":
		"La prévisualisation est désactivée pour cette collection",
	"preview.generateUrlFailed":
		"Impossible de générer l'URL de prévisualisation : {{message}}",

	// Autosave
	"autosave.saving": "Enregistrement...",
	"autosave.saved": "Enregistré",
	"autosave.unsavedChanges": "Modifications non enregistrées",
	"autosave.justNow": "à l'instant",
	"autosave.secondsAgo": {
		one: "il y a {{count}}s",
		other: "il y a {{count}}s",
	},
	"autosave.minutesAgo": {
		one: "il y a {{count}}m",
		other: "il y a {{count}}m",
	},
	"autosave.hoursAgo": { one: "il y a {{count}}h", other: "il y a {{count}}h" },

	// Global Search
	"globalSearch.placeholder":
		"Rechercher collections, globales, actions, enregistrements...",
	"globalSearch.collections": "Collections",
	"globalSearch.globals": "Globales",
	"globalSearch.quickActions": "Actions rapides",
	"globalSearch.records": "Enregistrements",
	"globalSearch.createNew": "Créer nouveau {{name}}",
	"globalSearch.noResults": "Aucun résultat trouvé",
	"globalSearch.searching": "Recherche en cours...",
	"globalSearch.navigate": "pour naviguer",
	"globalSearch.select": "pour sélectionner",

	// Collection Search
	"collectionSearch.placeholder": "Rechercher enregistrements...",
	"collectionSearch.noResults": "Aucun enregistrement correspondant trouvé",
	"collectionSearch.searching": "Recherche en cours...",

	// Audit
	"audit.section.activity": "Activité",

	// Additional Admin UI Messages
	"audit.collection.description":
		"Parcourir tous les changements enregistrés et l'activité des utilisateurs",
	"audit.collection.label": "Journal d'audit",
	"audit.sections.changes": "Changements",
	"audit.sections.event": "Détails de l'événement",
	"audit.sections.user": "Utilisateur",
	"audit.widget.recentActivity.empty": "Aucune activité récente enregistrée.",
	"audit.widget.recentActivity.title": "Activité récente",
	"auth.backToLogin": "Retour à la connexion",
	"auth.checkYourEmail": "Consultez votre e-mail",
	"auth.completeRegistration": "Terminer l'inscription",
	"auth.createAccountDescription": "Créez votre compte pour commencer",
	"auth.enterNewPassword": "Entrez votre nouveau mot de passe ci-dessous.",
	"auth.forgotPasswordDescription":
		"Entrez votre e-mail pour recevoir un lien de réinitialisation",
	"auth.forgotPasswordFormDescription":
		"Entrez votre adresse e-mail et nous vous enverrons un lien pour réinitialiser votre mot de passe.",
	"auth.forgotPasswordTitle": "Mot de passe oublié",
	"auth.goToLogin": "Aller à la connexion",
	"auth.invalidInvitation": "Invitation invalide",
	"auth.invalidInvitationDescription": "Ce lien d'invitation n'est plus valide",
	"auth.invalidLink": "Lien invalide",
	"auth.invalidLinkDescription":
		"Le lien de réinitialisation du mot de passe est invalide ou a expiré.",
	"auth.invalidOrExpiredInvitation": "Invitation invalide ou expirée",
	"auth.invitationExpiredMessage":
		"L'invitation a peut-être expiré ou a déjà été utilisée. Contactez votre administrateur pour obtenir une nouvelle invitation.",
	"auth.inviteEmailDescription":
		"Un lien d'invitation sera envoyé à cet e-mail",
	"auth.inviteEmailLabel": "Adresse e-mail",
	"auth.inviteMessage": "Message personnel (facultatif)",
	"auth.inviteMessageDescription":
		"Ce message sera inclus dans l'e-mail d'invitation",
	"auth.inviteMessagePlaceholder":
		"Ajoutez un message personnel à l'invitation...",
	"auth.inviteRole": "Rôle",
	"auth.inviteRoleDescription":
		"Le rôle détermine les autorisations de l'utilisateur",
	"auth.inviteSelectRole": "Sélectionner un rôle",
	"auth.inviteSentSuccess": "Invitation envoyée avec succès",
	"auth.inviteSentTo": "Invitation envoyée à {{email}}",
	"auth.inviteUser": "Inviter un utilisateur",
	"auth.inviteUserDescription":
		"Envoyer une invitation pour ajouter un nouvel utilisateur",
	"auth.pleaseWait": "Veuillez patienter...",
	"auth.rememberYourPassword": "Vous vous souvenez de votre mot de passe ?",
	"auth.requestNewResetLink":
		"Veuillez demander un nouveau lien de réinitialisation du mot de passe.",
	"auth.resetLinkSentDescription":
		"Nous avons envoyé un lien de réinitialisation du mot de passe à votre adresse e-mail. Consultez votre boîte de réception et suivez les instructions.",
	"auth.resetPasswordSuccess": "Mot de passe réinitialisé avec succès",
	"auth.resetPasswordSuccessDescription":
		"Votre mot de passe a été réinitialisé avec succès. Vous pouvez maintenant vous connecter avec votre nouveau mot de passe.",
	"auth.sendInvitation": "Envoyer l'invitation",
	"auth.sendingInvitation": "Envoi de l'invitation...",
	"auth.signInDescription":
		"Entrez vos identifiants pour accéder au panneau d'administration",
	"auth.user": "Utilisateur",
	"auth.validatingInvitation": "Validation de l'invitation",
	"blocks.add": "Ajouter un bloc",
	"blocks.addFirst": "Ajoutez votre premier bloc pour commencer",
	"blocks.addTo": "Ajouter à {{parent}}",
	"blocks.emptyTitle": "Aucun bloc",
	"blocks.libraryDescription":
		"Choisissez un type de bloc à ajouter à votre mise en page.",
	"blocks.noDefinitions": "Aucune définition de bloc enregistrée",
	"blocks.noDefinitionsHint":
		"Enregistrez des blocs avec .blocks() dans votre configuration d'administration",
	"blocks.noEditableFields": "Ce bloc n'a aucun champ modifiable.",
	"blocks.noSearchResults": "Aucun bloc ne correspond à votre recherche",
	"blocks.searchPlaceholder": "Rechercher des blocs...",
	"blocks.tryDifferentSearch": "Essayez un autre terme de recherche.",
	"blocks.uncategorized": "Autre",
	"blocks.unknownType":
		'Type de bloc "{{type}}" inconnu. Ce type de bloc n\'est pas enregistré.',
	"cell.blocks": "Blocs",
	"cell.file": { one: "{{count}} fichier", other: "{{count}} fichiers" },
	"cell.item": { one: "{{count}} élément", other: "{{count}} éléments" },
	"cell.more": "+{{count}} de plus",
	"collection.bulkRestoreError": "Échec de la restauration des éléments",
	"collection.bulkRestorePartial": {
		one: "{{success}} élément restauré, {{failed}} échec",
		other: "{{success}} éléments restaurés, {{failed}} échecs",
	},
	"collection.bulkRestoreSuccess": {
		one: "{{count}} élément restauré avec succès",
		other: "{{count}} éléments restaurés avec succès",
	},
	"collection.orderSaveFailed": "Échec de l'enregistrement de l'ordre",
	"collection.orderSaved": "Ordre enregistré",
	"collection.reorderAddOrderField":
		"Ajoutez un champ d'ordre numérique avant de réorganiser",
	"collection.reorderClearFilters": "Effacez les filtres pour réorganiser",
	"collection.reorderClearSearch": "Effacez la recherche pour réorganiser",
	"collection.reorderEnableOrderable":
		"Activez l'ordonnancement avant de réorganiser",
	"collection.reorderEnterMode": "Entrer en mode de réorganisation",
	"collection.reorderExitMode": "Quitter le mode de réorganisation",
	"collection.reorderItems": "Réorganiser les éléments",
	"collection.reorderMode": "Mode de réorganisation",
	"collection.reorderRemoveGrouping":
		"Supprimez le groupement pour réorganiser",
	"collection.reorderShowOnePage":
		"Affichez une seule page d'éléments pour réorganiser",
	"collection.reorderSwitchSort": "Passer au tri {{field}} et réorganiser",
	"collection.reorderUnavailable": "Réorganisation indisponible : {{reason}}",
	"collection.restoreError": "Échec de la restauration de l'élément",
	"collection.restoreSuccess": "Élément restauré avec succès",
	"collection.restoring": "Restauration...",
	"collection.sortedByField": "Trié par {{field}} {{direction}}.",
	"collectionSearch.noResultsDescription":
		"Essayez un autre terme de recherche ou effacez la recherche pour revenir à la liste complète.",
	"common.backToList": "Retour à la liste",
	"common.deleted": "Supprimé",
	"common.done": "Terminé",
	"common.moreActions": "Plus d'actions",
	"common.noValue": "Aucune valeur",
	"confirm.deleteAll": "Tout supprimer",
	"confirm.deleteItemDescription":
		"Cette action est irréversible. L'élément sera définitivement supprimé.",
	"confirm.deleteItemTitle": "Supprimer l'élément ?",
	"confirm.deleteSelected": "Supprimer la sélection",
	"confirm.deleteSelectedDescription":
		"Cette action est irréversible. Tous les éléments sélectionnés seront définitivement supprimés.",
	"confirm.deleteSelectedTitle": "Supprimer les éléments sélectionnés ?",
	"confirm.restore": "Restaurer",
	"confirm.restoreDescription":
		"Cet élément sera de nouveau visible dans les vues de liste normales.",
	"confirm.restoreTitle": "Restaurer l'élément ?",
	"dashboard.noWidgets": "Aucun widget configuré",
	"dashboard.noWidgetsDescription":
		"Ajoutez des widgets à la configuration de votre tableau de bord pour afficher des données ici.",
	"dashboard.systemStatus": "État du système",
	"dashboard.welcomeDescription":
		"Sélectionnez une collection dans la barre latérale pour gérer votre contenu.",
	"defaults.assets.sections.dimensions": "Dimensions",
	"defaults.users.tabs.profile": "Profil",
	"defaults.users.tabs.security": "Sécurité",
	"dropzone.invalidType": '"{{name}}" n\'est pas un type de fichier accepté',
	"dropzone.label": "Déposez des fichiers ici ou cliquez pour parcourir",
	"dropzone.tooLarge": '"{{name}}" dépasse la taille maximale de {{maxSize}}',
	"dropzone.typeAudio": "Audio",
	"dropzone.typeImages": "Images",
	"dropzone.typePDF": "PDF",
	"dropzone.typeVideos": "Vidéos",
	"dropzone.uploading": "Téléversement...",
	"error.accessRestricted": "Accès restreint",
	"error.accessRestrictedDescription":
		"Vous n'avez pas l'autorisation d'accéder à cette page. Contactez votre administrateur si vous pensez qu'il s'agit d'une erreur.",
	"error.accessRestrictedResourceDescription":
		"La ressource {{type}} \"{{name}}\" n'est pas disponible dans le panneau d'administration. Elle peut être masquée ou vous n'avez pas l'autorisation d'y accéder.",
	"error.actionFailed": "Action échouée",
	"error.anErrorOccurred": "Une erreur s'est produite",
	"error.autosaveFailed": "Échec de l'enregistrement automatique",
	"error.backToDashboard": "Retour au tableau de bord",
	"error.componentNotFound": "Composant introuvable",
	"error.failedToCreateAccount": "Échec de la création du compte",
	"error.failedToCreateAdminAccount":
		"Échec de la création du compte administrateur",
	"error.failedToGeneratePreviewToken":
		"Échec de la génération du jeton d'aperçu",
	"error.failedToLoad": "Échec du chargement",
	"error.failedToLoadAssets": "Échec du chargement des médias",
	"error.failedToLoadComponent": "Échec du chargement du composant",
	"error.failedToLoadOptions": "Échec du chargement des options",
	"error.failedToLoadSelectedItems":
		"Échec du chargement des éléments sélectionnés",
	"error.failedToLoadView": "Échec du chargement de {{viewType}}",
	"error.failedToLoadViewFor":
		"Échec du chargement de {{viewType}} pour {{collection}}",
	"error.failedToResetPassword": "Échec de la réinitialisation du mot de passe",
	"error.failedToSendInvitation": "Échec de l'envoi de l'invitation",
	"error.failedToSendResetEmail":
		"Échec de l'envoi de l'e-mail de réinitialisation",
	"error.invalidCredentials": "Identifiants invalides",
	"error.maxItemsAllowed": "Maximum {{max}} éléments autorisés",
	"error.missingFieldComponent":
		"Aucun composant enregistré pour le type de champ : {{type}}",
	"error.multipleUploadCollections":
		"Plusieurs collections de téléversement sont disponibles ({{collections}}). Indiquez la collection à utiliser.",
	"error.noUploadCollection":
		"Aucune collection de téléversement n'est configurée.",
	"error.pageNotFound": "Page introuvable",
	"error.pageNotFoundDescription": "La page que vous recherchez n'existe pas.",
	"error.selectAtLeastOne": "Veuillez sélectionner au moins un média",
	"error.serverActionFailed": "Action serveur échouée",
	"error.somethingWentWrong": "Une erreur est survenue",
	"error.tryAgain": "Réessayer",
	"error.unexpectedError": "Une erreur inattendue s'est produite",
	"error.unknownWidget": "Widget inconnu",
	"error.unregisteredViewDescription":
		"La vue \"{{viewId}}\" n'est pas enregistrée dans le registre des vues d'administration.",
	"error.uploadFailed": "Téléversement échoué",
	"error.widgetError": "Erreur de widget",
	"error.widgetTypeNotRecognized":
		'Le type de widget "{{type}}" n\'est pas reconnu.',
	"field.codeEditor": "Éditeur de code",
	"field.dragToReorder": "Faire glisser pour réorganiser",
	"field.editItem": "Modifier l'élément",
	"field.formEditor": "Éditeur de formulaire",
	"field.moveDown": "Déplacer vers le bas",
	"field.moveUp": "Déplacer vers le haut",
	"field.noItems": "Aucun élément",
	"field.removeItem": "Supprimer l'élément",
	"field.section": "Section",
	"form.deletedBanner":
		"Cet enregistrement a été supprimé le {{date}}. Utilisez l'action Restaurer pour le rendre à nouveau actif.",
	"form.lastUpdated": "Dernière mise à jour",
	"history.after": "Après",
	"history.before": "Avant",
	"history.blocksCount": { one: "{{count}} bloc", other: "{{count}} blocs" },
	"history.changeAdded": "Ajouté",
	"history.changeChanged": "Modifié",
	"history.changeRemoved": "Supprimé",
	"history.changedFields": {
		one: "{{count}} champ modifié",
		other: "{{count}} champs modifiés",
	},
	"history.description": "Changements et activité de cet enregistrement",
	"history.diffAgainstVersion": "Différence avec la version {{number}}",
	"history.empty": "Aucune activité enregistrée",
	"history.hideChanges": "Masquer les changements",
	"history.initialSnapshot": "Instantané initial",
	"history.itemsCount": {
		one: "{{count}} élément",
		other: "{{count}} éléments",
	},
	"history.moreFields": {
		one: "{{count}} de plus",
		other: "{{count}} de plus",
	},
	"history.noFieldChanges":
		"Aucun changement au niveau des champs dans cet instantané.",
	"history.objectWithKeys": {
		one: "Objet avec {{count}} clé",
		other: "Objet avec {{count}} clés",
	},
	"history.showChanges": {
		one: "Afficher les changements ({{count}})",
		other: "Afficher les changements ({{count}})",
	},
	"history.stage": "Étape",
	"history.systemUser": "Système",
	"history.tabActivity": "Activité",
	"history.tabVersions": "Versions",
	"history.title": "Historique",
	"history.versionDescription":
		"Parcourez les instantanés de version et inspectez les différences au niveau des champs.",
	"input.selectDate": "Sélectionner une date",
	"input.selectDateRange": "Sélectionner une plage de dates",
	"input.selectDateTime": "Sélectionner une date et une heure",
	"input.selectTime": "Sélectionner une heure",
	"lock.blockedDescription":
		"Ce document est verrouillé. Vous pouvez le consulter, mais vous ne pouvez pas le modifier tant que le verrou n'a pas expiré.",
	"lock.blockedTitle": "{{name}} est en cours de modification",
	"lock.cannotSave":
		"Impossible d'enregistrer : le document est verrouillé par un autre utilisateur",
	"lock.openElsewhere":
		"Ce document est ouvert dans un autre onglet. Les modifications seront synchronisées automatiquement.",
	"media.allFiles": "Tous les fichiers",
	"media.audio": "Audio",
	"media.browseLibrary": "Parcourir la médiathèque",
	"media.documents": "Documents",
	"media.images": "Images",
	"media.noAssets": "Aucun média",
	"media.searchPlaceholder": "Rechercher par nom de fichier...",
	"media.videos": "Vidéos",
	"nav.adminNavigation": "Navigation d'administration",
	"nav.breadcrumb": "Fil d'Ariane",
	"preview.exitPreview": "Quitter l'aperçu",
	"preview.exitTooltip":
		"Quitter le mode aperçu et effacer le cookie de brouillon",
	"preview.hidePreview": "Masquer l'aperçu",
	"preview.loadingPreview": "Chargement de l'aperçu...",
	"preview.mode": "Mode aperçu",
	"preview.previewError": "Erreur d'aperçu",
	"preview.refreshing": "Actualisation...",
	"preview.showPreview": "Afficher l'aperçu",
	"table.editing": "Modification",
	"table.emptyDescription":
		"Les enregistrements apparaîtront ici une fois créés.",
	"table.noItemsInCollection": "Aucun élément trouvé dans cette collection",
	"table.pagination": "Pagination",
	"table.show": "Afficher",
	"time.daysAgoShort": { one: "il y a {{count}}j", other: "il y a {{count}}j" },
	"time.hoursAgoShort": {
		one: "il y a {{count}}h",
		other: "il y a {{count}}h",
	},
	"time.justNow": "à l'instant",
	"time.minutesAgoShort": {
		one: "il y a {{count}}m",
		other: "il y a {{count}}m",
	},
	"ui.commandPalette": "Palette de commandes",
	"ui.commandPaletteDescription": "Rechercher une commande à exécuter...",
	"ui.expand": "Développer",
	"ui.expandSidebar": "Développer la barre latérale",
	"ui.processing": "Traitement...",
	"ui.searchPlaceholder": "Rechercher...",
	"ui.skipToMainContent": "Passer au contenu principal",
	"ui.themeDark": "Sombre",
	"ui.themeLight": "Clair",
	"ui.themeSystem": "Système",
	"ui.toggleSidebar": "Basculer la barre latérale",
	"ui.toggleTheme": "Changer de thème",
	"upload.browseLibrary": "Parcourir la bibliothèque",
	"upload.bulkDescription": "Ajoutez plusieurs fichiers à votre médiathèque",
	"upload.bulkError": {
		one: "Échec du téléversement de {{count}} fichier",
		other: "Échec du téléversement de {{count}} fichiers",
	},
	"upload.bulkHint": "Téléversez plusieurs fichiers à la fois",
	"upload.bulkSuccess": {
		one: "{{count}} fichier téléversé avec succès",
		other: "{{count}} fichiers téléversés avec succès",
	},
	"upload.bulkTitle": "Téléverser des fichiers",
	"upload.failedCount": { one: "{{count}} échec", other: "{{count}} échecs" },
	"upload.filesCount": {
		one: "{{count}} fichier",
		other: "{{count}} fichiers",
	},
	"upload.uploadedCount": {
		one: "{{count}} téléversé",
		other: "{{count}} téléversés",
	},
	"upload.waitForComplete": "Veuillez attendre la fin des téléversements",
	"version.createdAt": "Créé",
	"version.empty": "Aucune version trouvée.",
	"version.globalHistoryDescription":
		"Parcourez les versions globales précédentes et restaurez-en une si nécessaire.",
	"version.history": "Historique des versions",
	"version.historyDescription":
		"Parcourez les versions précédentes et restaurez-en une si nécessaire.",
	"version.label": "Version {{number}}",
	"version.operationCreate": "Créé",
	"version.operationDelete": "Supprimé",
	"version.operationUnknown": "Modifié",
	"version.operationUpdate": "Mis à jour",
	"version.revert": "Rétablir",
	"version.revertConfirmDescription":
		"Cela remplacera le contenu actuel par la version {{number}}.",
	"version.revertConfirmTitle": "Rétablir cette version ?",
	"version.revertSuccess": "Version restaurée avec succès",
	"version.user": "Utilisateur",
	"viewOptions.groupBy": "Grouper par",
	"viewOptions.groupByDescription":
		"Grouper la page actuelle par un champ configuré.",
	"viewOptions.noGrouping": "Aucun groupement",
	"viewOptions.noResultsDescription":
		"Aucun enregistrement ne correspond aux filtres actifs. Ajustez-les ou effacez-les pour voir plus de résultats.",
	"viewOptions.realtime": "Mises à jour en temps réel",
	"viewOptions.realtimeDescription":
		"Actualiser automatiquement ce tableau lorsque les données changent.",
	"viewOptions.showDeleted": "Afficher les supprimés",
	"viewOptions.showDeletedDescription":
		"Inclure les enregistrements supprimés de façon réversible dans cette vue.",
	"viewOptions.sort": "Trier",
	"widget.chart.emptyDescription":
		"Configurez une source de données pour afficher un graphique.",
	"widget.chart.emptyTitle": "Aucune donnée de graphique",
	"widget.progress.emptyDescription":
		"Configurez des données de progression pour afficher ce widget.",
	"widget.progress.emptyTitle": "Aucune progression configurée",
	"widget.quickActions.emptyDescription":
		"Ajoutez des actions rapides à la configuration de votre tableau de bord.",
	"widget.quickActions.emptyTitle": "Aucune action rapide",
	"widget.recentItems.emptyDescription":
		"Les éléments récents apparaîtront ici une fois créés.",
	"widget.recentItems.emptyTitle": "Aucun élément récent",
	"widget.table.emptyDescription":
		"Aucun enregistrement ne correspond aux critères actuels.",
	"widget.table.emptyTitle": "Aucune ligne à afficher",
	"widget.timeline.emptyDescription": "Aucun événement à afficher.",
	"widget.timeline.emptyTitle": "Aucune activité pour le moment",
	"widget.value.emptyDescription":
		"Configurez une source de valeur pour afficher ce widget.",
	"widget.value.emptyTitle": "Aucune valeur configurée",
	"workflow.currentStage": "Étape actuelle",
	"workflow.noTransitions": "Aucune transition disponible depuis cette étape",
	"workflow.scheduleLabel": "Planifier pour plus tard",
	"workflow.scheduledAt": "Date et heure planifiées",
	"workflow.scheduledDescription":
		"La transition se produira automatiquement à l'heure planifiée.",
	"workflow.scheduledSuccess":
		'Transition vers "{{stage}}" planifiée pour {{date}}',
	"workflow.transition": "Transition",
	"workflow.transitionDescription":
		'Cela effectuera la transition de "{{from}}" vers "{{to}}".',
	"workflow.transitionFailed": "Échec de la transition",
	"workflow.transitionSuccess":
		'Transition vers "{{stage}}" effectuée avec succès',
	"workflow.transitionTo": "Transition vers {{stage}}",
} as const;
