/** Lightweight dialogs and notices shared by the ebook surfaces. */

import { escapeHtml } from '../display/util.js';

let dialogCounter = 0;

function dialogController(overlay, resolve, { canCancel = false, cancelValue = null } = {}) {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    let finished = false;
    const focusableElements = () => [...overlay.querySelectorAll('button, input, select, textarea, a[href], [tabindex]')]
        .filter(element => !element.disabled && !element.hidden && element.tabIndex !== -1);

    const finish = value => {
        if (finished) return;
        finished = true;
        overlay.removeEventListener('keydown', onKeydown);
        overlay.setAttribute('aria-hidden', 'true');
        overlay.style.pointerEvents = 'none';
        overlay.classList.remove('sm-eb-dialog-visible');
        setTimeout(() => {
            overlay.remove();
            if (previousFocus?.isConnected && !previousFocus.closest('[aria-hidden="true"]')) {
                try { previousFocus.focus({ preventScroll: true }); } catch { /* Focus restoration is best-effort. */ }
            }
        }, 140);
        resolve(value);
    };

    const onKeydown = event => {
        if (event.key === 'Escape' && canCancel) {
            event.preventDefault();
            event.stopPropagation();
            finish(cancelValue);
            return;
        }
        if (event.key !== 'Tab') return;
        const focusable = focusableElements();
        if (!focusable.length) {
            event.preventDefault();
            return;
        }
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && (document.activeElement === first || !overlay.contains(document.activeElement))) {
            event.preventDefault();
            last.focus();
        } else if (!event.shiftKey && (document.activeElement === last || !overlay.contains(document.activeElement))) {
            event.preventDefault();
            first.focus();
        }
    };

    overlay.addEventListener('keydown', onKeydown);
    return { finish };
}

function revealDialog(overlay, initialFocus) {
    document.body.appendChild(overlay);
    requestAnimationFrame(() => {
        overlay.classList.add('sm-eb-dialog-visible');
        initialFocus?.focus({ preventScroll: true });
        initialFocus?.select?.();
    });
}

export function notify(message, type = 'info') {
    if (globalThis.toastr?.[type]) {
        globalThis.toastr[type](String(message || ''));
        return;
    }
    const notice = document.createElement('div');
    notice.className = `sm-eb-notice sm-eb-notice-${type}`;
    notice.textContent = String(message || '');
    document.body.appendChild(notice);
    requestAnimationFrame(() => notice.classList.add('sm-eb-notice-visible'));
    setTimeout(() => {
        notice.classList.remove('sm-eb-notice-visible');
        setTimeout(() => notice.remove(), 220);
    }, 2600);
}

export function showChoiceDialog({ title, message = '', choices = [] }) {
    return new Promise(resolve => {
        const titleId = `sm-eb-dialog-title-${++dialogCounter}`;
        const overlay = document.createElement('div');
        overlay.className = 'sm-eb-dialog-overlay';
        overlay.innerHTML = `
            <div class="sm-eb-dialog" role="dialog" aria-modal="true" aria-labelledby="${titleId}">
                <div class="sm-eb-dialog-mark"><i class="fa-solid fa-bookmark"></i></div>
                <h2 id="${titleId}">${escapeHtml(title || 'Story Manager')}</h2>
                ${message ? `<p>${escapeHtml(message)}</p>` : ''}
                <div class="sm-eb-dialog-actions">
                    ${choices.map(choice => `
                        <button type="button" data-choice="${escapeHtml(choice.id)}"
                            ${choice.primary ? 'data-primary' : ''}
                            class="${choice.primary ? 'sm-eb-button-primary' : ''} ${choice.danger ? 'sm-eb-button-danger' : ''}">
                            ${escapeHtml(choice.label)}
                        </button>`).join('')}
                </div>
            </div>`;
        const cancelChoice = choices.find(choice => ['cancel', 'continue'].includes(choice.id));
        const { finish } = dialogController(overlay, resolve, {
            canCancel: !!cancelChoice,
            cancelValue: cancelChoice?.id || null,
        });
        overlay.querySelectorAll('[data-choice]').forEach(button => {
            button.addEventListener('click', () => finish(button.dataset.choice));
        });
        const initialFocus = overlay.querySelector('[data-primary]') || overlay.querySelector('[data-choice]');
        revealDialog(overlay, initialFocus);
    });
}

export function showTextPrompt({ title, message = '', value = '', placeholder = '', confirmLabel = 'Save' }) {
    return new Promise(resolve => {
        const titleId = `sm-eb-dialog-title-${++dialogCounter}`;
        const overlay = document.createElement('div');
        overlay.className = 'sm-eb-dialog-overlay';
        overlay.innerHTML = `
            <form class="sm-eb-dialog sm-eb-dialog-prompt" role="dialog" aria-modal="true" aria-labelledby="${titleId}">
                <div class="sm-eb-dialog-mark"><i class="fa-solid fa-pen-nib"></i></div>
                <h2 id="${titleId}">${escapeHtml(title || 'Name')}</h2>
                ${message ? `<p>${escapeHtml(message)}</p>` : ''}
                <input class="sm-eb-dialog-input" maxlength="160" placeholder="${escapeHtml(placeholder)}">
                <div class="sm-eb-dialog-actions">
                    <button type="button" data-cancel>Cancel</button>
                    <button type="submit" class="sm-eb-button-primary">${escapeHtml(confirmLabel)}</button>
                </div>
            </form>`;
        const form = overlay.querySelector('form');
        const input = overlay.querySelector('input');
        input.value = String(value || '');
        const { finish } = dialogController(overlay, resolve, { canCancel: true, cancelValue: null });
        form.addEventListener('submit', event => {
            event.preventDefault();
            const result = input.value.trim();
            if (result) finish(result);
            else input.focus();
        });
        form.querySelector('[data-cancel]').addEventListener('click', () => finish(null));
        revealDialog(overlay, input);
    });
}
