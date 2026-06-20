/**
 * modal/settingsTab.js — global settings UI (Phase 2)
 *
 * Binds the management modal's Settings tab to settings.js (getSetting/setSetting,
 * persisted via ST's saveSettingsDebounced). These are GLOBAL config knobs — the
 * library data itself lives in the file store, not here.
 *
 *   connectionProfile — ST profile name for description generation (text)
 *   genLength         — short | medium | long (select)
 *   entryPoint        — display | modal (radio): what the side button / wand opens
 *   sidebarPinned     — keep the in-chat sidebar pinned open (checkbox)
 *   warnOnChatMove    — confirm before moving a chat out of another storyline (checkbox)
 *
 * Export: render(container, ctx)
 */
import { getSetting, setSetting } from '../settings.js';
import { getContext } from '../../../../../extensions.js';

export function render(container /*, ctx */) {
    container.innerHTML = `
        <div class="sm-tab-header">
            <div><span class="sm-tab-title">Settings</span></div>
        </div>

        <div class="sm-form">
            <div class="sm-section-label"><i class="fa-solid fa-wand-magic-sparkles"></i> Description Generation</div>

            <div class="sm-field">
                <label class="sm-field-label">Connection Profile</label>
                <select class="sm-select" id="sm-set-profile">
                    <option value="">Use current connection</option>
                </select>
                <div class="sm-setting-desc">Used to generate storyline/book descriptions. Leave blank to disable.</div>
            </div>

            <div class="sm-field">
                <label class="sm-field-label">Generation Length</label>
                <select class="sm-select" id="sm-set-genlength">
                    ${['short', 'medium', 'long'].map(v => `
                        <option value="${v}" ${getSetting('genLength') === v ? 'selected' : ''}>
                            ${v[0].toUpperCase() + v.slice(1)}
                        </option>`).join('')}
                </select>
            </div>

            <hr class="sm-divider-section" />
            <div class="sm-section-label"><i class="fa-solid fa-door-open"></i> Entry Point</div>

            <div class="sm-radio-group">
                <label class="sm-radio">
                    <input type="radio" name="sm-set-entry" value="display"
                           ${getSetting('entryPoint') !== 'modal' ? 'checked' : ''} />
                    <span>Display <span class="sm-setting-desc">— open straight to the gallery</span></span>
                </label>
                <label class="sm-radio">
                    <input type="radio" name="sm-set-entry" value="modal"
                           ${getSetting('entryPoint') === 'modal' ? 'checked' : ''} />
                    <span>Management <span class="sm-setting-desc">— open this modal</span></span>
                </label>
            </div>

            <hr class="sm-divider-section" />
            <div class="sm-section-label"><i class="fa-solid fa-sliders"></i> Behavior</div>

            <div class="sm-setting-item">
                <div>
                    <div class="sm-setting-title">Pin sidebar</div>
                    <div class="sm-setting-desc">Keep the in-chat sidebar open by default.</div>
                </div>
                <input type="checkbox" id="sm-set-pinned" ${getSetting('sidebarPinned') ? 'checked' : ''} />
            </div>

            <div class="sm-setting-item">
                <div>
                    <div class="sm-setting-title">Warn on chat move</div>
                    <div class="sm-setting-desc">Confirm before moving a chat out of another storyline.</div>
                </div>
                <input type="checkbox" id="sm-set-warnmove" ${getSetting('warnOnChatMove') !== false ? 'checked' : ''} />
            </div>
        </div>
    `;

    wire(container);
    populateConnectionProfiles(container);
}

// ============================================================
// Wiring
// ============================================================

function wire(container) {
    container.querySelector('#sm-set-profile')?.addEventListener('change', (e) => {
        setSetting('connectionProfile', e.target.value);
    });

    container.querySelector('#sm-set-genlength')?.addEventListener('change', (e) => {
        setSetting('genLength', e.target.value);
    });

    container.querySelectorAll('input[name="sm-set-entry"]').forEach(radio => {
        radio.addEventListener('change', () => {
            if (radio.checked) setSetting('entryPoint', radio.value);
        });
    });

    container.querySelector('#sm-set-pinned')?.addEventListener('change', (e) => {
        setSetting('sidebarPinned', e.target.checked);
    });

    container.querySelector('#sm-set-warnmove')?.addEventListener('change', (e) => {
        setSetting('warnOnChatMove', e.target.checked);
    });
}

// ============================================================
// Connection profiles
// ============================================================

async function populateConnectionProfiles(container) {
    const select = container.querySelector('#sm-set-profile');
    if (!select) return;
    try {
        const ctx = getContext();
        const result = await ctx.executeSlashCommandsWithOptions('/profile-list');
        const profiles = JSON.parse(result.pipe);
        const current = getSetting('connectionProfile');
        profiles.forEach(name => {
            const opt = document.createElement('option');
            opt.value = name; opt.textContent = name;
            if (name === current) opt.selected = true;
            select.appendChild(opt);
        });
    } catch { /* profiles not available */ }
}
