# PDR Planner

PDR Planner es un calendario operativo compartido para Nicolás y Benjamín. Reúne tareas, deadlines, subtareas, carga diaria, recurrencias, preparación previa, cumpleaños y avisos Web Push sin cuentas ni login.

No es una plataforma comercial y no almacena RUT, ventas, rankings, mora, contratos ni datos sensibles.

## Arquitectura

- Frontend: Vite + JavaScript nativo, responsive y sin framework de UI.
- Datos: Supabase Postgres con RLS limitado a las tablas del calendario.
- Sincronización: Supabase Realtime sobre tareas, subtareas y cumpleaños.
- Recurrencias: reglas persistentes + materialización bajo demanda mediante una función SQL idempotente.
- Preparación previa: trigger que genera/mueve una tarea de preparación X días hábiles antes.
- Avisos: PWA + Service Worker + Web Push VAPID + Supabase Edge Function.
- Programación: Supabase Cron ejecuta la Edge Function cada 2 minutos. `notification_log` evita duplicados.
- Hosting: Vercel (salida estática en `dist/`).

## Desarrollo local

Requiere Node.js 20 o posterior.

```bash
npm install
cp .env.example .env.local
npm run dev
```

Completa `.env.local` con:

```dotenv
VITE_SUPABASE_URL=https://TU-PROYECTO.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=tu_publishable_key
VITE_VAPID_PUBLIC_KEY=tu_clave_vapid_publica
```

La publishable key se usa en el navegador y no es un secreto. Nunca agregues `SUPABASE_SERVICE_ROLE_KEY` ni `VAPID_PRIVATE_KEY` a variables `VITE_*`.

Si Supabase no está configurado, la app arranca en modo local y conserva datos en `localStorage`; ese modo sirve para desarrollo, pero no sincroniza dispositivos.

## Supabase

Las migraciones versionadas viven en `supabase/migrations/` y crean:

- `tasks` y `subtasks`;
- `birthdays`;
- `notification_subscriptions`;
- `notification_log`;
- `reminder_snoozes`;
- RLS, índices, validaciones, Realtime, recurrencias y preparación previa.

Con Supabase CLI autenticada:

```bash
supabase link --project-ref TU_PROJECT_REF
supabase db push
supabase functions deploy push-dispatch
```

Genera una pareja VAPID una sola vez, por ejemplo con `npx web-push generate-vapid-keys`, y guarda los secretos solo en Supabase:

```bash
supabase secrets set VAPID_PUBLIC_KEY=... VAPID_PRIVATE_KEY=... VAPID_SUBJECT=mailto:tu-correo@ejemplo.cl
```

`SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY` son secretos incorporados por Supabase a las Edge Functions; no es necesario copiarlos.

Después de aplicar las migraciones, configura Vault y Cron una vez desde el SQL Editor (como rol administrador):

```sql
select public.configure_push_cron(
  'https://TU_PROJECT_REF.supabase.co',
  'TU_PUBLISHABLE_KEY'
);
```

La función guarda ambos valores en Supabase Vault y crea `pdr-push-dispatch` con frecuencia de dos minutos. La clave privada VAPID nunca pasa por Postgres, GitHub, Vercel ni el navegador.

## Cómo funcionan los avisos

1. “Activar avisos” registra el Service Worker y solicita permiso.
2. El dispositivo se asocia a Nicolás, Benjamín o Los dos.
3. Cron invoca `push-dispatch` cada dos minutos.
4. La función busca recordatorios previos, vencimientos y avisos pospuestos.
5. Se reserva un registro único en `notification_log` antes de enviar, evitando duplicados.
6. Las suscripciones expiradas (HTTP 404/410) quedan inactivas automáticamente.

Se envía como máximo un recordatorio previo y un aviso de vencimiento por tarea y dispositivo, salvo un “recordar más tarde” solicitado manualmente.

## Instalar como PWA

- Escritorio/Android: usa “Instalar aplicación” o “Agregar a pantalla de inicio” desde el navegador.
- iPhone/iPad: abre la app en Safari, comparte y elige “Agregar a pantalla de inicio”. Web Push en iOS requiere abrir la app desde ese icono y conceder permiso; su disponibilidad depende de la versión del sistema.

## Verificación

```bash
npm run lint
npm test
npm run build
```

Para validar producción: crea, edita, mueve, completa y elimina una tarea desde dos navegadores; comprueba el reflejo por Realtime, recarga ambas sesiones, registra un dispositivo y revisa `cron.job_run_details` y `notification_log`.

## Despliegue en Vercel

Configura las tres variables públicas de `.env.example` en Development, Preview y Production. Después:

```bash
vercel link
vercel env add VITE_SUPABASE_URL production
vercel env add VITE_SUPABASE_PUBLISHABLE_KEY production
vercel env add VITE_VAPID_PUBLIC_KEY production
vercel deploy --prod
```

`vercel.json` configura Vite, el fallback SPA, cabeceras de seguridad y evita que el Service Worker quede cacheado de forma permanente.
