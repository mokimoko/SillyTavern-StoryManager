/**
 * settings.js — Global configuration for StoryManager
 *
 * Stored in extension_settings.storyManager (ST's standard settings store,
 * persisted via saveSettingsDebounced). This is GLOBAL config — connection
 * profile for description gen, default behaviors, UI prefs. The actual
 * library data (books/storylines) lives in the file store, not here.
 */
import { extension_settings } from '../../../../extensions.js';
import { saveSettingsDebounced } from '../../../../../script.js';

export const MODULE_NAME = 'storyManager';

const DEFAULT_SETTINGS = {
    enabled: true,
    // Description generation
    connectionProfile: '',      // profile name for genned descriptions
    genLength: 'medium',        // short | medium | long
    // UI
    entryPoint: 'display',      // 'display' (open straight to gallery) | 'modal'
    sidebarPinned: false,
    // Behavior
    warnOnChatMove: true,       // warn when reassigning an owned chat
};

export function initSettings() {
    if (!extension_settings[MODULE_NAME]) {
        extension_settings[MODULE_NAME] = structuredClone(DEFAULT_SETTINGS);
    } else {
        // Backfill any missing keys (forward-compat across versions).
        for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) {
            if (extension_settings[MODULE_NAME][k] === undefined) {
                extension_settings[MODULE_NAME][k] = v;
            }
        }
    }
    return extension_settings[MODULE_NAME];
}

export function getSetting(key) {
    const s = extension_settings[MODULE_NAME];
    return s ? s[key] : DEFAULT_SETTINGS[key];
}

export function setSetting(key, value) {
    if (!extension_settings[MODULE_NAME]) initSettings();
    extension_settings[MODULE_NAME][key] = value;
    saveSettingsDebounced();
}

export function getAllSettings() {
    return extension_settings[MODULE_NAME] || DEFAULT_SETTINGS;
}

export function isEnabled() {
    return !!getSetting('enabled');
}
