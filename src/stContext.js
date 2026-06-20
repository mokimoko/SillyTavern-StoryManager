/**
 * stContext.js — SillyTavern API bridges for StoryManager
 *
 * Centralizes every touchpoint with ST internals so the rest of the
 * extension never reaches into ST directly. All hooks into other
 * extensions (Summarizer) are feature-detected and degrade gracefully.
 *
 * CONFIRMED against ST source (src/endpoints/characters.js):
 *   POST /api/characters/chats  body { avatar_url, simple?, metadata? }
 *     - avatar_url: character .png filename
 *     - simple:true  → [{ file_name, file_id }]
 *     - default      → [{ file_name, file_id, file_size, chat_items,
 *                          mes, last_mes, chat_metadata? }]
 *     - EDGE CASES: returns { error: true } (object!) if the character's
 *       chat dir doesn't exist, and [] if it exists but is empty.
 *       Callers MUST treat a non-array result as "no chats".
 */
import { getRequestHeaders } from '../../../../../script.js';
import { getContext } from '../../../../extensions.js';
import { tags as stTagList, tag_map as stTagMap } from '../../../../tags.js';
import { logWarn, logError } from './display/util.js';

// ============================================================
// Current character / chat metadata
// ============================================================

/**
 * Build a {name, avatar, displayName} identity for a character, with
 * collision-aware displayName (mirrors SimpleSummarizer's approach —
 * avatar disambiguates same-named cards).
 */
export function buildCharacterIdentity(character, allCharacters) {
    if (!character) return { name: '', avatar: '', displayName: '' };
    const sameName = (allCharacters || []).filter(c => c.name === character.name);
    const displayName = sameName.length > 1
        ? `${character.name} (${character.avatar})`
        : character.name;
    return { name: character.name, avatar: character.avatar, displayName };
}

/** The currently active character, or null (also null in group chats). */
export function getCurrentCharacter() {
    const context = getContext();
    const id = context.characterId;
    if (id === undefined || id === null) return null;
    const character = context.characters?.[id];
    if (!character) return null;
    return buildCharacterIdentity(character, context.characters);
}

export function isGroupChat() {
    return !!getContext().groupId;
}

// ============================================================
// Characters
// ============================================================

/** All loaded characters as identity objects. */
export function getAllCharacters() {
    const context = getContext();
    return (context.characters || [])
        .filter(c => c.avatar && c.name)
        .map(c => buildCharacterIdentity(c, context.characters));
}

// ============================================================
// Groups
// ============================================================
//
// ST group objects live on context.groups. Confirmed-enough shape (defensive —
// every field is guarded because it varies across ST versions):
//   { id, name, members:[avatarPng...], avatar_url, chat_id (active),
//     chats:[chatId...], past_metadata:{ [chatId]:{...} } }
// Group chat files are stored server-side by chat id (no character folder), so
// their enumeration + open paths differ from single-character chats.

/** Resolve a group object by id from context.groups (null if absent). */
function findGroup(groupId) {
    if (!groupId) return null;
    const context = getContext();
    return (context.groups || []).find(g => String(g.id) === String(groupId)) || null;
}

/** Build a stable identity for a group. */
export function buildGroupIdentity(group) {
    if (!group) return null;
    return {
        type: 'group',
        groupId: String(group.id),
        name: group.name || 'Group',
        members: Array.isArray(group.members) ? [...group.members] : [],
        avatar: group.avatar_url || '',
    };
}

/** The currently active group as an identity, or null when not in a group chat. */
export function getCurrentGroup() {
    const context = getContext();
    if (!context.groupId) return null;
    const group = findGroup(context.groupId);
    if (!group) return null;
    const id = buildGroupIdentity(group);
    return { ...id, activeChatId: group.chat_id || context.chatId || null };
}

/** All groups as identity objects (for the storyline editor's cast picker). */
export function getAllGroups() {
    const context = getContext();
    return (context.groups || [])
        .filter(g => g && g.id)
        .map(buildGroupIdentity);
}

/**
 * List a group's chat files, normalized to the SAME shape getChatsForCharacter
 * returns in simple mode ([{ file_name }]) so the editor treats both uniformly.
 * The list comes straight off the group object's `chats` array; per-chat
 * metadata (message counts, dates) lives in `past_metadata` when present.
 * @param {string} groupId
 * @returns {Promise<Array<{file_name:string}>>}
 */
export async function getChatsForGroup(groupId) {
    const group = findGroup(groupId);
    if (!group) return [];
    const ids = Array.isArray(group.chats) ? group.chats : [];
    return ids
        .filter(Boolean)
        .map(chatId => ({ file_name: String(chatId).replace(/\.jsonl$/i, '') }));
}

