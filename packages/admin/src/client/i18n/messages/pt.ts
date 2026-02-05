/**
 * Portuguese Admin UI Messages
 */
export const adminMessagesPT = {
	// Common
	"common.save": "Salvar",
	"common.cancel": "Cancelar",
	"common.delete": "Excluir",
	"common.edit": "Editar",
	"common.create": "Criar",
	"common.add": "Adicionar",
	"common.remove": "Remover",
	"common.close": "Fechar",
	"common.form": "Formulário",
	"common.search": "Pesquisar",
	"common.filter": "Filtrar",
	"common.refresh": "Atualizar",
	"common.loading": "Carregando...",
	"common.confirm": "Confirmar",
	"common.back": "Voltar",
	"common.next": "Próximo",
	"common.previous": "Anterior",
	"common.actions": "Ações",
	"common.more": "Mais",
	"common.yes": "Sim",
	"common.no": "Não",
	"common.ok": "OK",
	"common.apply": "Aplicar",
	"common.reset": "Redefinir",
	"common.clear": "Limpar",
	"common.selectAll": "Selecionar tudo",
	"common.deselectAll": "Desselecionar tudo",
	"common.duplicate": "Duplicar",
	"common.copy": "Copiar",
	"common.paste": "Colar",
	"common.upload": "Enviar",
	"common.download": "Baixar",
	"common.preview": "Visualizar",
	"common.view": "Ver",
	"common.open": "Abrir",
	"common.retry": "Tentar novamente",
	"common.submit": "Enviar",

	// Navigation
	"nav.dashboard": "Painel",
	"nav.collections": "Coleções",
	"nav.globals": "Globais",
	"nav.media": "Mídia",
	"nav.settings": "Configurações",
	"nav.logout": "Sair",
	"nav.home": "Início",
	"nav.back": "Voltar",

	// Dashboard
	"dashboard.title": "Painel",
	"dashboard.welcome": "Bem-vindo de volta",
	"dashboard.recentActivity": "Atividade recente",
	"dashboard.quickActions": "Ações rápidas",

	// Collections
	"collection.create": "Criar {{name}}",
	"collection.edit": "Editar {{name}}",
	"collection.delete": "Excluir {{name}}",
	"collection.deleteConfirm": "Tem certeza de que deseja excluir {{name}}?",
	"collection.noItems": "Nenhum {{name}} encontrado",
	"collection.createFirst": "Crie seu primeiro {{name}}",
	"collection.itemCount": { one: "{{count}} item", other: "{{count}} itens" },
	"collection.bulkDelete": "Excluir selecionados",
	"collection.bulkDeleteConfirm":
		"Tem certeza de que deseja excluir {{count}} itens?",
	"collection.bulkDeleteSuccess": {
		one: "{{count}} item excluído com sucesso",
		other: "{{count}} itens excluídos com sucesso",
	},
	"collection.bulkDeleteError": "Falha ao excluir itens",
	"collection.bulkDeletePartial": {
		one: "{{success}} item excluído, {{failed}} falhou",
		other: "{{success}} itens excluídos, {{failed}} falharam",
	},
	"collection.bulkActionFailed": "Ação em massa falhou",
	"collection.selected": "{{count}} selecionado(s)",
	"collection.selectOnPage": "Todos nesta página",
	"collection.selectAllMatching": "Todos correspondentes ({{count}})",
	"collection.clearSelection": "Limpar seleção",
	"collection.list": "Lista de {{name}}",
	"collection.new": "Novo {{name}}",
	"collection.duplicateSuccess": "{{name}} duplicado com sucesso",
	"collection.duplicateError": "Falha ao duplicar {{name}}",

	// Relations
	"relation.select": "Selecionar {{name}}",
	"relation.clear": "Limpar seleção",
	"relation.search": "Pesquisar {{name}}...",
	"relation.noResults": "Nenhum {{name}} encontrado",
	"relation.loading": "Carregando...",
	"relation.createNew": "Criar novo {{name}}",
	"relation.selected": "{{count}} selecionado(s)",
	"relation.removeItem": "Remover {{name}}",
	"relation.addItem": "Adicionar {{name}}",
	"relation.noneSelected": "Nenhum {{name}} selecionado",
	"relation.noRelated": "Nenhum item relacionado encontrado",
	"relation.saveFirst":
		"Salve este item primeiro para ver os itens relacionados.",

	// Arrays
	"array.empty": "Nenhum {{name}} adicionado ainda",
	"array.addItem": "Adicionar {{name}}",

	// Blocks
	"blocks.addAbove": "Adicionar acima",
	"blocks.addBelow": "Adicionar abaixo",
	"blocks.addChild": "Adicionar bloco filho",

	// Forms
	"form.id": "ID",
	"form.created": "Criado",
	"form.updated": "Atualizado",
	"form.required": "Este campo é obrigatório",
	"form.invalid": "Valor inválido",
	"form.saveChanges": "Salvar alterações",
	"form.unsavedChanges": "Você tem alterações não salvas",
	"form.discardChanges": "Descartar alterações",
	"form.discardConfirm":
		"Tem certeza de que deseja descartar as alterações? Esta ação não pode ser desfeita.",
	"form.fieldRequired": "{{field}} é obrigatório",
	"form.fieldInvalid": "{{field}} é inválido",
	"form.maxLength": "Máximo {{max}} caracteres",
	"form.minLength": "Mínimo {{min}} caracteres",
	"form.maxValue": "Máximo {{max}}",
	"form.minValue": "Mínimo {{min}}",
	"form.pattern": "Formato inválido",
	"form.email": "E-mail inválido",
	"form.url": "URL inválida",
	"form.createSuccess": "{{name}} criado com sucesso",
	"form.createError": "Falha ao criar {{name}}",
	"form.updateSuccess": "{{name}} atualizado com sucesso",
	"form.updateError": "Falha ao atualizar {{name}}",
	"form.deleteSuccess": "{{name}} excluído com sucesso",
	"form.deleteError": "Falha ao excluir {{name}}",

	// Auth
	"auth.login": "Entrar",
	"auth.logout": "Sair",
	"auth.email": "E-mail",
	"auth.password": "Senha",
	"auth.forgotPassword": "Esqueceu a senha?",
	"auth.resetPassword": "Redefinir senha",
	"auth.signIn": "Entrar",
	"auth.signOut": "Sair",
	"auth.signUp": "Cadastrar-se",
	"auth.rememberMe": "Lembrar-me",
	"auth.invalidCredentials": "E-mail ou senha inválidos",
	"auth.sessionExpired": "Sua sessão expirou. Por favor, entre novamente.",
	"auth.emailPlaceholder": "voce@exemplo.com",
	"auth.passwordPlaceholder": "Digite sua senha",
	"auth.signingIn": "Entrando...",
	"auth.creatingAdmin": "Criando administrador...",
	"auth.name": "Nome",
	"auth.namePlaceholder": "Seu nome",
	"auth.confirmPassword": "Confirmar senha",
	"auth.confirmPasswordPlaceholder": "Confirme sua senha",
	"auth.acceptInvite": "Aceitar convite",
	"auth.acceptingInvite": "Aceitando convite...",
	"auth.dontHaveAccount": "Não tem uma conta?",
	"auth.alreadyHaveAccount": "Já tem uma conta?",
	"auth.emailRequired": "E-mail é obrigatório",
	"auth.passwordRequired": "Senha é obrigatória",
	"auth.passwordMinLength": "A senha deve ter pelo menos {{min}} caracteres",
	"auth.nameRequired": "Nome é obrigatório",
	"auth.nameMinLength": "O nome deve ter pelo menos {{min}} caracteres",
	"auth.invalidEmail": "E-mail inválido",
	"auth.passwordMismatch": "As senhas não coincidem",
	"auth.newPassword": "Nova senha",
	"auth.newPasswordPlaceholder": "Digite nova senha",
	"auth.sendResetLink": "Enviar link de redefinição",
	"auth.sendingResetLink": "Enviando...",
	"auth.resetLinkSent": "Link de redefinição de senha enviado para seu e-mail",
	"auth.resettingPassword": "Redefinindo senha...",
	"auth.createFirstAdmin": "Criar primeiro administrador",
	"auth.setupTitle": "Configuração",
	"auth.setupDescription":
		"Crie sua primeira conta de administrador para começar.",
	"auth.profile": "Perfil",
	"auth.myAccount": "Minha conta",
	"auth.logoutFailed": "Falha ao sair. Por favor, tente novamente.",

	// Errors
	"error.notFound": "Não encontrado",
	"error.serverError": "Erro do servidor",
	"error.networkError": "Erro de rede. Verifique sua conexão.",
	"error.unauthorized": "Você não está autorizado a realizar esta ação",
	"error.forbidden": "Acesso negado",
	"error.validation": "Validação falhou",
	"error.unknown": "Ocorreu um erro desconhecido",
	"error.timeout": "Tempo de solicitação esgotado. Tente novamente.",
	"error.conflict": "Ocorreu um conflito. Atualize e tente novamente.",

	// Table
	"table.rowsPerPage": "Linhas por página",
	"table.of": "de",
	"table.noResults": "Sem resultados",
	"table.selectAll": "Selecionar tudo",
	"table.selectRow": "Selecionar linha",
	"table.showing": "Mostrando {{from}} a {{to}} de {{total}}",
	"table.page": "Página {{page}}",
	"table.firstPage": "Primeira página",
	"table.lastPage": "Última página",
	"table.nextPage": "Próxima página",
	"table.previousPage": "Página anterior",
	"table.sortAsc": "Ordenar crescente",
	"table.sortDesc": "Ordenar decrescente",
	"table.columns": "Colunas",
	"table.hideColumn": "Ocultar coluna",
	"table.showColumn": "Mostrar coluna",

	// Upload
	"upload.dropzone": "Arraste arquivos aqui ou clique para enviar",
	"upload.browse": "Procurar arquivos",
	"upload.uploading": "Enviando...",
	"upload.complete": "Envio completo",
	"upload.error": "Falha no envio",
	"upload.maxSize": "O arquivo deve ser menor que {{size}}",
	"upload.invalidType": "Tipo de arquivo inválido. Permitidos: {{types}}",
	"upload.remove": "Remover arquivo",
	"upload.replace": "Substituir arquivo",
	"upload.preview": "Visualizar",
	"upload.noFile": "Nenhum arquivo selecionado",
	"upload.dragDrop": "Arraste e solte arquivos aqui",

	// Editor
	"editor.bold": "Negrito",
	"editor.italic": "Itálico",
	"editor.underline": "Sublinhado",
	"editor.strikethrough": "Tachado",
	"editor.heading": "Título {{level}}",
	"editor.link": "Inserir link",
	"editor.image": "Inserir imagem",
	"editor.list": "Lista",
	"editor.orderedList": "Lista numerada",
	"editor.unorderedList": "Lista com marcadores",
	"editor.quote": "Citação",
	"editor.code": "Código",
	"editor.codeBlock": "Bloco de código",
	"editor.table": "Inserir tabela",
	"editor.undo": "Desfazer",
	"editor.redo": "Refazer",
	"editor.alignLeft": "Alinhar à esquerda",
	"editor.alignCenter": "Centralizar",
	"editor.alignRight": "Alinhar à direita",
	"editor.alignJustify": "Justificar",
	"editor.horizontalRule": "Linha horizontal",
	"editor.addRowBefore": "Adicionar linha antes",
	"editor.addRowAfter": "Adicionar linha depois",
	"editor.addColumnBefore": "Adicionar coluna antes",
	"editor.addColumnAfter": "Adicionar coluna depois",
	"editor.deleteRow": "Excluir linha",
	"editor.deleteColumn": "Excluir coluna",
	"editor.deleteTable": "Excluir tabela",
	"editor.toggleHeaderRow": "Alternar linha de cabeçalho",
	"editor.toggleHeaderColumn": "Alternar coluna de cabeçalho",
	"editor.mergeCells": "Mesclar células",
	"editor.splitCell": "Dividir célula",
	"editor.insertUrl": "Inserir URL",
	"editor.altText": "Texto alternativo (opcional)",
	"editor.uploadFile": "Enviar arquivo",
	"editor.chooseFile": "Escolher arquivo",
	"editor.uploading": "Enviando...",
	"editor.browseLibrary": "Procurar na biblioteca",

	// Toasts
	"toast.success": "Sucesso",
	"toast.error": "Erro",
	"toast.warning": "Aviso",
	"toast.info": "Informação",
	"toast.saving": "Salvando...",
	"toast.saveFailed": "Falha ao salvar alterações",
	"toast.saveSuccess": "Alterações salvas com sucesso",
	"toast.creating": "Criando...",
	"toast.createSuccess": "Criado com sucesso",
	"toast.createFailed": "Falha ao criar",
	"toast.deleting": "Excluindo...",
	"toast.deleteFailed": "Falha ao excluir",
	"toast.deleteSuccess": "Excluído com sucesso",
	"toast.loadFailed": "Falha ao carregar dados",
	"toast.uploadFailed": "Falha ao enviar arquivo",
	"toast.uploadSuccess": "Arquivo enviado com sucesso",
	"toast.copySuccess": "Copiado para a área de transferência",
	"toast.copyFailed": "Falha ao copiar para a área de transferência",
	"toast.idCopied": "ID copiado para a área de transferência",
	"toast.validationFailed": "Validação falhou",
	"toast.validationDescription": "Por favor, verifique o formulário por erros",
	"toast.created": "{{name}} criado",
	"toast.updated": "{{name}} atualizado",
	"toast.resourceSaveFailed": "Falha ao salvar {{name}}",
	"toast.editComingSoon": "Funcionalidade de edição em breve",
	"toast.maxFilesWarning":
		"Apenas {{remaining}} arquivo(s) adicional(is) pode(m) ser adicionado(s) (máx {{max}})",
	"toast.settingsSaveFailed": "Falha ao salvar configurações",
	"toast.actionSuccess": "Ação concluída com sucesso",
	"toast.actionFailed": "Ação falhou",
	"toast.localeChangedUnsaved": "Idioma do conteúdo alterado",
	"toast.localeChangedUnsavedDescription":
		"Suas alterações não salvas foram substituídas pelo conteúdo no novo idioma.",

	// Confirm
	"confirm.delete":
		"Tem certeza de que deseja excluir isto? Esta ação não pode ser desfeita.",
	"confirm.discard":
		"Tem certeza de que deseja descartar as alterações? Esta ação não pode ser desfeita.",
	"confirm.unsavedChanges":
		"Você tem alterações não salvas. Tem certeza de que deseja sair?",
	"confirm.action": "Tem certeza de que deseja continuar?",
	"confirm.irreversible": "Esta ação não pode ser desfeita.",
	"confirm.localeChange": "Descartar alterações não salvas?",
	"confirm.localeChangeDescription":
		"Você tem alterações não salvas. Mudar o idioma do conteúdo descartará suas alterações e carregará o conteúdo no novo idioma.",
	"confirm.localeChangeStay": "Ficar",
	"confirm.localeChangeDiscard": "Descartar e mudar",

	// Status
	"status.draft": "Rascunho",
	"status.published": "Publicado",
	"status.archived": "Arquivado",
	"status.pending": "Pendente",
	"status.active": "Ativo",
	"status.inactive": "Inativo",

	// Dates
	"date.today": "Hoje",
	"date.yesterday": "Ontem",
	"date.tomorrow": "Amanhã",
	"date.selectDate": "Selecionar data",
	"date.selectTime": "Selecionar hora",
	"date.clear": "Limpar data",

	// Accessibility
	"a11y.openMenu": "Abrir menu",
	"a11y.closeMenu": "Fechar menu",
	"a11y.expand": "Expandir",
	"a11y.collapse": "Recolher",
	"a11y.loading": "Carregando",
	"a11y.required": "Obrigatório",
	"a11y.optional": "Opcional",
	"a11y.selected": "Selecionado",
	"a11y.notSelected": "Não selecionado",

	// Locale
	"locale.language": "Idioma",
	"locale.switchLanguage": "Mudar idioma",
	"locale.contentLanguage": "Idioma do conteúdo",
	"locale.uiLanguage": "Idioma da interface",

	// ===========================================
	// Default Collections
	// ===========================================

	// Users Collection
	"defaults.users.label": "Usuários",
	"defaults.users.description":
		"Gerenciar usuários administradores e suas funções",
	"defaults.users.fields.name.label": "Nome",
	"defaults.users.fields.name.placeholder": "Digite o nome do usuário",
	"defaults.users.fields.email.label": "E-mail",
	"defaults.users.fields.email.description":
		"Endereço de e-mail (somente leitura)",
	"defaults.users.fields.role.label": "Função",
	"defaults.users.fields.role.options.admin": "Administrador",
	"defaults.users.fields.role.options.user": "Usuário",
	"defaults.users.fields.emailVerified.label": "E-mail verificado",
	"defaults.users.fields.emailVerified.description":
		"Se o usuário verificou seu endereço de e-mail",
	"defaults.users.fields.banned.label": "Banido",
	"defaults.users.fields.banned.description":
		"Impedir que o usuário acesse o sistema",
	"defaults.users.fields.banReason.label": "Motivo do banimento",
	"defaults.users.fields.banReason.placeholder":
		"Digite o motivo do banimento...",
	"defaults.users.sections.basicInfo": "Informações básicas",
	"defaults.users.sections.permissions": "Permissões",
	"defaults.users.sections.accessControl": "Controle de acesso",
	"defaults.users.actions.createUser.label": "Criar usuário",
	"defaults.users.actions.createUser.title": "Criar usuário",
	"defaults.users.actions.createUser.description":
		"Criar uma nova conta de usuário com credenciais de login.",
	"defaults.users.actions.createUser.fields.password.label": "Senha",
	"defaults.users.actions.createUser.fields.password.placeholder":
		"Digite a senha",
	"defaults.users.actions.createUser.submit": "Criar usuário",
	"defaults.users.actions.createUser.success":
		"Usuário {{email}} criado com sucesso. Compartilhe as credenciais com o usuário.",
	"defaults.users.actions.createUser.errorNoAuth":
		"Cliente de autenticação não configurado. Não é possível criar usuário.",
	"defaults.users.actions.resetPassword.label": "Redefinir senha",
	"defaults.users.actions.resetPassword.title": "Redefinir senha",
	"defaults.users.actions.resetPassword.description":
		"Definir uma nova senha para este usuário.",
	"defaults.users.actions.resetPassword.fields.newPassword.label": "Nova senha",
	"defaults.users.actions.resetPassword.fields.newPassword.placeholder":
		"Digite nova senha",
	"defaults.users.actions.resetPassword.fields.confirmPassword.label":
		"Confirmar senha",
	"defaults.users.actions.resetPassword.fields.confirmPassword.placeholder":
		"Confirme nova senha",
	"defaults.users.actions.resetPassword.submit": "Redefinir senha",
	"defaults.users.actions.resetPassword.success":
		"Senha redefinida com sucesso!",
	"defaults.users.actions.resetPassword.errorMismatch":
		"As senhas não coincidem",
	"defaults.users.actions.delete.label": "Excluir usuário",

	// Assets Collection
	"defaults.assets.label": "Mídia",
	"defaults.assets.description": "Gerenciar arquivos e imagens enviados",
	"defaults.assets.fields.preview.label": "Visualização",
	"defaults.assets.fields.filename.label": "Nome do arquivo",
	"defaults.assets.fields.filename.description":
		"Nome original do arquivo enviado",
	"defaults.assets.fields.mimeType.label": "Tipo",
	"defaults.assets.fields.mimeType.description": "Tipo MIME do arquivo",
	"defaults.assets.fields.size.label": "Tamanho (bytes)",
	"defaults.assets.fields.size.description": "Tamanho do arquivo em bytes",
	"defaults.assets.fields.alt.label": "Texto alternativo",
	"defaults.assets.fields.alt.placeholder":
		"Descreva a imagem para acessibilidade",
	"defaults.assets.fields.alt.description":
		"Texto alternativo para leitores de tela",
	"defaults.assets.fields.caption.label": "Legenda",
	"defaults.assets.fields.caption.placeholder": "Adicionar uma legenda...",
	"defaults.assets.fields.visibility.label": "Visibilidade",
	"defaults.assets.fields.visibility.options.public": "Público",
	"defaults.assets.fields.visibility.options.private": "Privado",
	"defaults.assets.fields.visibility.description":
		"Arquivos públicos são acessíveis sem autenticação. Arquivos privados requerem uma URL assinada.",
	"defaults.assets.sections.fileInfo": "Informações do arquivo",
	"defaults.assets.sections.metadata": "Metadados",
	"defaults.assets.sections.metadata.description":
		"Adicione informações descritivas para acessibilidade e SEO",
	"defaults.assets.actions.upload.label": "Enviar arquivos",

	// Default Sidebar
	"defaults.sidebar.administration": "Administração",

	// View Options (Filter Builder)
	"viewOptions.title": "Opções de visualização",
	"viewOptions.columns": "Colunas",
	"viewOptions.filters": "Filtros",
	"viewOptions.savedViews": "Visualizações salvas",
	"viewOptions.apply": "Aplicar",
	"viewOptions.reset": "Redefinir",

	// Saved Views Tab
	"viewOptions.saveCurrentConfig": "Salvar configuração atual",
	"viewOptions.viewNamePlaceholder": "Nome da visualização...",
	"viewOptions.saveDescription": "Salva as colunas, filtros e ordem atuais.",
	"viewOptions.noChangesToSave":
		"Nenhum filtro ou mudança de colunas para salvar.",
	"viewOptions.noSavedViews": "Ainda não há visualizações salvas.",
	"viewOptions.filtersCount": {
		one: "{{count}} filtro",
		other: "{{count}} filtros",
	},
	"viewOptions.columnsCount": { one: "{{count}} col", other: "{{count}} cols" },
	"viewOptions.defaultView": "Padrão",

	// Columns Tab
	"viewOptions.columnsDragHint":
		"Arraste para reordenar, alterne para mostrar/ocultar colunas.",
	"viewOptions.noFieldsAvailable": "Nenhum campo disponível.",

	// Filters Tab
	"viewOptions.filtersDescription":
		"Refine seus resultados com regras personalizadas.",
	"viewOptions.filterNumber": "Filtro #{{number}}",
	"viewOptions.selectField": "Selecionar campo",
	"viewOptions.selectOperator": "Selecionar operador",
	"viewOptions.valuePlaceholder": "Valor...",
	"viewOptions.noActiveFilters": "Nenhum filtro ativo.",
	"viewOptions.addFilter": "Adicionar filtro",
	"viewOptions.clearAll": "Limpar tudo",
	"viewOptions.activeFilters": {
		one: "{{count}} filtro ativo",
		other: "{{count}} filtros ativos",
	},
	"viewOptions.clearFilters": "Limpar filtros",

	// Filter Operators
	"filter.contains": "Contém",
	"filter.notContains": "Não contém",
	"filter.equals": "Igual a",
	"filter.notEquals": "Diferente de",
	"filter.startsWith": "Começa com",
	"filter.endsWith": "Termina com",
	"filter.greaterThan": "Maior que",
	"filter.greaterThanOrEqual": "Maior ou igual a",
	"filter.lessThan": "Menor que",
	"filter.lessThanOrEqual": "Menor ou igual a",
	"filter.in": "É qualquer um de",
	"filter.notIn": "Não é nenhum de",
	"filter.some": "Tem algum",
	"filter.every": "Tem todos",
	"filter.none": "Não tem nenhum",
	"filter.isEmpty": "Está vazio",
	"filter.isNotEmpty": "Não está vazio",

	// Preview
	"preview.show": "Visualizar",
	"preview.hide": "Ocultar visualização",
	"preview.title": "Visualização",
	"preview.livePreview": "Visualização ao vivo",
	"preview.fullscreen": "Tela cheia",
	"preview.close": "Fechar visualização",
	"preview.loading": "Carregando visualização...",

	// Autosave
	"autosave.saving": "Salvando...",
	"autosave.saved": "Salvo",
	"autosave.unsavedChanges": "Alterações não salvas",
	"autosave.justNow": "agora mesmo",
	"autosave.secondsAgo": { one: "{{count}}s atrás", other: "{{count}}s atrás" },
	"autosave.minutesAgo": { one: "{{count}}m atrás", other: "{{count}}m atrás" },
	"autosave.hoursAgo": { one: "{{count}}h atrás", other: "{{count}}h atrás" },

	// Global Search
	"globalSearch.placeholder":
		"Pesquisar coleções, globais, ações, registros...",
	"globalSearch.collections": "Coleções",
	"globalSearch.globals": "Globais",
	"globalSearch.quickActions": "Ações rápidas",
	"globalSearch.records": "Registros",
	"globalSearch.createNew": "Criar novo {{name}}",
	"globalSearch.noResults": "Nenhum resultado encontrado",
	"globalSearch.searching": "Pesquisando...",
	"globalSearch.navigate": "para navegar",
	"globalSearch.select": "para selecionar",

	// Collection Search
	"collectionSearch.placeholder": "Pesquisar registros...",
	"collectionSearch.noResults": "Nenhum registro correspondente encontrado",
	"collectionSearch.searching": "Pesquisando...",
} as const;
