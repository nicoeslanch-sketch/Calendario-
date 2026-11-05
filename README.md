# Espacio PDR

Calendario comercial, minutas automatizadas, distribución de tareas e hitos históricos para el equipo Santa Clara.

## Funcionamiento

- Selecciona el perfil: Nicolás Albornoz, Benjamín Hernández, Tomás Espinoza o Compartido.
- La navegación principal reúne Calendario, Minutas automatizadas, Distribución de tareas y Mis hitos históricos. El calendario es la vista inicial y conserva General, Hoy, Semana, Mes, Tareas secundarias, Proyectos, Completadas y Cumpleaños.
- El calendario permite crear, editar, completar, duplicar y eliminar tareas; incluye prioridades semanales, subtareas, arrastre entre días, recurrencias, preparación previa y varios avisos. Conserva la semana/mes y el formulario al pasar entre secciones.
- Cada agenda personal muestra sus tareas y las compartidas. Compartido muestra solo la agenda común, nunca las tareas privadas de otros perfiles. Se puede crear para el perfil abierto o Compartido. Los cumpleaños son comunes al equipo.
- Nicolás y Benjamín entran con contraseña verificada en el servidor; Tomás y Compartido tienen acceso directo por decisión del equipo.
- Cada perfil ve únicamente sus minutas, carpetas e hitos. Compartido tiene sus propios documentos y no funciona como acceso a documentos privados.
- Distribución aplica permisos en el servidor: Nicolás y Benjamín consultan todos los grupos; Tomás y los demás perfiles abiertos solo consultan su grupo y Compartido. Compartido solo consulta su propio grupo. Cambian el estado el responsable y el creador de la minuta, siempre que tengan acceso a ese grupo; los demás consultan.
- Enter convierte un punto en tarjeta; Shift+Enter permite un salto de línea. Se puede arrastrar a una carpeta o moverla con el selector, también en celular.
- Cada carpeta tiene un responsable. El resumen extractivo se genera automáticamente desde el punteo, reconoce acuerdos explícitos y se puede corregir antes de guardar. No usa un servicio de IA generativa ni inventa plazos, responsables o acuerdos. Desmarcar “Crear tarea” conserva el punto como contexto.
- Cada tarjeta de la minuta permite elegir prioridad Alta (rojo), Media (amarillo) o Baja (verde). Distribución de tareas muestra su semáforo y ordena de alta a baja, conservando ese orden al buscar o filtrar estados. Las tareas anteriores y las nuevas sin selección tienen prioridad media. Cambiarla en la minuta y volver a distribuir conserva el estado, las fechas y la identidad de la tarea.
- Las fechas son opcionales: la carpeta puede definir una fecha general; cada punto permite heredarla, usar una fecha propia o elegir «Sin fecha». Solo las tareas accionables de minutas distribuidas y con fecha aparecen también en el calendario. Sin fecha siguen en distribución. Los borradores y los puntos de contexto no se agendan.
- El calendario proyecta la misma asignación, sin duplicarla en `public.tasks`. Completar o desmarcar sincroniza ambos tableros. El editor de una tarea de minuta permite cambiar título, fecha, prioridad y estado; los cambios actualizan su punto de origen y la versión de la minuta. Quitar la fecha retira la tarea del calendario, pero conserva su distribución. Eliminarla la retira de ambas vistas con la marca que impide recrearla. No se añaden avisos horarios a estas tareas.
- Guardar y distribuir funciona con un solo clic: prepara el resumen si falta y guarda la minuta y sus tareas de forma atómica. “Analizar minuta” sigue disponible para revisar antes de guardar, pero es opcional. Volver a guardar conserva los estados y no genera duplicados.
- Los estados son Sin iniciar, Iniciada y Terminada. Los tiempos se guardan en el servidor y se muestran en America/Santiago.
- Los hitos guardan año, propósito, directrices, plan y aprendizajes. “Usar como base” abre una nueva edición conservando el registro original.
- Los registros incluyen una papelera con confirmación: minutas, hitos, carpetas, puntos y tareas (incluidas las del calendario, proyectos, cumpleaños y subtareas). Solo el propietario elimina documentos privados; el responsable o creador puede eliminar una tarea distribuida.
- Eliminar una minuta elimina también sus tareas distribuidas. Eliminar una tarea distribuida conserva una marca interna para impedir que reaparezca al guardar la minuta. No hay recuperación desde la aplicación.
- Las carpetas de una minuta incluyen “Convertir en hito histórico”: copia sus puntos y tareas, respeta el estado completado y abre un hito para revisar y guardar, sin eliminar ni modificar el origen. “Mis carpetas guardadas” permite gestionar también la biblioteca. Quitar una carpeta de la minuta deja los puntos sin agrupar; eliminarla de la biblioteca no modifica minutas anteriores.
- Cada hito prioriza la planilla histórica de actividades, justo debajo del título y año: actividad, estado Realizada/Por realizar y observaciones para el próximo año. Se escribe directamente en la última fila, sin botón “Agregar tarea”. El texto realizado sigue legible, sin tachar. Los cambios se conservan al guardar. Al usar un hito como base, se copian sus actividades como pendientes sin modificar el original.
- “Descargar PDF” exporta la planilla con estados y observaciones, propósito, directrices, planificación y aprendizajes. Funciona desde la tarjeta guardada o el editor (incluye los cambios aún no guardados). El PDF se genera localmente, sin enviar datos a servicios de conversión, con paginación, encabezados y pies.
- «Crear nueva edición» conserva objetivo, directrices, planificación y observaciones, asigna nuevas identidades a sus actividades y las deja todas pendientes. Propone el año siguiente (editable), conserva una instantánea de los resultados y aprendizajes de la edición anterior, y guarda una nueva edición sin modificar el original. Los aprendizajes propios de la nueva edición empiezan vacíos; los anteriores se consultan en «Referencia de la edición…».
- Los hitos admiten adjuntos privados (máximo 10 por edición, 5 MB cada uno): PDF, DOCX, XLSX, PPTX, TXT, CSV, PNG y JPG. Adjuntar guarda también los cambios del hito. Crear una edición copia físicamente sus archivos: eliminar uno en una edición no borra el de otra. Si una copia falla, el hito queda guardado y muestra una opción explícita para reintentar. Una descarga verifica el tamaño recibido y mantiene un enlace «Guardar» por si el navegador bloquea el inicio automático.
- El PDF incluye el listado de adjuntos y los resultados/aprendizajes de referencia, no incorpora los archivos binarios dentro del PDF. El original sigue legible y sin tachar.