/**
 * Fetch the parsed messages of a single GROUP chat file.
 * CONFIRMED endpoint family: POST /api/chats/group/get with { id: chatId }.
 * Returns the same header+messages JSONL shape as the character endpoint, so we
 * filter to objects carrying a `mes` string (drops the metadata header line).
 * @param {string} chatId - group chat file id (with or without .jsonl)
 * @returns {Promise<Array<{name:string,is_user:boolean,mes:string}>>}
 */
export async function getGroupChatMessages(chatId) {
    if (!chatId) return [];
    const bare = String(chatId).replace(/\.jsonl$/i, '');
    try {
        const response = await fetch('/api/chats/group/get', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({ id: bare }),
        });
        if (!response.ok) return [];
        const data = await response.json();
        if (!Array.isArray(data)) return [];
        return data.filter(m => m && typeof m.mes === 'string');
    } catch (e) {
        logError('getGroupChatMessages failed:', e);
        return [];
    }
}

/**
 * Open a specific group chat. Group opening differs from characters: we select
 * the group (openGroupById) and, when a specific chat is requested that isn't
 * the group's active one, switch to it via the group chat open path.
 *
 * ST API names here are feature-detected because they vary/aren't guaranteed on
 * the context object across versions. If only the group can be opened (not the
 * exact chat), we still open the group and warn rather than failing silently.
 * @param {string} groupId
 * @param {string} chatId - group chat file id (without extension preferred)
 * @returns {Promise<boolean>} true if an open was attempted
 */
export async function openGroupChat(groupId, chatId) {
    const context = getContext();
    if (!groupId) return false;
    const bare = chatId ? String(chatId).replace(/\.jsonl$/i, '') : '';

    // Preferred: a direct "open this group's specific chat" call if exposed.
    if (typeof context.openGroupChat === 'function' && bare) {
        try { await context.openGroupChat(groupId, bare); return true; }
        catch (e) { logWarn('context.openGroupChat failed, falling back:', e?.message); }
    }

    // Select the group (loads its active chat).
    if (typeof context.openGroupById === 'function') {
        try {
            await context.openGroupById(groupId);
            // If a different chat was requested, try to switch to it.
            const group = findGroup(groupId);
            const active = group?.chat_id ? String(group.chat_id).replace(/\.jsonl$/i, '') : '';
            if (bare && active && bare !== active) {
                if (typeof context.openGroupChat === 'function') {
                    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
                    try { await context.openGroupChat(groupId, bare); }
                    catch { logWarn('Opened group but could not switch to chat', bare); }
                } else {
                    logWarn('Opened group; specific-chat switch API unavailable for', bare);
                }
            }
            return true;
        } catch (e) {
            logError('openGroupById failed:', e);
        }
    }

    logWarn('No available method to open group chat', groupId, bare);
    return false;
}

// ============================================================
// Personas
// ============================================================

/**
 * All personas as {name, avatar, title} objects.
 * Pulled from power_user.personas + persona_descriptions (best-effort;
 * these live on the context/power_user object across ST versions).
 */
export function getAllPersonas() {
    const context = getContext();
    const pu = context.powerUserSettings || context.power_user || {};
    const personas = pu.personas || {};
    const descriptions = pu.persona_descriptions || {};
    return Object.entries(personas).map(([avatar, name]) => ({
        name,
        avatar,
        title: descriptions[avatar]?.title || '',
    }));
}

// ============================================================
// Chat enumeration  (THE confirmed critical API)
// ============================================================

/**
 * List a character's chat files.
 * @param {string} avatarUrl - character .png filename
 * @param {{simple?: boolean, metadata?: boolean}} opts
 * @returns {Promise<Array>} array of chat info objects ([] on none/error)
 */
export async function getChatsForCharacter(avatarUrl, opts = {}) {
    if (!avatarUrl) return [];
    try {
        const response = await fetch('/api/characters/chats', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({
                avatar_url: avatarUrl,
                simple: !!opts.simple,
                metadata: !!opts.metadata,
            }),
        });
        if (!response.ok) return [];
        const data = await response.json();
        // CRITICAL GUARD: endpoint returns { error: true } (object) when the
        // character has no chat directory. Only an array means real results.
        if (!Array.isArray(data)) return [];
        return data;
    } catch (e) {
        logError('getChatsForCharacter failed:', e);
        return [];
    }
}

// ============================================================
// Raw chat messages  (fallback context for description gen)
// ============================================================

