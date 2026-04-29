/**
 * Spanish Admin UI Messages
 */
export default {
	// Common
	"common.save": "Guardar",
	"common.cancel": "Cancelar",
	"common.delete": "Eliminar",
	"common.edit": "Editar",
	"common.create": "Crear",
	"common.add": "Añadir",
	"common.remove": "Eliminar",
	"common.close": "Cerrar",
	"common.form": "Formulario",
	"common.search": "Buscar",
	"common.filter": "Filtrar",
	"common.refresh": "Actualizar",
	"common.loading": "Cargando...",
	"common.confirm": "Confirmar",
	"common.back": "Atrás",
	"common.next": "Siguiente",
	"common.previous": "Anterior",
	"common.actions": "Acciones",
	"common.more": "Más",
	"common.yes": "Sí",
	"common.no": "No",
	"common.ok": "OK",
	"common.apply": "Aplicar",
	"common.reset": "Restablecer",
	"common.clear": "Limpiar",
	"common.selectAll": "Seleccionar todo",
	"common.deselectAll": "Deseleccionar todo",
	"common.duplicate": "Duplicar",
	"common.copy": "Copiar",
	"common.paste": "Pegar",
	"common.upload": "Subir",
	"common.download": "Descargar",
	"common.preview": "Vista previa",
	"common.view": "Ver",
	"common.open": "Abrir",
	"common.retry": "Reintentar",
	"common.submit": "Enviar",

	// Navigation
	"nav.dashboard": "Panel",
	"nav.collections": "Colecciones",
	"nav.globals": "Globales",
	"nav.media": "Medios",
	"nav.settings": "Configuración",
	"nav.logout": "Cerrar sesión",
	"nav.home": "Inicio",
	"nav.back": "Atrás",

	// Dashboard
	"dashboard.title": "Panel",
	"dashboard.welcome": "Bienvenido de nuevo",
	"dashboard.recentActivity": "Actividad reciente",
	"dashboard.quickActions": "Acciones rápidas",

	// Collections
	"collection.create": "Crear {{name}}",
	"collection.edit": "Editar {{name}}",
	"collection.delete": "Eliminar {{name}}",
	"collection.deleteConfirm": "¿Está seguro de que desea eliminar {{name}}?",
	"collection.noItems": "No se encontraron {{name}}",
	"collection.createFirst": "Cree su primer {{name}}",
	"collection.itemCount": {
		one: "{{count}} elemento",
		other: "{{count}} elementos",
	},
	"collection.bulkDelete": "Eliminar seleccionados",
	"collection.bulkDeleteConfirm":
		"¿Está seguro de que desea eliminar {{count}} elementos?",
	"collection.bulkDeleteSuccess": {
		one: "{{count}} elemento eliminado correctamente",
		other: "{{count}} elementos eliminados correctamente",
	},
	"collection.bulkDeleteError": "Error al eliminar elementos",
	"collection.bulkDeletePartial": {
		one: "{{success}} elemento eliminado, {{failed}} fallido",
		other: "{{success}} elementos eliminados, {{failed}} fallidos",
	},
	"collection.bulkActionFailed": "Acción masiva fallida",
	"collection.selected": "{{count}} seleccionados",
	"collection.selectOnPage": "Todos en esta página",
	"collection.selectAllMatching": "Todos los que coinciden ({{count}})",
	"collection.clearSelection": "Limpiar selección",
	"collection.list": "Lista de {{name}}",
	"collection.new": "Nuevo {{name}}",
	"collection.duplicateSuccess": "{{name}} duplicado correctamente",
	"collection.duplicateError": "Error al duplicar {{name}}",
	// Actions
	"action.collectionNotFound": 'Colección "{{collection}}" no encontrada',
	"action.notFound":
		'Acción "{{action}}" no encontrada en la colección "{{collection}}"',
	"action.executionFailed": "La ejecución de la acción falló",
	"action.itemCreated": "Elemento creado correctamente",
	"action.itemIdRequired.save": "Se requiere el ID del elemento para guardar",
	"action.itemSaved": "Elemento guardado correctamente",
	"action.itemIdRequired.delete":
		"Se requiere el ID del elemento para eliminar",
	"action.itemDeleted": "Elemento eliminado correctamente",
	"action.itemIdsRequired.bulkDelete":
		"Se requieren IDs de elementos para la eliminación masiva",
	"action.itemsDeleted": {
		one: "{{count}} elemento eliminado correctamente",
		other: "{{count}} elementos eliminados correctamente",
	},
	"action.itemIdRequired.restore":
		"Se requiere el ID del elemento para restaurar",
	"action.restoreUnsupported":
		"La restauración no es compatible con esta colección",
	"action.itemRestored": "Elemento restaurado correctamente",
	"action.itemIdsRequired.bulkRestore":
		"Se requieren IDs de elementos para la restauración masiva",
	"action.itemsRestored": {
		one: "{{count}} elemento restaurado correctamente",
		other: "{{count}} elementos restaurados correctamente",
	},
	"action.itemIdRequired.duplicate":
		"Se requiere el ID del elemento para duplicar",
	"action.itemNotFound": "Elemento no encontrado",
	"action.itemDuplicated": "Elemento duplicado correctamente",
	"action.itemIdRequired.transition":
		"Se requiere el ID del elemento para la transición",
	"action.targetStageRequired":
		"Se requiere la etapa de destino para la transición",
	"action.workflowUnsupported":
		"Las transiciones de workflow no son compatibles con esta colección",
	"action.unknownBuiltin": "Acción integrada desconocida: {{action}}",
	"action.fieldRequired": 'El campo "{{field}}" es obligatorio',

	// Relations
	"relation.select": "Seleccionar {{name}}",
	"relation.clear": "Limpiar selección",
	"relation.search": "Buscar {{name}}...",
	"relation.noResults": "No se encontraron {{name}}",
	"relation.loading": "Cargando...",
	"relation.createNew": "Crear nuevo {{name}}",
	"relation.selected": "{{count}} seleccionados",
	"relation.removeItem": "Eliminar {{name}}",
	"relation.addItem": "Añadir {{name}}",
	"relation.noneSelected": "Ningún {{name}} seleccionado",
	"relation.noRelated": "No se encontraron elementos relacionados",
	"relation.saveFirst":
		"Guarde este elemento primero para ver los elementos relacionados.",

	// Arrays
	"array.empty": "Aún no se han añadido {{name}}",
	"array.addItem": "Añadir {{name}}",

	// Blocks
	"blocks.addAbove": "Añadir arriba",
	"blocks.addBelow": "Añadir abajo",
	"blocks.addChild": "Añadir bloque hijo",

	// Forms
	"form.id": "ID",
	"form.created": "Creado",
	"form.updated": "Actualizado",
	"form.required": "Este campo es obligatorio",
	"form.invalid": "Valor inválido",
	"form.saveChanges": "Guardar cambios",
	"form.unsavedChanges": "Tiene cambios sin guardar",
	"form.discardChanges": "Descartar cambios",
	"form.discardConfirm":
		"¿Está seguro de que desea descartar los cambios? Esta acción no se puede deshacer.",
	"form.fieldRequired": "{{field}} es obligatorio",
	"form.fieldInvalid": "{{field}} es inválido",
	"form.maxLength": "Máximo {{max}} caracteres",
	"form.minLength": "Mínimo {{min}} caracteres",
	"form.maxValue": "Máximo {{max}}",
	"form.minValue": "Mínimo {{min}}",
	"form.pattern": "Formato inválido",
	"form.email": "Correo electrónico inválido",
	"form.url": "URL inválida",
	"form.createSuccess": "{{name}} creado correctamente",
	"form.createError": "Error al crear {{name}}",
	"form.updateSuccess": "{{name}} actualizado correctamente",
	"form.updateError": "Error al actualizar {{name}}",
	"form.deleteSuccess": "{{name}} eliminado correctamente",
	"form.deleteError": "Error al eliminar {{name}}",

	// Auth
	"auth.login": "Iniciar sesión",
	"auth.logout": "Cerrar sesión",
	"auth.email": "Correo electrónico",
	"auth.password": "Contraseña",
	"auth.forgotPassword": "¿Olvidó su contraseña?",
	"auth.resetPassword": "Restablecer contraseña",
	"auth.signIn": "Iniciar sesión",
	"auth.signOut": "Cerrar sesión",
	"auth.signUp": "Registrarse",
	"auth.rememberMe": "Recordarme",
	"auth.invalidCredentials": "Correo electrónico o contraseña inválidos",
	"auth.sessionExpired":
		"Su sesión ha expirado. Por favor, inicie sesión nuevamente.",
	"auth.emailPlaceholder": "usted@ejemplo.com",
	"auth.passwordPlaceholder": "Ingrese su contraseña",
	"auth.signingIn": "Iniciando sesión...",
	"auth.creatingAdmin": "Creando administrador...",
	"auth.name": "Nombre",
	"auth.namePlaceholder": "Su nombre",
	"auth.confirmPassword": "Confirmar contraseña",
	"auth.confirmPasswordPlaceholder": "Confirme su contraseña",
	"auth.acceptInvite": "Aceptar invitación",
	"auth.acceptingInvite": "Aceptando invitación...",
	"auth.dontHaveAccount": "¿No tiene una cuenta?",
	"auth.alreadyHaveAccount": "¿Ya tiene una cuenta?",
	"auth.emailRequired": "El correo electrónico es obligatorio",
	"auth.passwordRequired": "La contraseña es obligatoria",
	"auth.passwordMinLength":
		"La contraseña debe tener al menos {{min}} caracteres",
	"auth.nameRequired": "El nombre es obligatorio",
	"auth.nameMinLength": "El nombre debe tener al menos {{min}} caracteres",
	"auth.invalidEmail": "Correo electrónico inválido",
	"auth.passwordMismatch": "Las contraseñas no coinciden",
	"auth.newPassword": "Nueva contraseña",
	"auth.newPasswordPlaceholder": "Ingrese nueva contraseña",
	"auth.sendResetLink": "Enviar enlace de restablecimiento",
	"auth.sendingResetLink": "Enviando...",
	"auth.resetLinkSent":
		"Enlace de restablecimiento de contraseña enviado a su correo",
	"auth.resettingPassword": "Restableciendo contraseña...",
	"auth.createFirstAdmin": "Crear primer administrador",
	"auth.setupTitle": "Configuración",
	"auth.setupDescription":
		"Cree su primera cuenta de administrador para comenzar.",
	"auth.profile": "Perfil",
	"auth.myAccount": "Mi cuenta",
	"auth.logoutFailed": "Error al cerrar sesión. Por favor, intente nuevamente.",
	"auth.setupAlreadyCompleted":
		"La configuración ya se completó: existen usuarios administradores en el sistema",
	"auth.failedToCreateUserAccount": "No se pudo crear la cuenta de usuario",

	// Errors
	"error.notFound": "No encontrado",
	"error.serverError": "Error del servidor",
	"error.networkError": "Error de red. Por favor, verifique su conexión.",
	"error.unauthorized": "No está autorizado para realizar esta acción",
	"error.forbidden": "Acceso denegado",
	"error.validation": "Validación fallida",
	"error.unknown": "Ocurrió un error desconocido",
	"error.timeout": "Tiempo de espera agotado. Por favor, intente nuevamente.",
	"error.conflict":
		"Ocurrió un conflicto. Por favor, actualice e intente nuevamente.",

	// Table
	"table.rowsPerPage": "Filas por página",
	"table.of": "de",
	"table.noResults": "Sin resultados",
	"table.selectAll": "Seleccionar todo",
	"table.selectRow": "Seleccionar fila",
	"table.showing": "Mostrando {{from}} a {{to}} de {{total}}",
	"table.page": "Página {{page}}",
	"table.firstPage": "Primera página",
	"table.lastPage": "Última página",
	"table.nextPage": "Siguiente página",
	"table.previousPage": "Página anterior",
	"table.sortAsc": "Ordenar ascendente",
	"table.sortDesc": "Ordenar descendente",
	"table.columns": "Columnas",
	"table.hideColumn": "Ocultar columna",
	"table.showColumn": "Mostrar columna",

	// Upload
	"upload.dropzone": "Arrastre archivos aquí o haga clic para subir",
	"upload.browse": "Explorar archivos",
	"upload.uploading": "Subiendo...",
	"upload.complete": "Carga completa",
	"upload.error": "Error al cargar",
	"upload.maxSize": "El archivo debe ser menor que {{size}}",
	"upload.invalidType": "Tipo de archivo inválido. Permitidos: {{types}}",
	"upload.remove": "Eliminar archivo",
	"upload.replace": "Reemplazar archivo",
	"upload.preview": "Vista previa",
	"upload.noFile": "Ningún archivo seleccionado",
	"upload.dragDrop": "Arrastre y suelte archivos aquí",

	// Editor
	"editor.bold": "Negrita",
	"editor.italic": "Cursiva",
	"editor.underline": "Subrayado",
	"editor.strikethrough": "Tachado",
	"editor.heading": "Encabezado {{level}}",
	"editor.richTextToolbar": "Barra de texto enriquecido",
	"editor.blockType": "Tipo de bloque",
	"editor.selectionBlockType": "Tipo de bloque seleccionado",
	"editor.paragraph": "Párrafo",
	"editor.textBlocks": "Bloques de texto",
	"editor.headings": "Encabezados",
	"editor.blocks": "Bloques",
	"editor.formatting": "Formato",
	"editor.moreFormatting": "Más formato",
	"editor.alignment": "Alineación",
	"editor.insert": "Insertar",
	"editor.link": "Insertar enlace",
	"editor.image": "Insertar imagen",
	"editor.list": "Lista",
	"editor.orderedList": "Lista numerada",
	"editor.unorderedList": "Lista con viñetas",
	"editor.quote": "Cita",
	"editor.code": "Código",
	"editor.codeBlock": "Bloque de código",
	"editor.table": "Insertar tabla",
	"editor.undo": "Deshacer",
	"editor.redo": "Rehacer",
	"editor.alignLeft": "Alinear a la izquierda",
	"editor.alignCenter": "Centrar",
	"editor.alignRight": "Alinear a la derecha",
	"editor.alignJustify": "Justificar",
	"editor.horizontalRule": "Regla horizontal",
	"editor.addRowBefore": "Añadir fila antes",
	"editor.addRowAfter": "Añadir fila después",
	"editor.addColumnBefore": "Añadir columna antes",
	"editor.addColumnAfter": "Añadir columna después",
	"editor.deleteRow": "Eliminar fila",
	"editor.deleteColumn": "Eliminar columna",
	"editor.deleteTable": "Eliminar tabla",
	"editor.toggleHeaderRow": "Alternar fila de encabezado",
	"editor.toggleHeaderColumn": "Alternar columna de encabezado",
	"editor.mergeCells": "Combinar celdas",
	"editor.splitCell": "Dividir celda",
	"editor.insertUrl": "Insertar URL",
	"editor.altText": "Texto alternativo (opcional)",
	"editor.uploadFile": "Subir archivo",
	"editor.chooseFile": "Elegir archivo",
	"editor.uploading": "Subiendo...",
	"editor.browseLibrary": "Explorar biblioteca",
	"editor.startWriting": "Empieza a escribir...",
	"editor.pasteOrTypeLink": "Pega o escribe un enlace...",
	"editor.paragraphDescription": "Empieza con texto simple",
	"editor.heading1Description": "Encabezado de sección grande",
	"editor.heading2Description": "Encabezado de sección medio",
	"editor.heading3Description": "Encabezado de sección pequeño",
	"editor.bulletListDescription": "Crear una lista con viñetas",
	"editor.orderedListDescription": "Crear una lista numerada",
	"editor.quoteDescription": "Insertar una cita",
	"editor.codeBlockDescription": "Insertar fragmento de código",
	"editor.dividerDescription": "Insertar una línea horizontal",
	"editor.tableDescription": "Insertar una tabla 3x3",

	// Toasts
	"toast.success": "Éxito",
	"toast.error": "Error",
	"toast.warning": "Advertencia",
	"toast.info": "Información",
	"toast.saving": "Guardando...",
	"toast.saveFailed": "Error al guardar cambios",
	"toast.saveSuccess": "Cambios guardados correctamente",
	"toast.creating": "Creando...",
	"toast.createSuccess": "Creado correctamente",
	"toast.createFailed": "Error al crear",
	"toast.deleting": "Eliminando...",
	"toast.deleteFailed": "Error al eliminar",
	"toast.deleteSuccess": "Eliminado correctamente",
	"toast.loadFailed": "Error al cargar datos",
	"toast.uploadFailed": "Error al subir archivo",
	"toast.uploadSuccess": "Archivo subido correctamente",
	"toast.copySuccess": "Copiado al portapapeles",
	"toast.copyFailed": "Error al copiar al portapapeles",
	"toast.idCopied": "ID copiado al portapapeles",
	"toast.validationFailed": "Validación fallida",
	"toast.validationDescription":
		"Por favor, verifique el formulario en busca de errores",
	"toast.created": "{{name}} creado",
	"toast.updated": "{{name}} actualizado",
	"toast.resourceSaveFailed": "Error al guardar {{name}}",
	"toast.editComingSoon": "Función de edición próximamente disponible",
	"toast.maxFilesWarning":
		"Solo puede añadir {{remaining}} archivo(s) más (máx {{max}})",
	"toast.settingsSaveFailed": "Error al guardar configuración",
	"toast.actionSuccess": "Acción completada correctamente",
	"toast.actionFailed": "Acción fallida",
	"toast.localeChangedUnsaved": "Idioma de contenido cambiado",
	"toast.localeChangedUnsavedDescription":
		"Sus cambios sin guardar fueron reemplazados por el contenido en el nuevo idioma.",

	// Confirm
	"confirm.delete":
		"¿Está seguro de que desea eliminar esto? Esta acción no se puede deshacer.",
	"confirm.discard":
		"¿Está seguro de que desea descartar los cambios? Esta acción no se puede deshacer.",
	"confirm.unsavedChanges":
		"Tiene cambios sin guardar. ¿Está seguro de que desea salir?",
	"confirm.action": "¿Está seguro de que desea continuar?",
	"confirm.irreversible": "Esta acción no se puede deshacer.",
	"confirm.localeChange": "¿Descartar cambios sin guardar?",
	"confirm.localeChangeDescription":
		"Tiene cambios sin guardar. Cambiar el idioma de contenido descartará sus cambios y cargará el contenido en el nuevo idioma.",
	"confirm.localeChangeStay": "Quedarse",
	"confirm.localeChangeDiscard": "Descartar y cambiar",

	// Status
	"status.draft": "Borrador",
	"status.published": "Publicado",
	"status.archived": "Archivado",
	"status.pending": "Pendiente",
	"status.active": "Activo",
	"status.inactive": "Inactivo",

	// Dates
	"date.today": "Hoy",
	"date.yesterday": "Ayer",
	"date.tomorrow": "Mañana",
	"date.selectDate": "Seleccionar fecha",
	"date.selectTime": "Seleccionar hora",
	"date.clear": "Limpiar fecha",

	// Accessibility
	"a11y.openMenu": "Abrir menú",
	"a11y.closeMenu": "Cerrar menú",
	"a11y.expand": "Expandir",
	"a11y.collapse": "Colapsar",
	"a11y.loading": "Cargando",
	"a11y.required": "Requerido",
	"a11y.optional": "Opcional",
	"a11y.selected": "Seleccionado",
	"a11y.notSelected": "No seleccionado",

	// Locale
	"locale.language": "Idioma",
	"locale.switchLanguage": "Cambiar idioma",
	"locale.contentLanguage": "Idioma de contenido",
	"locale.uiLanguage": "Idioma de interfaz",

	// ===========================================
	// Default Collections
	// ===========================================

	// Users Collection
	"defaults.users.label": "Usuarios",
	"defaults.users.description":
		"Gestionar usuarios administradores y sus roles",
	"defaults.users.fields.name.label": "Nombre",
	"defaults.users.fields.name.placeholder": "Ingrese nombre de usuario",
	"defaults.users.fields.email.label": "Correo electrónico",
	"defaults.users.fields.email.description":
		"Dirección de correo (solo lectura)",
	"defaults.users.fields.role.label": "Rol",
	"defaults.users.fields.role.options.admin": "Administrador",
	"defaults.users.fields.role.options.user": "Usuario",
	"defaults.users.fields.emailVerified.label": "Correo verificado",
	"defaults.users.fields.emailVerified.description":
		"Si el usuario ha verificado su dirección de correo",
	"defaults.users.fields.banned.label": "Bloqueado",
	"defaults.users.fields.banned.description":
		"Evitar que el usuario acceda al sistema",
	"defaults.users.fields.banReason.label": "Motivo de bloqueo",
	"defaults.users.fields.banReason.placeholder":
		"Ingrese motivo del bloqueo...",
	"defaults.users.sections.basicInfo": "Información básica",
	"defaults.users.sections.permissions": "Permisos",
	"defaults.users.sections.accessControl": "Control de acceso",
	"defaults.users.actions.createUser.label": "Crear usuario",
	"defaults.users.actions.createUser.title": "Crear usuario",
	"defaults.users.actions.createUser.description":
		"Crear una nueva cuenta de usuario con credenciales de inicio de sesión.",
	"defaults.users.actions.createUser.fields.password.label": "Contraseña",
	"defaults.users.actions.createUser.fields.password.placeholder":
		"Ingrese contraseña",
	"defaults.users.actions.createUser.submit": "Crear usuario",
	"defaults.users.actions.createUser.success":
		"Usuario {{email}} creado correctamente. Comparta las credenciales con el usuario.",
	"defaults.users.actions.createUser.errorNoAuth":
		"Cliente de autenticación no configurado. No se puede crear usuario.",
	"defaults.users.actions.resetPassword.label": "Restablecer contraseña",
	"defaults.users.actions.resetPassword.title": "Restablecer contraseña",
	"defaults.users.actions.resetPassword.description":
		"Establecer una nueva contraseña para este usuario.",
	"defaults.users.actions.resetPassword.fields.newPassword.label":
		"Nueva contraseña",
	"defaults.users.actions.resetPassword.fields.newPassword.placeholder":
		"Ingrese nueva contraseña",
	"defaults.users.actions.resetPassword.fields.confirmPassword.label":
		"Confirmar contraseña",
	"defaults.users.actions.resetPassword.fields.confirmPassword.placeholder":
		"Confirme nueva contraseña",
	"defaults.users.actions.resetPassword.submit": "Restablecer contraseña",
	"defaults.users.actions.resetPassword.success":
		"¡Contraseña restablecida correctamente!",
	"defaults.users.actions.resetPassword.errorMismatch":
		"Las contraseñas no coinciden",
	"defaults.users.actions.delete.label": "Eliminar usuario",

	// Assets Collection
	"defaults.assets.label": "Medios",
	"defaults.assets.description": "Gestionar archivos e imágenes subidos",
	"defaults.assets.fields.preview.label": "Vista previa",
	"defaults.assets.fields.filename.label": "Nombre de archivo",
	"defaults.assets.fields.filename.description":
		"Nombre original del archivo subido",
	"defaults.assets.fields.mimeType.label": "Tipo",
	"defaults.assets.fields.mimeType.description": "Tipo MIME del archivo",
	"defaults.assets.fields.size.label": "Tamaño (bytes)",
	"defaults.assets.fields.size.description": "Tamaño del archivo en bytes",
	"defaults.assets.fields.alt.label": "Texto alternativo",
	"defaults.assets.fields.alt.placeholder":
		"Describa la imagen para accesibilidad",
	"defaults.assets.fields.alt.description":
		"Texto alternativo para lectores de pantalla",
	"defaults.assets.fields.caption.label": "Leyenda",
	"defaults.assets.fields.caption.placeholder": "Añadir una leyenda...",
	"defaults.assets.fields.visibility.label": "Visibilidad",
	"defaults.assets.fields.visibility.options.public": "Público",
	"defaults.assets.fields.visibility.options.private": "Privado",
	"defaults.assets.fields.visibility.description":
		"Los archivos públicos son accesibles sin autenticación. Los archivos privados requieren una URL firmada.",
	"defaults.assets.sections.fileInfo": "Información del archivo",
	"defaults.assets.sections.metadata": "Metadatos",
	"defaults.assets.sections.metadata.description":
		"Añada información descriptiva para accesibilidad y SEO",
	"defaults.assets.actions.upload.label": "Subir archivos",

	// Default Sidebar
	"defaults.sidebar.administration": "Administración",

	// View Options (Filter Builder)
	"viewOptions.title": "Opciones de vista",
	"viewOptions.columns": "Columnas",
	"viewOptions.filters": "Filtros",
	"viewOptions.savedViews": "Vistas guardadas",
	"viewOptions.apply": "Aplicar",
	"viewOptions.reset": "Restablecer",

	// Saved Views Tab
	"viewOptions.saveCurrentConfig": "Guardar configuración actual",
	"viewOptions.viewNamePlaceholder": "Nombre de vista...",
	"viewOptions.saveDescription": "Guarda las columnas, filtros y orden actual.",
	"viewOptions.noChangesToSave":
		"No hay filtros o cambios de columnas para guardar.",
	"viewOptions.noSavedViews": "Aún no hay vistas guardadas.",
	"viewOptions.filtersCount": {
		one: "{{count}} filtro",
		other: "{{count}} filtros",
	},
	"viewOptions.columnsCount": { one: "{{count}} col", other: "{{count}} cols" },
	"viewOptions.defaultView": "Predeterminado",

	// Columns Tab
	"viewOptions.columnsDragHint":
		"Arrastre para reordenar, active/desactive para mostrar/ocultar columnas.",
	"viewOptions.noFieldsAvailable": "No hay campos disponibles.",

	// Filters Tab
	"viewOptions.filtersDescription":
		"Reduzca sus resultados con reglas personalizadas.",
	"viewOptions.filterNumber": "Filtro #{{number}}",
	"viewOptions.selectField": "Seleccionar campo",
	"viewOptions.selectOperator": "Seleccionar operador",
	"viewOptions.valuePlaceholder": "Valor...",
	"viewOptions.noActiveFilters": "No hay filtros activos.",
	"viewOptions.addFilter": "Añadir filtro",
	"viewOptions.clearAll": "Limpiar todo",
	"viewOptions.activeFilters": {
		one: "{{count}} filtro activo",
		other: "{{count}} filtros activos",
	},
	"viewOptions.clearFilters": "Limpiar filtros",

	// Filter Operators
	"filter.contains": "Contiene",
	"filter.notContains": "No contiene",
	"filter.equals": "Igual a",
	"filter.notEquals": "No igual a",
	"filter.startsWith": "Comienza con",
	"filter.endsWith": "Termina con",
	"filter.greaterThan": "Mayor que",
	"filter.greaterThanOrEqual": "Mayor o igual que",
	"filter.lessThan": "Menor que",
	"filter.lessThanOrEqual": "Menor o igual que",
	"filter.in": "Es cualquiera de",
	"filter.notIn": "No es ninguno de",
	"filter.some": "Tiene alguno",
	"filter.every": "Tiene todos",
	"filter.none": "No tiene ninguno",
	"filter.isEmpty": "Está vacío",
	"filter.isNotEmpty": "No está vacío",

	// Preview
	"preview.show": "Vista previa",
	"preview.hide": "Ocultar vista previa",
	"preview.title": "Vista previa",
	"preview.livePreview": "Vista previa en vivo",
	"preview.fullscreen": "Pantalla completa",
	"preview.close": "Cerrar vista previa",
	"preview.loading": "Cargando vista previa...",
	"preview.pathRequired": "La ruta es obligatoria",
	"preview.collectionNameRequired": "El nombre de la colección es obligatorio",
	"preview.adminSessionRequired": "Se requiere sesión de administrador",
	"preview.invalidTokenFormat": "Formato de token inválido",
	"preview.invalidSignature": "Firma inválida",
	"preview.invalidPayload": "Payload inválido",
	"preview.tokenExpired": "Token caducado",
	"preview.invalidPath": "Ruta inválida",
	"preview.collectionNotFound": 'Colección "{{collection}}" no encontrada',
	"preview.noUrlConfigured":
		"No hay URL de vista previa configurada para esta colección",
	"preview.disabledForCollection":
		"La vista previa está desactivada para esta colección",
	"preview.generateUrlFailed":
		"No se pudo generar la URL de vista previa: {{message}}",

	// Autosave
	"autosave.saving": "Guardando...",
	"autosave.saved": "Guardado",
	"autosave.unsavedChanges": "Cambios sin guardar",
	"autosave.justNow": "ahora mismo",
	"autosave.secondsAgo": { one: "hace {{count}}s", other: "hace {{count}}s" },
	"autosave.minutesAgo": { one: "hace {{count}}m", other: "hace {{count}}m" },
	"autosave.hoursAgo": { one: "hace {{count}}h", other: "hace {{count}}h" },

	// Global Search
	"globalSearch.placeholder":
		"Buscar colecciones, globales, acciones, registros...",
	"globalSearch.collections": "Colecciones",
	"globalSearch.globals": "Globales",
	"globalSearch.quickActions": "Acciones rápidas",
	"globalSearch.records": "Registros",
	"globalSearch.createNew": "Crear nuevo {{name}}",
	"globalSearch.noResults": "No se encontraron resultados",
	"globalSearch.searching": "Buscando...",
	"globalSearch.navigate": "para navegar",
	"globalSearch.select": "para seleccionar",

	// Collection Search
	"collectionSearch.placeholder": "Buscar registros...",
	"collectionSearch.noResults": "No se encontraron registros coincidentes",
	"collectionSearch.searching": "Buscando...",

	// Audit
	"audit.section.activity": "Actividad",

	// Additional Admin UI Messages
	"audit.collection.description":
		"Explore todos los cambios registrados y la actividad de los usuarios",
	"audit.collection.label": "Registro de auditoría",
	"audit.sections.changes": "Cambios",
	"audit.sections.event": "Detalles del evento",
	"audit.sections.user": "Usuario",
	"audit.widget.recentActivity.empty": "No hay actividad reciente registrada.",
	"audit.widget.recentActivity.title": "Actividad reciente",
	"auth.backToLogin": "Volver al inicio de sesión",
	"auth.checkYourEmail": "Revise su correo",
	"auth.completeRegistration": "Completar registro",
	"auth.createAccountDescription": "Cree su cuenta para comenzar",
	"auth.enterNewPassword": "Ingrese su nueva contraseña abajo.",
	"auth.forgotPasswordDescription":
		"Ingrese su correo para recibir un enlace de restablecimiento de contraseña",
	"auth.forgotPasswordFormDescription":
		"Ingrese su dirección de correo y le enviaremos un enlace para restablecer su contraseña.",
	"auth.forgotPasswordTitle": "Contraseña olvidada",
	"auth.goToLogin": "Ir al inicio de sesión",
	"auth.invalidInvitation": "Invitación inválida",
	"auth.invalidInvitationDescription":
		"Este enlace de invitación ya no es válido",
	"auth.invalidLink": "Enlace inválido",
	"auth.invalidLinkDescription":
		"El enlace de restablecimiento de contraseña es inválido o ha expirado.",
	"auth.invalidOrExpiredInvitation": "Invitación inválida o expirada",
	"auth.invitationExpiredMessage":
		"La invitación puede haber expirado o ya haber sido utilizada. Contacte a su administrador para recibir una nueva invitación.",
	"auth.inviteEmailDescription":
		"Se enviará un enlace de invitación a este correo",
	"auth.inviteEmailLabel": "Dirección de correo",
	"auth.inviteMessage": "Mensaje personal (opcional)",
	"auth.inviteMessageDescription":
		"Este mensaje se incluirá en el correo de invitación",
	"auth.inviteMessagePlaceholder":
		"Añada un mensaje personal a la invitación...",
	"auth.inviteRole": "Rol",
	"auth.inviteRoleDescription":
		"El rol determina qué permisos tendrá el usuario",
	"auth.inviteSelectRole": "Seleccionar un rol",
	"auth.inviteSentSuccess": "Invitación enviada correctamente",
	"auth.inviteSentTo": "Invitación enviada a {{email}}",
	"auth.inviteUser": "Invitar usuario",
	"auth.inviteUserDescription":
		"Envíe una invitación para añadir un nuevo usuario",
	"auth.pleaseWait": "Espere...",
	"auth.rememberYourPassword": "¿Recuerda su contraseña?",
	"auth.requestNewResetLink":
		"Solicite un nuevo enlace de restablecimiento de contraseña.",
	"auth.resetLinkSentDescription":
		"Hemos enviado un enlace de restablecimiento de contraseña a su correo. Revise su bandeja de entrada y siga las instrucciones.",
	"auth.resetPasswordSuccess": "Contraseña restablecida correctamente",
	"auth.resetPasswordSuccessDescription":
		"Su contraseña se ha restablecido correctamente. Ahora puede iniciar sesión con su nueva contraseña.",
	"auth.sendInvitation": "Enviar invitación",
	"auth.sendingInvitation": "Enviando invitación...",
	"auth.signInDescription":
		"Ingrese sus credenciales para acceder al panel de administración",
	"auth.user": "Usuario",
	"auth.validatingInvitation": "Validando invitación",
	"blocks.add": "Añadir bloque",
	"blocks.addFirst": "Añada su primer bloque para comenzar",
	"blocks.addTo": "Añadir a {{parent}}",
	"blocks.emptyTitle": "No hay bloques",
	"blocks.libraryDescription":
		"Elija un tipo de bloque para añadirlo a su diseño.",
	"blocks.noDefinitions": "No hay definiciones de bloques registradas",
	"blocks.noDefinitionsHint":
		"Registre bloques con .blocks() en su configuración de administración",
	"blocks.noEditableFields": "Este bloque no tiene campos editables.",
	"blocks.noSearchResults": "Ningún bloque coincide con su búsqueda",
	"blocks.searchPlaceholder": "Buscar bloques...",
	"blocks.tryDifferentSearch": "Pruebe con otro término de búsqueda.",
	"blocks.uncategorized": "Otro",
	"blocks.unknownType":
		'Tipo de bloque "{{type}}" desconocido. Este tipo de bloque no está registrado.',
	"cell.blocks": "Bloques",
	"cell.file": { one: "{{count}} archivo", other: "{{count}} archivos" },
	"cell.item": { one: "{{count}} elemento", other: "{{count}} elementos" },
	"cell.more": "+{{count}} más",
	"collection.bulkRestoreError": "Error al restaurar elementos",
	"collection.bulkRestorePartial": {
		one: "{{success}} elemento restaurado, {{failed}} fallido",
		other: "{{success}} elementos restaurados, {{failed}} fallidos",
	},
	"collection.bulkRestoreSuccess": {
		one: "{{count}} elemento restaurado correctamente",
		other: "{{count}} elementos restaurados correctamente",
	},
	"collection.orderSaveFailed": "Error al guardar el orden",
	"collection.orderSaved": "Orden guardado",
	"collection.reorderAddOrderField":
		"Añada un campo de orden numérico antes de reordenar",
	"collection.reorderClearFilters": "Limpie los filtros para reordenar",
	"collection.reorderClearSearch": "Limpie la búsqueda para reordenar",
	"collection.reorderEnableOrderable":
		"Habilite la ordenación antes de reordenar",
	"collection.reorderEnterMode": "Entrar en modo de reordenación",
	"collection.reorderExitMode": "Salir del modo de reordenación",
	"collection.reorderItems": "Reordenar elementos",
	"collection.reorderMode": "Modo de reordenación",
	"collection.reorderRemoveGrouping": "Quite la agrupación para reordenar",
	"collection.reorderShowOnePage":
		"Muestre una página de elementos para reordenar",
	"collection.reorderSwitchSort":
		"Cambie a la ordenación por {{field}} y reordene",
	"collection.reorderUnavailable": "Reordenación no disponible: {{reason}}",
	"collection.restoreError": "Error al restaurar el elemento",
	"collection.restoreSuccess": "Elemento restaurado correctamente",
	"collection.restoring": "Restaurando...",
	"collection.sortedByField": "Ordenado por {{field}} {{direction}}.",
	"collectionSearch.noResultsDescription":
		"Pruebe con otro término de búsqueda o limpie la búsqueda para volver a la lista completa.",
	"common.backToList": "Volver a la lista",
	"common.deleted": "Eliminado",
	"common.done": "Hecho",
	"common.moreActions": "Más acciones",
	"common.noValue": "Sin valor",
	"confirm.deleteAll": "Eliminar todo",
	"confirm.deleteItemDescription":
		"Esta acción no se puede deshacer. El elemento se eliminará permanentemente.",
	"confirm.deleteItemTitle": "¿Eliminar elemento?",
	"confirm.deleteSelected": "Eliminar seleccionados",
	"confirm.deleteSelectedDescription":
		"Esta acción no se puede deshacer. Todos los elementos seleccionados se eliminarán permanentemente.",
	"confirm.deleteSelectedTitle": "¿Eliminar elementos seleccionados?",
	"confirm.restore": "Restaurar",
	"confirm.restoreDescription":
		"Este elemento volverá a ser visible en las vistas de lista normales.",
	"confirm.restoreTitle": "¿Restaurar elemento?",
	"dashboard.noWidgets": "No hay widgets configurados",
	"dashboard.noWidgetsDescription":
		"Añada widgets a la configuración de su panel para mostrar datos aquí.",
	"dashboard.systemStatus": "Estado del sistema",
	"dashboard.welcomeDescription":
		"Seleccione una colección en la barra lateral para gestionar su contenido.",
	"defaults.assets.sections.dimensions": "Dimensiones",
	"defaults.users.tabs.profile": "Perfil",
	"defaults.users.tabs.security": "Seguridad",
	"dropzone.invalidType": '"{{name}}" no es un tipo de archivo aceptado',
	"dropzone.label": "Suelte archivos aquí o haga clic para explorar",
	"dropzone.tooLarge": '"{{name}}" supera el tamaño máximo de {{maxSize}}',
	"dropzone.typeAudio": "Audio",
	"dropzone.typeImages": "Imágenes",
	"dropzone.typePDF": "PDF",
	"dropzone.typeVideos": "Vídeos",
	"dropzone.uploading": "Subiendo...",
	"error.accessRestricted": "Acceso restringido",
	"error.accessRestrictedDescription":
		"No tiene permiso para acceder a esta página. Contacte a su administrador si cree que se trata de un error.",
	"error.accessRestrictedResourceDescription":
		'El recurso {{type}} "{{name}}" no está disponible en el panel de administración. Puede estar oculto o usted no tiene permiso para acceder a él.',
	"error.actionFailed": "Acción fallida",
	"error.anErrorOccurred": "Ocurrió un error",
	"error.autosaveFailed": "Error en el autoguardado",
	"error.backToDashboard": "Volver al panel",
	"error.componentNotFound": "Componente no encontrado",
	"error.failedToCreateAccount": "Error al crear la cuenta",
	"error.failedToCreateAdminAccount":
		"Error al crear la cuenta de administrador",
	"error.failedToGeneratePreviewToken":
		"Error al generar el token de vista previa",
	"error.failedToLoad": "Error al cargar",
	"error.failedToLoadAssets": "Error al cargar medios",
	"error.failedToLoadComponent": "Error al cargar el componente",
	"error.failedToLoadOptions": "Error al cargar opciones",
	"error.failedToLoadSelectedItems":
		"Error al cargar los elementos seleccionados",
	"error.failedToLoadView": "Error al cargar {{viewType}}",
	"error.failedToLoadViewFor":
		"Error al cargar {{viewType}} para {{collection}}",
	"error.failedToResetPassword": "Error al restablecer la contraseña",
	"error.failedToSendInvitation": "Error al enviar la invitación",
	"error.failedToSendResetEmail":
		"Error al enviar el correo de restablecimiento",
	"error.invalidCredentials": "Credenciales inválidas",
	"error.maxItemsAllowed": "Máximo {{max}} elementos permitidos",
	"error.missingFieldComponent":
		"No hay ningún componente registrado para el tipo de campo: {{type}}",
	"error.multipleUploadCollections":
		"Hay varias colecciones de subida disponibles ({{collections}}). Especifique qué colección usar.",
	"error.noUploadCollection": "No hay ninguna colección de subida configurada.",
	"error.pageNotFound": "Página no encontrada",
	"error.pageNotFoundDescription": "La página que busca no existe.",
	"error.selectAtLeastOne": "Seleccione al menos un medio",
	"error.serverActionFailed": "Acción del servidor fallida",
	"error.somethingWentWrong": "Algo salió mal",
	"error.tryAgain": "Intentar de nuevo",
	"error.unexpectedError": "Ocurrió un error inesperado",
	"error.unknownWidget": "Widget desconocido",
	"error.unregisteredViewDescription":
		'La vista "{{viewId}}" no está registrada en el registro de vistas de administración.',
	"error.uploadFailed": "Subida fallida",
	"error.widgetError": "Error de widget",
	"error.widgetTypeNotRecognized":
		'El tipo de widget "{{type}}" no se reconoce.',
	"field.codeEditor": "Editor de código",
	"field.dragToReorder": "Arrastre para reordenar",
	"field.editItem": "Editar elemento",
	"field.formEditor": "Editor de formulario",
	"field.moveDown": "Mover abajo",
	"field.moveUp": "Mover arriba",
	"field.noItems": "Sin elementos",
	"field.removeItem": "Eliminar elemento",
	"field.section": "Sección",
	"form.deletedBanner":
		"Este registro se eliminó el {{date}}. Use la acción Restaurar para activarlo de nuevo.",
	"form.lastUpdated": "Última actualización",
	"history.after": "Después",
	"history.before": "Antes",
	"history.blocksCount": {
		one: "{{count}} bloque",
		other: "{{count}} bloques",
	},
	"history.changeAdded": "Añadido",
	"history.changeChanged": "Cambiado",
	"history.changeRemoved": "Eliminado",
	"history.changedFields": {
		one: "{{count}} campo cambiado",
		other: "{{count}} campos cambiados",
	},
	"history.description": "Cambios y actividad de este registro",
	"history.diffAgainstVersion": "Diferencia con la versión {{number}}",
	"history.empty": "No hay actividad registrada",
	"history.hideChanges": "Ocultar cambios",
	"history.initialSnapshot": "Instantánea inicial",
	"history.itemsCount": {
		one: "{{count}} elemento",
		other: "{{count}} elementos",
	},
	"history.moreFields": { one: "{{count}} más", other: "{{count}} más" },
	"history.noFieldChanges":
		"No hay cambios a nivel de campo en esta instantánea.",
	"history.objectWithKeys": {
		one: "Objeto con {{count}} clave",
		other: "Objeto con {{count}} claves",
	},
	"history.showChanges": {
		one: "Mostrar cambios ({{count}})",
		other: "Mostrar cambios ({{count}})",
	},
	"history.stage": "Etapa",
	"history.systemUser": "Sistema",
	"history.tabActivity": "Actividad",
	"history.tabVersions": "Versiones",
	"history.title": "Historial",
	"history.versionDescription":
		"Explore instantáneas de versiones e inspeccione diferencias a nivel de campo.",
	"input.selectDate": "Seleccionar fecha",
	"input.selectDateRange": "Seleccionar rango de fechas",
	"input.selectDateTime": "Seleccionar fecha y hora",
	"input.selectTime": "Seleccionar hora",
	"lock.blockedDescription":
		"Este documento está bloqueado. Puede verlo, pero no puede hacer cambios hasta que expire el bloqueo.",
	"lock.blockedTitle": "{{name}} está editando actualmente",
	"lock.cannotSave":
		"No se puede guardar: el documento está bloqueado por otro usuario",
	"lock.openElsewhere":
		"Tiene este documento abierto en otra pestaña. Los cambios se sincronizarán automáticamente.",
	"media.allFiles": "Todos los archivos",
	"media.audio": "Audio",
	"media.browseLibrary": "Explorar biblioteca de medios",
	"media.documents": "Documentos",
	"media.images": "Imágenes",
	"media.noAssets": "No hay medios",
	"media.searchPlaceholder": "Buscar por nombre de archivo...",
	"media.videos": "Vídeos",
	"nav.adminNavigation": "Navegación de administración",
	"nav.breadcrumb": "Ruta de navegación",
	"preview.exitPreview": "Salir de la vista previa",
	"preview.exitTooltip":
		"Salir del modo de vista previa y borrar la cookie de borrador",
	"preview.hidePreview": "Ocultar vista previa",
	"preview.loadingPreview": "Cargando vista previa...",
	"preview.mode": "Modo de vista previa",
	"preview.previewError": "Error de vista previa",
	"preview.refreshing": "Actualizando...",
	"preview.showPreview": "Mostrar vista previa",
	"table.editing": "Editando",
	"table.emptyDescription":
		"Los registros aparecerán aquí una vez que se creen.",
	"table.noItemsInCollection": "No se encontraron elementos en esta colección",
	"table.pagination": "Paginación",
	"table.show": "Mostrar",
	"time.daysAgoShort": { one: "hace {{count}}d", other: "hace {{count}}d" },
	"time.hoursAgoShort": { one: "hace {{count}}h", other: "hace {{count}}h" },
	"time.justNow": "ahora mismo",
	"time.minutesAgoShort": { one: "hace {{count}}m", other: "hace {{count}}m" },
	"ui.commandPalette": "Paleta de comandos",
	"ui.commandPaletteDescription": "Busque un comando para ejecutar...",
	"ui.expand": "Expandir",
	"ui.expandSidebar": "Expandir barra lateral",
	"ui.processing": "Procesando...",
	"ui.searchPlaceholder": "Buscar...",
	"ui.skipToMainContent": "Saltar al contenido principal",
	"ui.themeDark": "Oscuro",
	"ui.themeLight": "Claro",
	"ui.themeSystem": "Sistema",
	"ui.toggleSidebar": "Alternar barra lateral",
	"ui.toggleTheme": "Alternar tema",
	"upload.browseLibrary": "Explorar biblioteca",
	"upload.bulkDescription": "Añada varios archivos a su biblioteca de medios",
	"upload.bulkError": {
		one: "Error al subir {{count}} archivo",
		other: "Error al subir {{count}} archivos",
	},
	"upload.bulkHint": "Suba varios archivos a la vez",
	"upload.bulkSuccess": {
		one: "{{count}} archivo subido correctamente",
		other: "{{count}} archivos subidos correctamente",
	},
	"upload.bulkTitle": "Subir archivos",
	"upload.failedCount": {
		one: "{{count}} fallido",
		other: "{{count}} fallidos",
	},
	"upload.filesCount": {
		one: "{{count}} archivo",
		other: "{{count}} archivos",
	},
	"upload.uploadedCount": {
		one: "{{count}} subido",
		other: "{{count}} subidos",
	},
	"upload.waitForComplete": "Espere a que terminen las subidas",
	"version.createdAt": "Creado",
	"version.empty": "No se encontraron versiones.",
	"version.globalHistoryDescription":
		"Explore versiones globales anteriores y restaure una si es necesario.",
	"version.history": "Historial de versiones",
	"version.historyDescription":
		"Explore versiones anteriores y restaure una si es necesario.",
	"version.label": "Versión {{number}}",
	"version.operationCreate": "Creado",
	"version.operationDelete": "Eliminado",
	"version.operationUnknown": "Cambiado",
	"version.operationUpdate": "Actualizado",
	"version.revert": "Revertir",
	"version.revertConfirmDescription":
		"Esto reemplazará el contenido actual con la versión {{number}}.",
	"version.revertConfirmTitle": "¿Revertir a esta versión?",
	"version.revertSuccess": "Versión restaurada correctamente",
	"version.user": "Usuario",
	"viewOptions.groupBy": "Agrupar por",
	"viewOptions.groupByDescription":
		"Agrupe la página actual por un campo configurado.",
	"viewOptions.noGrouping": "Sin agrupación",
	"viewOptions.noResultsDescription":
		"Ningún registro coincide con los filtros activos. Ajústelos o límpielos para ver más resultados.",
	"viewOptions.realtime": "Actualizaciones en tiempo real",
	"viewOptions.realtimeDescription":
		"Actualice esta tabla automáticamente cuando cambien los datos.",
	"viewOptions.showDeleted": "Mostrar eliminados",
	"viewOptions.showDeletedDescription":
		"Incluir registros eliminados de forma reversible en esta vista.",
	"viewOptions.sort": "Ordenar",
	"widget.chart.emptyDescription":
		"Configure una fuente de datos para mostrar un gráfico.",
	"widget.chart.emptyTitle": "No hay datos de gráfico",
	"widget.progress.emptyDescription":
		"Configure datos de progreso para mostrar este widget.",
	"widget.progress.emptyTitle": "No hay progreso configurado",
	"widget.quickActions.emptyDescription":
		"Añada acciones rápidas a la configuración de su panel.",
	"widget.quickActions.emptyTitle": "No hay acciones rápidas",
	"widget.recentItems.emptyDescription":
		"Los elementos recientes aparecerán aquí una vez que se creen.",
	"widget.recentItems.emptyTitle": "No hay elementos recientes",
	"widget.table.emptyDescription":
		"No hay registros para los criterios actuales.",
	"widget.table.emptyTitle": "No hay filas para mostrar",
	"widget.timeline.emptyDescription": "No hay eventos para mostrar.",
	"widget.timeline.emptyTitle": "Aún no hay actividad",
	"widget.value.emptyDescription":
		"Configure una fuente de valor para mostrar este widget.",
	"widget.value.emptyTitle": "No hay valor configurado",
	"workflow.currentStage": "Etapa actual",
	"workflow.noTransitions": "No hay transiciones disponibles desde esta etapa",
	"workflow.scheduleLabel": "Programar para más tarde",
	"workflow.scheduledAt": "Fecha y hora programadas",
	"workflow.scheduledDescription":
		"La transición ocurrirá automáticamente en la hora programada.",
	"workflow.scheduledSuccess":
		'Transición a "{{stage}}" programada para {{date}}',
	"workflow.transition": "Transición",
	"workflow.transitionDescription":
		'Esto hará la transición de "{{from}}" a "{{to}}".',
	"workflow.transitionFailed": "Error en la transición",
	"workflow.transitionSuccess":
		'Transición a "{{stage}}" completada correctamente',
	"workflow.transitionTo": "Transición a {{stage}}",
} as const;
