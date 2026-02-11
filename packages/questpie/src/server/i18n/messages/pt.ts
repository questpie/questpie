/**
 * Portuguese Backend Messages
 */
export default {
	// General errors
	"error.notFound": "Recurso não encontrado",
	"error.notFound.withId": "{{resource}} não encontrado: {{id}}",
	"error.forbidden": "Acesso negado",
	"error.unauthorized": "Autenticação necessária",
	"error.validation": "Validação falhou",
	"error.internal": "Erro interno do servidor",
	"error.badRequest": "Requisição inválida",
	"error.conflict": "Conflito de recursos",
	"error.notImplemented": "{{feature}} não está implementado",
	"error.timeout": "Tempo de solicitação esgotado",

	// CRUD errors
	"crud.create.forbidden": "Você não tem permissão para criar {{resource}}",
	"crud.read.forbidden": "Você não tem permissão para ler {{resource}}",
	"crud.update.forbidden": "Você não tem permissão para atualizar {{resource}}",
	"crud.delete.forbidden": "Você não tem permissão para excluir {{resource}}",
	"crud.notFound": "{{resource}} não encontrado",

	// Auth errors
	"auth.invalidCredentials": "E-mail ou senha inválidos",
	"auth.sessionExpired": "Sua sessão expirou",
	"auth.tokenInvalid": "Token inválido",
	"auth.tokenExpired": "O token expirou",
	"auth.accountLocked": "A conta está bloqueada",
	"auth.emailNotVerified": "E-mail não verificado",
	"auth.userNotFound": "Usuário não encontrado",
	"auth.userAlreadyExists": "O usuário já existe",

	// Upload errors
	"upload.tooLarge": "O arquivo excede o tamanho máximo de {{maxSize}}",
	"upload.invalidType": "O tipo de arquivo {{type}} não é permitido",
	"upload.failed": "Falha no envio do arquivo",

	// Hook errors
	"hook.beforeCreate.failed": "Validação pré-criação falhou",
	"hook.afterCreate.failed": "Processamento pós-criação falhou",
	"hook.beforeUpdate.failed": "Validação pré-atualização falhou",
	"hook.afterUpdate.failed": "Processamento pós-atualização falhou",
	"hook.beforeDelete.failed": "Validação pré-exclusão falhou",
	"hook.afterDelete.failed": "Processamento pós-exclusão falhou",
	"hook.validate.failed": "Validação personalizada falhou",

	// Access errors
	"access.denied": "Acesso negado",
	"access.fieldDenied": "Acesso negado ao campo {{field}}",
	"access.operationDenied": "A operação {{operation}} não é permitida",

	// Database errors
	"error.database.uniqueViolation": "Duplicado {{field}}: {{value}}",
	"error.database.foreignKeyViolation":
		"{{field}} inválido: o registro referenciado não existe",
	"error.database.notNullViolation": "{{field}} é obrigatório",
	"error.database.checkViolation": "Valor inválido para {{field}}",
} as const;