/**
 * Fetch the parsed messages of a single chat file.
 * CONFIRMED against ST source (src/endpoints/chats.js POST /get):
 *   body { avatar_url, file_name (no extension) } → array of JSONL lines.
 *   The FIRST line is a metadata header ({ user_name, character_name,
 *   chat_metadata, ... }) with no `mes` field; every subsequent line is a
 *   message ({ name, is_user, mes, send_date, ... }). We filter to objects
 *   that actually carry a `mes` string so the header is dropped.
 * @param {string} avatarUrl - owning character's .png filename
 * @param {string} fileName - chat file name (with or without .jsonl)
 * @returns {Promise<Array<{name:string,is_user:boolean,mes:string}>>}
 */
export async function getChatMessages(avatarUrl, fileName) {
    if (!avatarUrl || !fileName) return [];
    const bare = String(fileName).replace(/\.jsonl$/i, '');
    try {
        const response = await fetch('/api/chats/get', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({ avatar_url: avatarUrl, file_name: bare }),
        });
        if (!response.ok) return [];
        const data = await response.json();
        if (!Array.isArray(data)) return []; // {} on missing/empty chat
        return data.filter(m => m && typeof m.mes === 'string');
    } catch (e) {
        logError('getChatMessages failed:', e);
        return [];
    }
}

// ============================================================
// Open a chat  (jump-to-chat for the Display)
// ============================================================
/**
 * Open a specific chat for the currently selected character.
 * NOTE (confirmed from script.js openCharacterChat): this operates on the
 * ALREADY-SELECTED character. Jumping to a chat that belongs to a different
 * character requires selecting that character first — handled in Phase 4.
 * @param {string} fileName - chat file name WITHOUT the .jsonl extension
 */
export async function openChat(fileName) {
    const context = getContext();
    const bare = fileName.replace(/\.jsonl$/i, '');
    if (typeof context.openCharacterChat === 'function') {
        return context.openCharacterChat(bare);
    }
    // Fallback: slash command.
    if (typeof context.executeSlashCommandsWithOptions === 'function') {
        return context.executeSlashCommandsWithOptions(`/chat ${bare}`);
    }
    throw new Error('No available method to open chat');
}

/**
 * Open a chat that may belong to a DIFFERENT character than the one currently
 * selected. The Display lists chats across all storylines/characters, so this
 * is the entry point its chat rows use.
 *
 * Strategy (confirmed against script.js):
 *   - selectCharacterById(id) takes the NUMERIC index into context.characters,
 *     not the avatar. We resolve the avatar → index first.
 *   - If the chat already belongs to the active character, skip the select and
 *     just openChat() (avoids clearing/reloading the current chat needlessly).
 *   - After selecting a different character we yield a frame so ST can settle
 *     before opening the specific chat file.
 *
 * @param {string} avatar - owning character's .png filename
 * @param {string} fileName - chat file name (with or without .jsonl)
 * @returns {Promise<boolean>} true if an open was attempted
 */
export async function openChatForCharacter(avatar, fileName) {
    const context = getContext();
    if (!fileName) return false;

    // Already on the right character? Just open the chat.
    const current = getCurrentCharacter();
    if (avatar && current && current.avatar === avatar) {
        await openChat(fileName);
        return true;
    }

    // Resolve avatar → character index.
    if (avatar && Array.isArray(context.characters)) {
        const id = context.characters.findIndex(c => c?.avatar === avatar);
        if (id !== -1 && typeof context.selectCharacterById === 'function') {
            await context.selectCharacterById(id);
            // Let ST finish swapping characters before opening the chat file.
            await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
            await openChat(fileName);
            return true;
        }
    }

    // Fallback: try a plain open against whatever's selected (best effort).
    await openChat(fileName);
    return true;
}

/**
 * Open a stored chat entry regardless of its source (character or group).
 * This is the single entry point the Display / sidebar should use so callers
 * never branch on source themselves.
 *
 * - source 'character' → existing openChatForCharacter path.
 * - source 'group'     → group open path (implemented in Step 4; until then it
 *   logs and returns false rather than silently doing nothing wrong).
 *
 * @param {{source?:string, avatar?:string, groupId?:string, file_name:string}} entry
 * @returns {Promise<boolean>} true if an open was attempted
 */
export async function openChatEntry(entry) {
    if (!entry || !entry.file_name) return false;
    const source = entry.source || 'character';
    if (source === 'group') {
        return openGroupChat(entry.groupId, entry.file_name);
    }
    return openChatForCharacter(entry.avatar, entry.file_name);
}

// ============================================================
// Summarizer hook (optional)
// ============================================================

export function hasSummarizer() {
    return !!(window.Summarizer && window.Summarizer.isInstalled);
}

