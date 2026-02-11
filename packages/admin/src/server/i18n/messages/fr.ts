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
} as const;