## Arquitectura y privacidad

Frontend Vite/JavaScript en `src/workspace.js`; calendario modular en `src/main.js` con estilos aislados y la misma sesión. Persistencia Supabase a través de `pdr_profiles`, `pdr_sign_in`, `pdr_workspace` y `pdr_calendar`. Las tablas de minutas están en `pdr_private`, con RLS y sin permisos directos para anon/authenticated. Las tablas del calendario tampoco permiten acceso directo; el RPC valida la sesión y el perfil en cada operación.

Las sesiones de perfil usan tokens aleatorios de 256 bits almacenados como SHA-256 en la base y duran 12 horas. El navegador conserva el token solo en sessionStorage. La contraseña usa bcrypt y se limita el número de intentos. Los RPCs con SECURITY DEFINER son intencionales: validan la sesión, el propietario y cada operación; tienen search_path vacío y no ejecutan SQL dinámico. El listado de nombres y requisitos de acceso es público para permitir seleccionar perfil.

El PIN compartido es un control básico de perfil, no una identidad individual verificable: cualquiera que conozca el PIN puede entrar al perfil correspondiente. Tomás y Compartido son abiertos por diseño.

Los datos se refrescan cada 20 segundos y los contadores de antigüedad cada minuto. La concurrencia de documentos se controla por versión.

## Reinicio autorizado

La migración `20261030204957_minutes_workspace.sql` retiró las 862 tareas y los 3 proyectos del calendario anterior. Una instantánea administrativa de tareas, subtareas y proyectos se conserva en `pdr_private.legacy_archive`; no es visible desde la aplicación. Los cumpleaños anteriores no se borraron. `20261031155232_restore_calendar_workspace.sql` reincorpora las funciones sin restaurar datos borrados ni reabrir acceso anónimo a las tablas, y reactiva el despacho de avisos existente. Los dispositivos de Compartido ya no reciben avisos privados salvo envío explícito a todo el equipo.

## Desarrollo y verificación

Node.js 20 o posterior. Instala con `npm ci`. Configura `VITE_SUPABASE_URL` y `VITE_SUPABASE_PUBLISHABLE_KEY` en .env.local, usando únicamente la clave pública, nunca service_role.

```sh
npm run dev
npm run lint
npm test
npm run build
```