/**
 * Get a comprehensive summary for a chat file, if Summarizer is present.
 * @returns {Promise<object|null>}
 */
export async function getSummaryForChat(fileName) {
    if (!hasSummarizer() || typeof window.Summarizer.getSummary !== 'function') {
        return null;
    }
    try {
        return await window.Summarizer.getSummary(fileName);
    } catch (e) {
        logError('getSummaryForChat failed:', e);
        return null;
    }
}

/** Quick boolean: does a comprehensive summary exist for this chat? */
export async function chatHasSummary(fileName) {
    return !!(await getSummaryForChat(fileName));
}

// ============================================================
// Connection profiles (for description generation)
// ============================================================

/** Current connection profile name, or '' if unavailable. */
export async function getCurrentProfile() {
    const context = getContext();
    if (typeof context.executeSlashCommandsWithOptions !== 'function') return '';
    try {
        const r = await context.executeSlashCommandsWithOptions('/profile');
        return r?.pipe?.trim() || '';
    } catch {
        return '';
    }
}

// ============================================================
// Isolated LLM generation (for description gen)
// ============================================================

/**
 * Run a one-shot prompt through the LLM and return the raw text.
 *
 * Mirrors SimpleSummarizer's callLLM pattern so all our extensions behave
 * identically and a future change can be applied the same way everywhere:
 *   1. Preferred — ConnectionManagerRequestService.sendRequest(profileId, msgs).
 *      Fully isolated: no profile switch, no GENERATION_STARTED side effects,
 *      and it targets the chosen connection profile directly. Ideal here since
 *      we generate for arbitrary stored chats, not the active one.
 *   2. Fallback — generateQuietPrompt (context.generateQuietPrompt), used when
 *      CMRS is unavailable or the profile can't be resolved. Runs against
 *      whatever connection is currently active.
 *
 * @param {string} prompt
 * @param {{profileName?: string, responseLength?: number}} [opts]
 * @returns {Promise<string>} trimmed response text ('' on total failure)
 */
export async function generateText(prompt, opts = {}) {
    const context = getContext();
    const profileName = opts.profileName || '';
    const responseLength = opts.responseLength || 2048;

    // ── Preferred: CMRS, when a profile is selected and resolvable ──
    if (profileName) {
        const CMRS = context?.ConnectionManagerRequestService;
        if (CMRS && typeof CMRS.sendRequest === 'function') {
            const profiles = context?.extensionSettings?.connectionManager?.profiles;
            const resolved = Array.isArray(profiles)
                ? profiles.find(p => p.id === profileName
                    || p.name?.toLowerCase() === profileName.toLowerCase())
                : null;
            if (resolved) {
                for (let attempt = 0; attempt < 2; attempt++) {
                    try {
                        const res = await CMRS.sendRequest(resolved.id, [
                            { role: 'user', content: prompt },
                        ]);
                        const text = res?.content
                            || res?.choices?.[0]?.message?.content
                            || res?.text || res?.output || '';
                        if (text) return String(text).trim();
                    } catch (err) {
                        logWarn(`CMRS attempt ${attempt + 1} failed:`, err?.message);
                        if (attempt === 0) await new Promise(r => setTimeout(r, 1500));
                    }
                }
                logWarn('CMRS exhausted, falling back to quiet prompt');
            }
        }
    }

    // ── Fallback: generateQuietPrompt against the active connection ──
    if (typeof context.generateQuietPrompt === 'function') {
        try {
            const res = await context.generateQuietPrompt({
                quietPrompt: prompt,
                quietName: 'StoryManager',
                skipWIAN: true,
                responseLength,
            });
            if (res) return String(res).trim();
        } catch (e) {
            logError('generateQuietPrompt failed:', e);
        }
    }

    return '';
}

// ============================================================
// ST Tag system (character card tags)
// ============================================================

/**
 * Get all user-created ST tags (excludes actionable/system tags like FAV, GROUP, FOLDER).
 * Returns the live array — treat as read-only.
 * @returns {Array<{id: string, name: string, color?: string, color2?: string}>}
 */
export function getSTTags() {
    // Actionable/system tag IDs in ST: '0','1','2','3','4','5'
    const systemIds = new Set(['0', '1', '2', '3', '4', '5']);
    return (stTagList || []).filter(t => t && t.id && t.name && !systemIds.has(t.id));
}

/**
 * Get the ST tag IDs assigned to a specific character avatar.
 * @param {string} avatar - The character's .png filename
 * @returns {string[]} Array of tag IDs
 */
export function getSTTagsForCharacter(avatar) {
    if (!avatar || !stTagMap) return [];
    return stTagMap[avatar] || [];
}
