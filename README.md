# Espacio PDR

Minutas automatizadas, distribución de tareas e hitos históricos para el equipo Santa Clara.

## Funcionamiento

- Selecciona el perfil: Nicolás Albornoz, Benjamín Hernández, Tomás Espinoza o Compartido.
- Nicolás y Benjamín entran con contraseña verificada en el servidor; Tomás y Compartido tienen acceso directo por decisión del equipo.
- Cada perfil ve únicamente sus minutas, carpetas e hitos. Compartido tiene sus propios documentos y no funciona como acceso a documentos privados.
- Distribución muestra las tareas y estados de todo el equipo. Cambian el estado el responsable y el creador de la minuta; los demás consultan.
- Enter convierte un punto en tarjeta; Shift+Enter permite un salto de línea. Se puede arrastrar a una carpeta o moverla con el selector, también en celular.
- Cada carpeta tiene un responsable. El resumen extractivo se genera automáticamente desde el punteo, reconoce acuerdos explícitos y se puede corregir antes de guardar. No usa un servicio de IA generativa ni inventa plazos, responsables o acuerdos. Desmarcar “Crear tarea” conserva el punto como contexto.
- Guardar y distribuir es atómico: se guarda la minuta y se crean/actualizan sus tareas con claves estables. Volver a guardar conserva el estado de las tareas existentes y no genera duplicados.
- Los estados son Sin iniciar, Iniciada y Terminada. Los tiempos se guardan en el servidor y se muestran en America/Santiago.
- Los hitos guardan año, propósito, directrices, plan y aprendizajes. “Usar como base” abre una nueva edición conservando el registro original.

## Arquitectura y privacidad

Frontend Vite/JavaScript en `src/workspace.js`; persistencia Supabase a través de tres RPCs: `pdr_profiles`, `pdr_sign_in` y `pdr_workspace`. Las tablas están en `pdr_private`, con RLS y sin permisos directos para anon/authenticated.

Las sesiones de perfil usan tokens aleatorios de 256 bits almacenados como SHA-256 en la base y duran 12 horas. El navegador conserva el token solo en sessionStorage. La contraseña usa bcrypt y se limita el número de intentos. Los RPCs con SECURITY DEFINER son intencionales: validan la sesión, el propietario y cada operación; tienen search_path vacío y no ejecutan SQL dinámico. El listado de nombres y requisitos de acceso es público para permitir seleccionar perfil.

El PIN compartido es un control básico de perfil, no una identidad individual verificable: cualquiera que conozca el PIN puede entrar al perfil correspondiente. Tomás y Compartido son abiertos por diseño.

Los datos se refrescan cada 20 segundos y los contadores de antigüedad cada minuto. La concurrencia de documentos se controla por versión.

## Reinicio autorizado

La migración `20261030204957_minutes_workspace.sql` retiró las 862 tareas y los 3 proyectos del calendario anterior, desactivó su cron de avisos y bloqueó los clientes antiguos que materializaban recurrencias. Una instantánea administrativa de tareas, subtareas y proyectos se conserva en `pdr_private.legacy_archive`; no es visible desde la aplicación. Los cumpleaños anteriores no se borraron. El código legado se conserva en Git, pero el punto de entrada publicado es el nuevo espacio.

## Desarrollo y verificación

Node.js 20 o posterior. Instala con `npm ci`. Configura `VITE_SUPABASE_URL` y `VITE_SUPABASE_PUBLISHABLE_KEY` en .env.local, usando únicamente la clave pública, nunca service_role.

```sh
npm run dev
npm run lint
npm test
npm run build
```

`supabase/tests/workspace.sql` prueba PIN, sesión, privacidad, distribución, visibilidad de estados, marcas de tiempo, guardado sin duplicados y cierre de sesión dentro de una transacción que se revierte.

El despliegue de producción se realiza con la integración GitHub → Vercel al actualizar main. Enlace: https://calendario-seven-omega.vercel.app/