`supabase/tests/workspace.sql` prueba PIN, sesión, privacidad, distribución, visibilidad de estados, marcas de tiempo, guardado sin duplicados y cierre de sesión dentro de una transacción que se revierte.

`supabase/tests/calendar.sql` prueba CRUD, calendario privado y compartido, subtareas, completadas, recurrencias, preparación, proyectos y cumpleaños dentro de una transacción revertida. Configura también `VITE_VAPID_PUBLIC_KEY` para Web Push; cada dispositivo debe autorizar las notificaciones y asociarse al perfil abierto.

`supabase/tests/workspace_deletion.sql` verifica permisos de eliminación, cascada de minutas, tareas eliminadas que no reaparecen, historial de carpetas, versiones y validación de tareas de hitos. `20261104123240_workspace_deletion_milestone_tasks.sql` mantiene el RPC anterior en el esquema privado y valida sesión y permisos en su nueva entrada. Las advertencias del asesor sobre RPCs SECURITY DEFINER públicos son intencionales para las sesiones de perfil; no se otorgan permisos directos a tablas privadas.

`20261104162207_restrict_assignment_visibility.sql` restringe los resultados del RPC y la modificación de tareas por grupo. `supabase/tests/task_visibility.sql` prueba acceso de los cuatro perfiles y las mutaciones prohibidas. `tests/task-access.test.js` cubre las pestañas y `tests/milestone-pdf.test.js` la exportación y paginación. PDF-LIB 1.17.1 (MIT) se conserva versionado en `src/vendor/`, con licencia, y se carga solo al exportar.

El despliegue de producción se realiza con la integración GitHub → Vercel al actualizar main. Enlace: https://calendario-seven-omega.vercel.app/

## Fechas e historial reutilizable

La limpieza de adjuntos exige siempre IDs explícitos, tanto en la función de archivos como en el RPC de base de datos. No se ejecutan barridos automáticos al subir, descargar o copiar archivos. Eliminar un hito envía solo los IDs de sus propios documentos; retirar un archivo o recuperar una subida/copia fallida limpia únicamente ese archivo. `20261105151334_require_explicit_document_cleanup_ids.sql`, `supabase/tests/document_cleanup.sql` y `tests/document-cleanup.test.js` verifican la restricción, los permisos y la protección de documentos no seleccionados.

Las pruebas SQL leen la contraseña de `current_setting('pdr.test_pin',true)`. Configúrala dentro de la misma transacción de prueba, sin guardarla en el repositorio ni imprimir tokens. Los archivos de pruebas no contienen contraseñas de los perfiles.

La migración `20261104191755_scheduled_minutes_reusable_milestones.sql` incorpora las fechas de asignaciones, proyección de calendario, historial de ediciones y metadatos de adjuntos privados. `supabase/tests/scheduled_minutes.sql` cubre fecha heredada, propia y ausente, borradores, sincronización en ambos sentidos, permisos, versiones y eliminación. `supabase/tests/hito_memory.sql` verifica copia independiente, instantánea histórica validada por servidor, privacidad de metadatos y cola de limpieza. Ambos revierten sus datos de prueba.

El bucket `pdr-hito-documents` es privado y no tiene políticas de acceso anónimo. La función `hito-documents` valida en cada operación el token de perfil mediante `pdr_hito_file`, ejecutable solo por `service_role`; la clave de servicio permanece en el entorno estándar de la función, nunca en el cliente. Se usa autenticación propia de PDR, por lo que `verify_jwt=false` no implica acceso sin validar. `pdr_milestone_documents` solo devuelve metadatos del perfil de la sesión y no rutas internas. La eliminación del hito deja los archivos en una cola privada; la aplicación solicita su limpieza mediante Storage, nunca borrando registros de Storage por SQL. Las copias independientes no se incluyen en esa limpieza.

Se mantiene la advertencia sobre los perfiles: la protección depende del PIN compartido y Tomás/Compartido continúan abiertos por decisión del equipo. Esta actualización no implementa identidades individuales, catálogos de procesos, aprobaciones ni búsqueda sobre documentos; esos cambios quedan para una fase futura acordada con el equipo.

`20261104174749_minute_task_priority.sql` añade la prioridad a las tareas con validación privada y sincronización desde los puntos de la minuta, sin modificar los permisos del RPC. `supabase/tests/priority.sql` verifica persistencia, valores inválidos, compatibilidad, propietario, estados y tareas eliminadas en una transacción revertida; `tests/priorities.test.js` verifica el orden estable y la publicación en un clic.
