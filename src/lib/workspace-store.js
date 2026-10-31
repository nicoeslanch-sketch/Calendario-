import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
const client = url && key ? createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }) : null;
const SESSION_KEY = 'pdr-workspace-session-v1';
export let session = null;
try { session = JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null'); } catch { sessionStorage.removeItem(SESSION_KEY); }

async function rpc(name, args) {
  if (!client) throw new Error('Falta configurar la conexión del espacio PDR.');
  const { data, error } = await client.rpc(name, args);
  if (error) throw new Error(error.message);
  return data;
}

export async function login(profile, pin = '') {
  const result = await rpc('pdr_sign_in', { p_profile: profile, p_pin: pin });
  if (result.error) throw new Error(result.error);
  session = result;
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
  return session;
}

export async function request(action, payload = {}) {
  if (!session) throw new Error('Entra a un perfil para continuar.');
  return rpc('pdr_workspace', { p_action: action, p_token: session.token, p_payload: payload });
}

export async function calendarRequest(action, payload = {}) {
  if (!session) throw new Error('Entra a un perfil para abrir el calendario.');
  const token = session.token;
  const result = await rpc('pdr_calendar', { p_action: action, p_token: token, p_payload: payload });
  if (token !== session?.token) throw new Error('El perfil ha cambiado.');
  return result;
}

export async function logout() {
  try { if (session) await request('logout'); } finally {
    session = null;
    sessionStorage.removeItem(SESSION_KEY);
  }
}

export async function profiles() { return rpc('pdr_profiles', {}); }
