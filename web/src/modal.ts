/**
 * Modern In-DOM Modal Dialog System for Impossibru!
 * Provides Promise-based Alert, Confirm, Prompt, and Custom Dialogs
 * with live inline validation, focus trapping, and keyboard navigation.
 */

export interface ModalAlertOptions {
  title?: string;
  message: string;
  confirmText?: string;
}

export interface ModalConfirmOptions {
  title?: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  isDanger?: boolean;
}

export interface ModalPromptOptions {
  title: string;
  message?: string;
  defaultValue?: string;
  placeholder?: string;
  confirmText?: string;
  cancelText?: string;
  validate?: (value: string) => string | null;
}

export interface ModalColorReplaceOptions {
  title?: string;
  palette: Record<string, any>;
  currentPart: string;
  currentColor: string;
  fromChar?: string;
}

export interface ColorReplaceResult {
  fromChar: string;
  toChar: string;
  scope: 'part' | 'all';
}

let activeResolver: ((value: any) => void) | null = null;
let previousActiveElement: HTMLElement | null = null;

function getModalElements() {
  return {
    overlay: document.getElementById('modalOverlay') as HTMLDivElement,
    card: document.querySelector('.modal-card') as HTMLDivElement,
    title: document.getElementById('modalTitle') as HTMLElement,
    message: document.getElementById('modalMessage') as HTMLParagraphElement,
    inputContainer: document.getElementById('modalInputContainer') as HTMLDivElement,
    input: document.getElementById('modalInput') as HTMLInputElement,
    error: document.getElementById('modalError') as HTMLDivElement,
    customSlot: document.getElementById('modalCustomSlot') as HTMLDivElement,
    cancelBtn: document.getElementById('modalCancelButton') as HTMLButtonElement,
    confirmBtn: document.getElementById('modalConfirmButton') as HTMLButtonElement,
    closeBtn: document.getElementById('modalClose') as HTMLButtonElement,
  };
}

function closeModal(result: any) {
  const el = getModalElements();
  if (!el.overlay) return;

  el.overlay.classList.add('hidden');
  el.overlay.classList.remove('active');
  document.removeEventListener('keydown', handleModalKeydown);

  const resolve = activeResolver;
  activeResolver = null;

  if (previousActiveElement && typeof previousActiveElement.focus === 'function') {
    previousActiveElement.focus();
    previousActiveElement = null;
  }

  if (resolve) {
    resolve(result);
  }
}

