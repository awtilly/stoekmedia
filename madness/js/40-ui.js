/* ── Toast Notifications ── */
let _toastTimer = null;
function showToast(message, duration = 3000){
  let toast = document.getElementById('toast');
  if(!toast){
    toast = document.createElement('div');
    toast.id = 'toast';
    toast.className = 'toast';
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.className = 'toast show';
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => { toast.className = 'toast'; }, duration);
}

/* ── In-App Modal System ── */
function _showModal(html) {
  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `<div class="modal-box">${html}</div>`;
    document.body.appendChild(overlay);
    requestAnimationFrame(() => requestAnimationFrame(() => overlay.classList.add('show')));

    overlay._resolve = resolve;
    overlay._close = (val) => {
      overlay.classList.remove('show');
      setTimeout(() => { overlay.remove(); resolve(val); }, 200);
    };

    overlay.addEventListener('click', e => { if (e.target === overlay) overlay._close(null); });

    const input = overlay.querySelector('.modal-input');
    if (input) setTimeout(() => input.focus(), 100);
  });
}

/* Attributes for appPrompt's <input>. PIN prompts (the message says "4-digit", or the caller passes
   inputmode: 'numeric') are masked like the join screen's PIN box (a commissioner unlocking admin on a
   screen cast to the TV must not show the PIN) and get the phone number pad, a 4-character cap and no
   autocorrect/suggestions; every other prompt keeps exactly the attributes it had. */
function promptInputAttrs(message, { placeholder = '', defaultValue = '', inputmode = '' } = {}) {
  const numeric = inputmode === 'numeric' || /(^|[^0-9a-z])4-digit([^0-9a-z]|$)/i.test(message || '');
  let attrs = `placeholder="${escapeHtml(placeholder)}" value="${escapeHtml(defaultValue)}"`;
  if (numeric) attrs += ' type="password" inputmode="numeric" pattern="[0-9]*" maxlength="4" autocomplete="off" autocapitalize="off" spellcheck="false" enterkeyhint="done"';
  else if (inputmode) attrs += ` inputmode="${escapeHtml(inputmode)}"`;
  return attrs;
}

function appPrompt(message, { title = '', placeholder = '', defaultValue = '', inputmode = '' } = {}) {
  const id = 'mp_' + Date.now();
  const html = `
    ${title ? `<div class="modal-title">${escapeHtml(title)}</div>` : ''}
    <div class="modal-msg">${escapeHtml(message)}</div>
    <input class="modal-input" id="${id}" ${promptInputAttrs(message, { placeholder, defaultValue, inputmode })}>
    <div class="modal-actions">
      <button class="btn btn-secondary" onclick="this.closest('.modal-overlay')._close(null)">Cancel</button>
      <button class="btn btn-primary" onclick="this.closest('.modal-overlay')._close(document.getElementById('${id}').value)">OK</button>
    </div>`;
  const p = _showModal(html);
  // Allow enter key to submit
  setTimeout(() => {
    const input = document.getElementById(id);
    if (input) input.addEventListener('keydown', e => { if (e.key === 'Enter') input.closest('.modal-overlay')._close(input.value); });
  }, 50);
  return p;
}

function appConfirm(message, { title = '', confirmLabel = 'Confirm', danger = false } = {}) {
  const html = `
    ${title ? `<div class="modal-title">${escapeHtml(title)}</div>` : ''}
    <div class="modal-msg">${escapeHtml(message)}</div>
    <div class="modal-actions">
      <button class="btn btn-secondary" onclick="this.closest('.modal-overlay')._close(false)">Cancel</button>
      <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" onclick="this.closest('.modal-overlay')._close(true)">${escapeHtml(confirmLabel)}</button>
    </div>`;
  return _showModal(html);
}

function appChoice(message, choices, { title = '' } = {}) {
  const html = `
    ${title ? `<div class="modal-title">${escapeHtml(title)}</div>` : ''}
    <div class="modal-msg">${escapeHtml(message)}</div>
    <div class="modal-choices">
      ${choices.map((ch, i) => `<button class="modal-choice-btn" onclick="this.closest('.modal-overlay')._close(${i})">${escapeHtml(ch)}</button>`).join('')}
    </div>
    <div class="modal-actions">
      <button class="btn btn-secondary" onclick="this.closest('.modal-overlay')._close(null)">Cancel</button>
    </div>`;
  return _showModal(html);
}

function appAlert(message, { title = '' } = {}) {
  const html = `
    ${title ? `<div class="modal-title">${escapeHtml(title)}</div>` : ''}
    <div class="modal-msg">${escapeHtml(message)}</div>
    <div class="modal-actions">
      <button class="btn btn-primary" onclick="this.closest('.modal-overlay')._close(true)">OK</button>
    </div>`;
  return _showModal(html);
}

