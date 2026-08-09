import { disableSubscription, saveSubscription } from './store.js';

function decodePublicKey(base64) {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from([...raw].map((character) => character.charCodeAt(0)));
}

export async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) throw new Error('Este navegador no admite Service Worker.');
  return navigator.serviceWorker.register('/sw.js', { scope: '/' });
}

export async function currentSubscription() {
  if (!('serviceWorker' in navigator)) return null;
  const registration = await navigator.serviceWorker.ready;
  return registration.pushManager.getSubscription();
}

export async function enablePush(person, deviceName) {
  const publicKey = import.meta.env.VITE_VAPID_PUBLIC_KEY;
  if (!publicKey) throw new Error('Falta configurar VITE_VAPID_PUBLIC_KEY.');
  if (!('PushManager' in window) || !('Notification' in window)) throw new Error('Este navegador no admite Web Push.');
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('El permiso de avisos no fue concedido.');
  const registration = await registerServiceWorker();
  let subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: decodePublicKey(publicKey),
    });
  }
  await saveSubscription(subscription, person, deviceName);
  return subscription;
}

export async function disablePush() {
  const subscription = await currentSubscription();
  if (!subscription) return;
  await disableSubscription(subscription.endpoint);
  await subscription.unsubscribe();
}