function handleModalKeydown(event: KeyboardEvent) {
  const el = getModalElements();
  if (!el.overlay || el.overlay.classList.contains('hidden')) return;

  if (event.key === 'Escape') {
    event.preventDefault();
    event.stopPropagation();
    // Escape behaves like cancel
    el.cancelBtn.click();
    return;
  }

  if (event.key === 'Enter') {
    // Only submit on Enter if target is not a textarea or cancel button
    if (event.target !== el.cancelBtn && !el.confirmBtn.disabled) {
      event.preventDefault();
      event.stopPropagation();
      el.confirmBtn.click();
      return;
    }
  }

  // Focus trap
  if (event.key === 'Tab') {
    const focusable = el.card.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    );
    if (!focusable.length) return;

    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    if (event.shiftKey) {
      if (document.activeElement === first) {
        event.preventDefault();
        last.focus();
      }
    } else {
      if (document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
  }
}

function setupModalBase(titleText: string, messageText: string = '') {
  const el = getModalElements();
  if (!el.overlay) {
    throw new Error('Modal overlay DOM element not found');
  }

  // Abort any existing modal
  if (activeResolver) {
    closeModal(null);
  }

  previousActiveElement = document.activeElement as HTMLElement;

  el.title.textContent = titleText;
  el.message.textContent = messageText;
  el.message.classList.toggle('hidden', !messageText);
  el.inputContainer.classList.add('hidden');
  el.error.classList.add('hidden');
  el.error.textContent = '';
  el.customSlot.classList.add('hidden');
  el.customSlot.replaceChildren();

  el.confirmBtn.className = 'modal-confirm';
  el.confirmBtn.disabled = false;
  el.confirmBtn.textContent = 'OK';
  el.cancelBtn.classList.remove('hidden');
  el.cancelBtn.textContent = 'Cancel';

  el.overlay.classList.remove('hidden');
  el.overlay.classList.add('active');

  document.addEventListener('keydown', handleModalKeydown);

  el.closeBtn.onclick = () => closeModal(null);
  el.overlay.onclick = (e) => {
    if (e.target === el.overlay) {
      el.cancelBtn.click();
    }
  };
}

/**
 * Modern In-DOM Alert Dialog
 */
export function modalAlert(options: string | ModalAlertOptions): Promise<void> {
  const opts: ModalAlertOptions = typeof options === 'string' ? { message: options } : options;
  return new Promise<void>((resolve) => {
    setupModalBase(opts.title || 'Notice', opts.message);
    const el = getModalElements();

    el.cancelBtn.classList.add('hidden');
    el.confirmBtn.textContent = opts.confirmText || 'OK';

    activeResolver = () => resolve();

    el.confirmBtn.onclick = () => closeModal(undefined);
    setTimeout(() => el.confirmBtn.focus(), 10);
  });
}

/**
 * Modern In-DOM Confirm Dialog
 */
export function modalConfirm(options: string | ModalConfirmOptions): Promise<boolean> {
  const opts: ModalConfirmOptions = typeof options === 'string' ? { message: options } : options;
  return new Promise<boolean>((resolve) => {
    setupModalBase(opts.title || 'Confirm', opts.message);
    const el = getModalElements();

    el.cancelBtn.textContent = opts.cancelText || 'Cancel';
    el.confirmBtn.textContent = opts.confirmText || 'Confirm';

    if (opts.isDanger) {
      el.confirmBtn.classList.add('danger');
    }

    activeResolver = (val) => resolve(!!val);

    el.cancelBtn.onclick = () => closeModal(false);
    el.confirmBtn.onclick = () => closeModal(true);

    setTimeout(() => {
      if (opts.isDanger) {
        el.cancelBtn.focus();
      } else {
        el.confirmBtn.focus();
      }
    }, 10);
  });
}

/**
 * Modern In-DOM Prompt Dialog with live inline validation
 */
export function modalPrompt(options: ModalPromptOptions): Promise<string | null> {
  return new Promise<string | null>((resolve) => {
    setupModalBase(options.title, options.message || '');
    const el = getModalElements();

    el.inputContainer.classList.remove('hidden');
    el.input.value = options.defaultValue || '';
    el.input.placeholder = options.placeholder || '';
    el.cancelBtn.textContent = options.cancelText || 'Cancel';
    el.confirmBtn.textContent = options.confirmText || 'OK';

    const checkValidity = () => {
      const val = el.input.value;
      if (options.validate) {
        const errorMsg = options.validate(val);
        if (errorMsg) {
          el.error.textContent = errorMsg;
          el.error.classList.remove('hidden');
          el.input.classList.add('invalid');
          el.confirmBtn.disabled = true;
          return false;
        }
      }
      el.error.textContent = '';
      el.error.classList.add('hidden');
      el.input.classList.remove('invalid');
      el.confirmBtn.disabled = false;
      return true;
    };

    el.input.oninput = () => checkValidity();

    activeResolver = (val) => resolve(val !== null && val !== undefined ? String(val) : null);

    el.cancelBtn.onclick = () => closeModal(null);
    el.confirmBtn.onclick = () => {
      if (checkValidity()) {
        closeModal(el.input.value);
      }
    };

    checkValidity();
    setTimeout(() => {
      el.input.focus();
      el.input.select();
    }, 10);
  });
}

/**
 * Modern In-DOM Color Replace Dialog
 */
export function modalColorReplace(options: ModalColorReplaceOptions): Promise<ColorReplaceResult | null> {
  return new Promise<ColorReplaceResult | null>((resolve) => {
    setupModalBase(options.title || 'Replace Color', 'Replace all occurrences of a color in the active part or across all parts.');
    const el = getModalElements();

    el.customSlot.classList.remove('hidden');

    const form = document.createElement('div');
    form.className = 'modal-replace-form';

    // From Color Selector
    const fromRow = document.createElement('div');
    fromRow.className = 'modal-form-row';
    const fromLabel = document.createElement('label');
    fromLabel.textContent = 'From Color:';
    const fromSelect = document.createElement('select');
    fromSelect.id = 'modalReplaceFrom';
    Object.keys(options.palette).forEach(ch => {
      const opt = new Option(`'${ch}' (${options.palette[ch]})`, ch);
      fromSelect.append(opt);
    });
    if (options.fromChar && options.palette[options.fromChar]) {
      fromSelect.value = options.fromChar;
    } else if (options.currentColor && options.palette[options.currentColor]) {
      fromSelect.value = options.currentColor;
    }
    fromRow.append(fromLabel, fromSelect);

    // To Color Selector
    const toRow = document.createElement('div');
    toRow.className = 'modal-form-row';
    const toLabel = document.createElement('label');
    toLabel.textContent = 'To Color:';
    const toSelect = document.createElement('select');
    toSelect.id = 'modalReplaceTo';
    toSelect.append(new Option('. (Erase / Transparent)', '.'));
    Object.keys(options.palette).forEach(ch => {
      const opt = new Option(`'${ch}' (${options.palette[ch]})`, ch);
      toSelect.append(opt);
    });
    // Default to a different color or erase
    const allChars = Object.keys(options.palette);
    const otherChar = allChars.find(c => c !== fromSelect.value) || '.';
    toSelect.value = otherChar;
    toRow.append(toLabel, toSelect);

    // Scope Selector (Active Part vs All Parts)
    const scopeRow = document.createElement('div');
    scopeRow.className = 'modal-form-row';
    const scopeLabel = document.createElement('label');
    scopeLabel.textContent = 'Scope:';
    const scopeSelect = document.createElement('select');
    scopeSelect.id = 'modalReplaceScope';
    scopeSelect.append(new Option(`Active Part (${options.currentPart})`, 'part'));
    scopeSelect.append(new Option('All Parts in Project', 'all'));
    scopeRow.append(scopeLabel, scopeSelect);

    form.append(fromRow, toRow, scopeRow);
    el.customSlot.append(form);

    el.confirmBtn.textContent = 'Replace';
    activeResolver = (val) => resolve(val);

    el.cancelBtn.onclick = () => closeModal(null);
    el.confirmBtn.onclick = () => {
      closeModal({
        fromChar: fromSelect.value,
        toChar: toSelect.value,
        scope: scopeSelect.value as 'part' | 'all'
      });
    };

    setTimeout(() => fromSelect.focus(), 10);
  });
}
