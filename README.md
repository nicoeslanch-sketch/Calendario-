# Espacio PDR

Calendario comercial, minutas automatizadas, distribución de tareas e hitos históricos para el equipo Santa Clara.

## Funcionamiento

- Selecciona el perfil: Nicolás Albornoz, Benjamín Hernández, Tomás Espinoza o Compartido.
- La navegación principal reúne Calendario, Minutas automatizadas, Distribución de tareas y Mis hitos históricos. El calendario es la vista inicial y conserva General, Hoy, Semana, Mes, Tareas secundarias, Proyectos, Completadas y Cumpleaños.
- El calendario permite crear, editar, completar, duplicar y eliminar tareas; incluye prioridades semanales, subtareas, arrastre entre días, recurrencias, preparación previa y varios avisos. Conserva la semana/mes y el formulario al pasar entre secciones.
- Cada agenda personal muestra sus tareas y las compartidas. Compartido muestra solo la agenda común, nunca las tareas privadas de otros perfiles. Se puede crear para el perfil abierto o Compartido. Los cumpleaños son comunes al equipo.
- Nicolás y Benjamín entran con contraseña verificada en el servidor; Tomás y Compartido tienen acceso directo por decisión del equipo.
- Cada perfil ve únicamente sus minutas, carpetas e hitos. Compartido tiene sus propios documentos y no funciona como acceso a documentos privados.
- Distribución muestra las tareas y estados de todo el equipo. Cambian el estado el responsable y el creador de la minuta; los demás consultan.
- Enter convierte un punto en tarjeta; Shift+Enter permite un salto de línea. Se puede arrastrar a una carpeta o moverla con el selector, también en celular.
- Cada carpeta tiene un responsable. El resumen extractivo se genera automáticamente desde el punteo, reconoce acuerdos explícitos y se puede corregir antes de guardar. No usa un servicio de IA generativa ni inventa plazos, responsables o acuerdos. Desmarcar “Crear tarea” conserva el punto como contexto.
- Guardar y distribuir es atómico: se guarda la minuta y se crean/actualizan sus tareas con claves estables. Volver a guardar conserva el estado de las tareas existentes y no genera duplicados.
- Los estados son Sin iniciar, Iniciada y Terminada. Los tiempos se guardan en el servidor y se muestran en America/Santiago.
- Los hitos guardan año, propósito, directrices, plan y aprendizajes. “Usar como base” abre una nueva edición conservando el registro original.
- Los registros incluyen una papelera con confirmación: minutas, hitos, carpetas, puntos y tareas (incluidas las del calendario, proyectos, cumpleaños y subtareas). Solo el propietario elimina documentos privados; el responsable o creador puede eliminar una tarea distribuida.
- Eliminar una minuta elimina también sus tareas distribuidas. Eliminar una tarea distribuida conserva una marca interna para impedir que reaparezca al guardar la minuta. No hay recuperación desde la aplicación.
- Las carpetas de una minuta incluyen “Convertir en hito histórico”: copia sus puntos y tareas, respeta el estado completado y abre un hito para revisar y guardar, sin eliminar ni modificar el origen. “Mis carpetas guardadas” permite gestionar también la biblioteca. Quitar una carpeta de la minuta deja los puntos sin agrupar; eliminarla de la biblioteca no modifica minutas anteriores.
- Cada hito incluye “Tareas realizadas o por realizar”, con texto editable, casillas de completado y conteos. Los cambios se conservan al guardar. Al usar un hito como base para otro año, las tareas se copian como pendientes y el original conserva su historial.

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

El despliegue de producción se realiza con la integración GitHub → Vercel al actualizar main. Enlace: https://calendario-seven-omega.vercel.app/
