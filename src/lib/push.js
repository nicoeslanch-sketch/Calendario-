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

export async function pushStatus() {
  const supported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  const subscription = supported ? await currentSubscription() : null;
  return {
    supported,
    permission: 'Notification' in window ? Notification.permission : 'unsupported',
    subscribed: Boolean(subscription),
  };
}

export async function showTestNotification() {
  if (!('Notification' in window) || Notification.permission !== 'granted') {
    throw new Error('Chrome todavía no tiene permiso para mostrar avisos.');
  }
  const registration = await registerServiceWorker();
  await navigator.serviceWorker.ready;
  await registration.showNotification('Planner Santa Clara · Aviso de prueba', {
    body: 'Si ves este cuadro, los avisos del calendario pueden mostrarse en este PC.',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    tag: `pdr-test-${Date.now()}`,
    requireInteraction: true,
    data: { url: '/' },
    actions: [
      { action: 'accept', title: 'Aceptar' },
      { action: 'open', title: 'Ir al calendario' },
    ],
  });
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

