let open = false;

// App-owned, accessible confirmation: closing, backdrop and Escape always cancel.
export function confirmDelete(message) {
  if (open) return Promise.resolve(false);
  open = true;
  const previous = document.activeElement;
  const overlay = document.createElement('div');
  overlay.className = 'delete-confirm-overlay';
  overlay.innerHTML = `<style>
    .delete-confirm-overlay{position:fixed;inset:0;z-index:1000;background:#112a23a8;display:grid;place-items:center;padding:18px;font:14px/1.6 "IBM Plex Sans",system-ui,sans-serif}
    .delete-confirm-box{width:min(440px,100%);background:#fffdf9;color:#233e34;border:1px solid #dce3d8;border-radius:16px;padding:28px;box-shadow:0 22px 80px #0004}
    .delete-confirm-box h2{font:700 24px/1.2 "Bricolage Grotesque",system-ui,sans-serif;margin:0 0 15px}
    .delete-confirm-box p{margin:0 0 24px;white-space:pre-line;overflow-wrap:anywhere}
    .delete-confirm-actions{display:flex;justify-content:flex-end;gap:10px}
    .delete-confirm-actions button{font:600 13px system-ui,sans-serif;border:1px solid #dce3d8;border-radius:9px;padding:11px 18px;min-height:44px;cursor:pointer;background:white;color:#233e34}
    .delete-confirm-actions .confirm-remove{background:#ad493c;color:white;border-color:#ad493c}
    .delete-confirm-actions button:focus-visible{outline:3px solid #bb9952;outline-offset:3px}
  </style><section class="delete-confirm-box" role="alertdialog" aria-modal="true" aria-labelledby="delete-confirm-title" aria-describedby="delete-confirm-message"><h2 id="delete-confirm-title">Confirmar eliminación</h2><p id="delete-confirm-message"></p><div class="delete-confirm-actions"><button type="button" class="confirm-cancel">Cancelar</button><button type="button" class="confirm-remove">Eliminar</button></div></section>`;
  overlay.querySelector('p').textContent = message;
  document.body.append(overlay);
  const cancel = overlay.querySelector('.confirm-cancel');
  const remove = overlay.querySelector('.confirm-remove');
  cancel.focus();
  return new Promise((resolve) => {
    const finish = (confirmed) => {
      overlay.remove(); open = false;
      if (previous?.isConnected) previous.focus();
      resolve(confirmed);
    };
    cancel.addEventListener('click', () => finish(false), { once: true });
    remove.addEventListener('click', () => finish(true), { once: true });
    overlay.addEventListener('click', (event) => { if (event.target === overlay) finish(false); });
    overlay.addEventListener('keydown', (event) => {
      event.stopPropagation();
      if (event.key === 'Escape') { event.preventDefault(); finish(false); }
      if (event.key === 'Tab') { event.preventDefault(); (document.activeElement === cancel ? remove : cancel).focus(); }
    });
  });
}
