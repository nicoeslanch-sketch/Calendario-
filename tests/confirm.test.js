import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { confirmDelete } from '../src/lib/confirm.js';

let overlay;
let buttons;
beforeEach(() => {
  const element = () => ({ handlers: {}, isConnected: true,
    addEventListener(type, handler) { this.handlers[type] = handler; },
    focus() { document.activeElement = this; }, remove() { this.isConnected = false; },
  });
  buttons = { '.confirm-cancel': element(), '.confirm-remove': element(), p: element() };
  overlay = { ...element(), querySelector: (selector) => buttons[selector] };
  vi.stubGlobal('document', { activeElement: element(), createElement: () => overlay, body: { append: vi.fn() } });
});
afterEach(() => vi.unstubAllGlobals());

it('defaults to Cancel and confirms only an explicit Delete click', async () => {
  const result = confirmDelete('¿Eliminar?');
  expect(document.activeElement).toBe(buttons['.confirm-cancel']);
  buttons['.confirm-remove'].handlers.click();
  expect(await result).toBe(true);
  expect(overlay.isConnected).toBe(false);
});
it('Cancel keeps the record and treats message text as text', async () => {
  const result = confirmDelete('<img onerror="unsafe">');
  expect(buttons.p.textContent).toBe('<img onerror="unsafe">');
  buttons['.confirm-cancel'].handlers.click();
  expect(await result).toBe(false);
});
it('Escape cancels and repeated clicks cannot open multiple dialogs', async () => {
  const result = confirmDelete('¿Eliminar?');
  expect(await confirmDelete('Otra eliminación')).toBe(false);
  overlay.handlers.keydown({ key: 'Escape', stopPropagation() {}, preventDefault() {} });
  expect(await result).toBe(false);
});
