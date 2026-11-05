import { createClient } from 'npm:@supabase/supabase-js@2.57.4';
import { documentMeta, MAX_FILE_SIZE } from './validation.js';
import { cleanupDocuments } from './cleanup.js';

// Profile-session authentication is checked by the service-only RPC on every
// operation. No service key or Storage URL is ever sent to a browser.
const client = createClient(Deno.env.get('SUPABASE_URL'), Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'),
  { auth:{persistSession:false,autoRefreshToken:false} });
const bucket = client.storage.from('pdr-hito-documents');
const allowedOrigin = (origin) => origin==='https://calendario-seven-omega.vercel.app'
  || /^http:\/\/(localhost|127\.0\.0\.1):51[78]\d$/.test(origin);

Deno.serve(async (req) => {
  const origin = req.headers.get('origin') || '';
  const headers = { 'Access-Control-Allow-Origin':allowedOrigin(origin)?origin:'https://calendario-seven-omega.vercel.app',
    'Access-Control-Allow-Headers':'content-type, apikey, authorization', 'Access-Control-Allow-Methods':'POST, OPTIONS',
    'Vary':'Origin','Cache-Control':'no-store','X-Content-Type-Options':'nosniff' };
  const json = (body,status=200) => new Response(JSON.stringify(body),{status,headers:{...headers,'Content-Type':'application/json'}});
  if (req.method==='OPTIONS') return new Response(null,{status:204,headers});
  if (req.method!=='POST' || (origin && !allowedOrigin(origin))) return json({error:'Solicitud no permitida.'},403);
  if (Number(req.headers.get('content-length'))>MAX_FILE_SIZE+16384) return json({error:'El archivo supera 5 MB.'},413);
  let token='';
  async function rpc(action,payload={}) {
    const {data,error}=await client.rpc('pdr_hito_file',{p_token:token,p_action:action,p_payload:payload});
    if (error) throw new Error(error.message);
    return data;
  }
  async function cleanup(fileIds) {
    return cleanupDocuments(fileIds,{
      query:(payload)=>rpc('cleanup',payload),
      remove:(paths)=>bucket.remove(paths),
      purge:(payload)=>rpc('purge',payload),
    });
  }
  try {
    const multipart=req.headers.get('content-type')?.includes('multipart/form-data');
    const body=multipart?await req.formData():await req.json();
    const field=(key)=>multipart?body.get(key):body[key];
    token=String(field('token')||'');
    if (!/^[a-f0-9]{64}$/.test(token)) return json({error:'Sesión inválida.'},401);
    const action=field('action');
    // No automatic cleanup during upload, download or copy. Every cleanup
    // authenticates the profile and is bounded by an explicit list of IDs.
    if (action==='cleanup') return json(await cleanup(field('file_ids')));
    if (action==='upload') {
      const file=field('file');
      if (!(file instanceof File)) throw new Error('Selecciona un archivo.');
      const meta=documentMeta(file.name,file.size);
      const saved=await rpc('reserve',{...meta,milestone_id:field('milestone_id')});
      const {error}=await bucket.upload(saved.storage_path,file,{contentType:meta.mime,upsert:false});
      if (error) { await rpc('remove',{file_id:saved.id}); await cleanup([saved.id]); throw new Error('No se pudo subir el archivo. Intenta nuevamente.'); }
      await rpc('ready',{file_id:saved.id});
      return json({ok:true});
    }
    const file=await rpc('get',{file_id:field('file_id')});
    if (action==='download') {
      if (!file.ready) throw new Error('El archivo aún no está disponible.');
      const {data,error}=await bucket.download(file.storage_path);
      if (error) throw new Error('No se pudo descargar el archivo.');
      return new Response(data,{headers:{...headers,'Content-Type':file.mime,
        'Content-Disposition':`attachment; filename*=UTF-8''${encodeURIComponent(file.name)}`}});
    }
    if (action==='remove') { await rpc('remove',{file_id:file.id}); await cleanup([file.id]); return json({ok:true}); }
    if (action==='copy') {
      if (!file.ready) throw new Error('El archivo de origen no está disponible.');
      const meta=documentMeta(file.name,file.size);
      let saved;
      try { saved=await rpc('reserve',{...meta,milestone_id:field('milestone_id'),source_file_id:file.id}); }
      catch(error) { if(error.message.includes('milestone_files_copy_idx')) throw new Error('Ya existe una copia o está en proceso. Recarga el hito antes de reintentar.'); throw error; }
      const {error}=await bucket.copy(file.storage_path,saved.storage_path);
      if(error) { await rpc('remove',{file_id:saved.id}); await cleanup([saved.id]); throw new Error('No se pudo copiar un documento. Puedes reintentar desde la edición.'); }
      await rpc('ready',{file_id:saved.id});
      return json({ok:true});
    }
    throw new Error('Acción de archivo inválida.');
  } catch(error) {
    const message=error instanceof Error?error.message:'No se pudo procesar el archivo.';
    const status=/Sesión/.test(message)?401:/acceso|pertenece/.test(message)?403:400;
    return json({error:message},status);
  }
});
