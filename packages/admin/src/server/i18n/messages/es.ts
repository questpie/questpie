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
} as const;
