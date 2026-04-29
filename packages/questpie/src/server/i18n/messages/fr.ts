/**
 * French Backend Messages
 */
export default {
	// General errors
	"error.notFound": "Ressource non trouvée",
	"error.notFound.withId": "{{resource}} non trouvé(e) : {{id}}",
	"error.forbidden": "Accès refusé",
	"error.unauthorized": "Authentification requise",
	"error.validation": "Validation échouée",
	"error.internal": "Erreur interne du serveur",
	"error.badRequest": "Requête incorrecte",
	"error.invalidJsonBody": "Corps JSON invalide",
	"error.methodNotAllowed": "Méthode non autorisée",
	"error.methodNotAllowed.useMethod":
		"Méthode non autorisée. Utilisez {{method}}.",
	"error.missingRequiredField": "Champ obligatoire manquant : {{field}}",
	"error.invalidDateField": "Date {{field}} invalide",
	"error.updatesMustBeArray": "updates doit être un tableau",
	"error.versionRequired": "Version ou versionId requis",
	"error.conflict": "Conflit de ressources",
	"error.notImplemented": "{{feature}} n'est pas implémenté",
	"error.timeout": "Délai de demande dépassé",

	// CRUD errors
	"crud.create.forbidden":
		"Vous n'avez pas la permission de créer {{resource}}",
	"crud.read.forbidden": "Vous n'avez pas la permission de lire {{resource}}",
	"crud.update.forbidden":
		"Vous n'avez pas la permission de mettre à jour {{resource}}",
	"crud.delete.forbidden":
		"Vous n'avez pas la permission de supprimer {{resource}}",
	"crud.notFound": "{{resource}} non trouvé(e)",

	// Auth errors
	"auth.invalidCredentials": "E-mail ou mot de passe invalide",
	"auth.sessionExpired": "Votre session a expiré",
	"auth.tokenInvalid": "Token invalide",
	"auth.tokenExpired": "Le token a expiré",
	"auth.accountLocked": "Le compte est verrouillé",
	"auth.emailNotVerified": "E-mail non vérifié",
	"auth.userNotFound": "Utilisateur non trouvé",
	"auth.userAlreadyExists": "L'utilisateur existe déjà",

	// Upload errors
	"upload.tooLarge": "Le fichier dépasse la taille maximale de {{maxSize}}",
	"upload.invalidType": "Le type de fichier {{type}} n'est pas autorisé",
	"upload.failed": "Échec du téléversement du fichier",
	"upload.noFileUploaded":
		"Aucun fichier téléversé. Envoyez 'file' dans form-data.",
	"upload.collectionNotSupported":
		'La collection "{{collection}}" ne prend pas en charge le téléversement de fichiers. Activez-le avec .upload().',
	"upload.collectionServeNotSupported":
		'La collection "{{collection}}" ne prend pas en charge la diffusion de fichiers. Activez-la avec .upload().',
	"upload.methodNotAvailable":
		'Méthode de téléversement indisponible pour la collection "{{collection}}"',
	"upload.tokenRequired": "Un token est requis pour les fichiers privés",
	"upload.tokenInvalid": "Token invalide ou expiré",
	"upload.tokenMismatch": "Le token ne correspond pas au fichier demandé",
	"upload.fileKeyNotSpecified": "Clé de fichier non spécifiée",
	"upload.extensionNotAllowed":
		'L’extension de fichier "{{extension}}" n’est pas autorisée',

	// Search errors
	"search.serviceNotConfigured": "Le service de recherche n'est pas configuré",
	"search.reindexAccessDenied":
		"Accès à la réindexation refusé par la politique",

	// Realtime errors
	"realtime.topicsRequired":
		"Le tableau topics est requis et ne doit pas être vide",
	"realtime.topicIdRequired": "L’ID du topic est requis",
	"realtime.resourceRequired": "resourceType et resource sont requis",
	"realtime.collectionNotFound": 'Collection "{{collection}}" introuvable',
	"realtime.globalNotFound": 'Global "{{global}}" introuvable',
	"realtime.invalidResourceType": 'resourceType "{{resourceType}}" invalide',
	"realtime.noValidTopics": "Aucun topic valide fourni. Erreurs : {{errors}}",

	// Hook errors
	"hook.beforeCreate.failed": "Validation pré-création échouée",
	"hook.afterCreate.failed": "Traitement post-création échoué",
	"hook.beforeUpdate.failed": "Validation pré-mise à jour échouée",
	"hook.afterUpdate.failed": "Traitement post-mise à jour échoué",
	"hook.beforeDelete.failed": "Validation pré-suppression échouée",
	"hook.afterDelete.failed": "Traitement post-suppression échoué",
	"hook.validate.failed": "Validation personnalisée échouée",

	// Access errors
	"access.denied": "Accès refusé",
	"access.fieldDenied": "Accès refusé au champ {{field}}",
	"access.operationDenied": "L'opération {{operation}} n'est pas autorisée",

	// Database errors
	"error.database.uniqueViolation": "Doublon {{field}} : {{value}}",
	"error.database.uniqueViolation.field":
		"Un enregistrement avec ce {{field}} existe déjà",
	"error.database.foreignKeyViolation":
		"{{field}} invalide : l'enregistrement référencé n'existe pas",
	"error.database.foreignKeyViolation.field":
		"L'enregistrement référencé n'existe pas",
	"error.database.notNullViolation": "{{field}} est obligatoire",
	"error.database.notNullViolation.field": "{{field}} est obligatoire",
	"error.database.checkViolation": "Valeur invalide pour {{field}}",
	"error.database.checkViolation.field": "Valeur invalide pour {{field}}",
} as const;
