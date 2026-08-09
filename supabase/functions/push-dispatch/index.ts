import { withSupabase } from 'jsr:@supabase/server@^1';
import webpush from 'npm:web-push@3.6.7';

const vapidPublicKey = Deno.env.get('VAPID_PUBLIC_KEY')!;
const vapidPrivateKey = Deno.env.get('VAPID_PRIVATE_KEY')!;
const vapidSubject = Deno.env.get('VAPID_SUBJECT') || 'mailto:planner@example.com';

webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);

type Candidate = {
  task_id: string;
  subscription_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  kind: 'reminder' | 'overdue' | 'snooze';
  scheduled_for: string;
  task_title: string;
  deadline_time: string;
};

function payload(candidate: Candidate) {
  const deadline = candidate.deadline_time?.slice(0, 5);
  if (candidate.kind === 'overdue') {
    return { title: '🔴 Tarea vencida', body: `${candidate.task_title} alcanzó su hora límite${deadline ? ` (${deadline})` : ''}.`, tag: `overdue-${candidate.task_id}-${candidate.scheduled_for}`, taskId: candidate.task_id, url: `/?task=${candidate.task_id}` };
  }
  if (candidate.kind === 'snooze') {
    return { title: 'PDR Planner · Recordatorio', body: `${candidate.task_title}${deadline ? ` · Hora límite ${deadline}` : ''}.`, tag: `snooze-${candidate.task_id}-${candidate.scheduled_for}`, taskId: candidate.task_id, url: `/?task=${candidate.task_id}` };
  }
  return { title: 'PDR Planner · Próximo vencimiento', body: `${candidate.task_title}.${deadline ? ` Hora límite: ${deadline}.` : ''}`, tag: `reminder-${candidate.task_id}-${candidate.scheduled_for}`, taskId: candidate.task_id, url: `/?task=${candidate.task_id}` };
}

export default {
  fetch: withSupabase({ auth: 'secret' }, async (request, context) => {
    if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });
    if (!vapidPublicKey || !vapidPrivateKey) return Response.json({ error: 'VAPID secrets are not configured' }, { status: 503 });

    const supabase = context.supabaseAdmin;
    const { data, error } = await supabase.rpc('notification_candidates');
    if (error) return Response.json({ error: error.message }, { status: 500 });

    const results = await Promise.all((data as Candidate[]).slice(0, 250).map(async (candidate) => {
      const claim = await supabase.from('notification_log').insert({
        task_id: candidate.task_id,
        subscription_id: candidate.subscription_id,
        kind: candidate.kind,
        scheduled_for: candidate.scheduled_for,
        status: 'pending',
      }).select('id').single();
      if (claim.error) return { status: 'duplicate' };

      try {
        await webpush.sendNotification({ endpoint: candidate.endpoint, keys: { p256dh: candidate.p256dh, auth: candidate.auth } }, JSON.stringify(payload(candidate)), { TTL: 3600, urgency: 'high' });
        await supabase.from('notification_log').update({ status: 'sent', sent_at: new Date().toISOString() }).eq('id', claim.data.id);
        return { status: 'sent' };
      } catch (sendError) {
        const statusCode = typeof sendError === 'object' && sendError && 'statusCode' in sendError ? Number(sendError.statusCode) : 0;
        const expired = statusCode === 404 || statusCode === 410;
        await supabase.from('notification_log').update({ status: expired ? 'expired' : 'failed', error: String(sendError).slice(0, 2000) }).eq('id', claim.data.id);
        if (expired) await supabase.from('notification_subscriptions').update({ active: false }).eq('id', candidate.subscription_id);
        return { status: expired ? 'expired' : 'failed' };
      }
    }));

    return Response.json({ processed: results.length, sent: results.filter((result) => result.status === 'sent').length });
  }),
};

