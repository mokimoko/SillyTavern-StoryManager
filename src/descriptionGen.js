/**
 * descriptionGen.js — LLM-generated descriptions
 *
 * Three generators, all OPTIONAL (manual entry is always available):
 *
 *   generateStorylineDescription(storyline)
 *     Context priority:
 *       1. Comprehensive summaries (via Summarizer) for the storyline's chats.
 *       2. Fallback — first/last few messages of each chat (raw .jsonl read).
 *     If neither yields anything (e.g. empty chats, no Summarizer), gen is
 *     unavailable and we say so rather than inventing a description.
 *
 *   generateBookDescription(book, memberStorylines)
 *     Digests the descriptions of the book's member storylines. Available only
 *     if at least one member storyline has a non-empty description.
 *
 *   generateChatBlurb(storyline, chatEntry)
 *     A one-line blurb for a single chat (summary-first, message-fallback).
 *
 * All return { ok: boolean, text?: string, reason?: string }.
 */
import {
    getSummaryForChat,
    getChatMessages,
    generateText,
    hasSummarizer,
} from './stContext.js';
import { getSetting } from './settings.js';

// ============================================================
// Length presets
// ============================================================

const LENGTH_GUIDE = {
    short:  { words: '1-2 sentences (~30 words)',  cap: 256 },
    medium: { words: 'a short paragraph (~60-80 words)', cap: 512 },
    long:   { words: 'two rich paragraphs (~150 words)', cap: 1024 },
};

function lengthGuide() {
    return LENGTH_GUIDE[getSetting('genLength')] || LENGTH_GUIDE.medium;
}

// How many head/tail messages to sample per chat in fallback mode.
const SAMPLE_HEAD = 2;
const SAMPLE_TAIL = 2;
// Trim any single message to avoid blowing the prompt up on long posts.
const MSG_CHAR_CAP = 600;

// ============================================================
// Context gathering
// ============================================================

/**
 * Build context text for one chat. Tries the comprehensive summary first;
 * falls back to a head/tail message sample. Returns '' if nothing usable.
 * @returns {Promise<{text: string, source: 'summary'|'messages'|'none'}>}
 */
async function gatherChatContext(chatEntry) {
    const fileName = chatEntry?.file_name;
    if (!fileName) return { text: '', source: 'none' };

    // 1. Comprehensive summary.
    const summary = await getSummaryForChat(fileName);
    const summaryText = summary?.text?.trim();
    if (summaryText) return { text: summaryText, source: 'summary' };

    // 2. Fallback: sample raw messages.
    const messages = await getChatMessages(chatEntry.avatar, fileName);
    if (!messages.length) return { text: '', source: 'none' };

    const head = messages.slice(0, SAMPLE_HEAD);
    const tail = messages.length > SAMPLE_HEAD + SAMPLE_TAIL
        ? messages.slice(-SAMPLE_TAIL)
        : [];
    const picked = [...head, ...tail];

    const lines = picked.map(m => {
        const who = m.is_user ? 'User' : (m.name || 'Char');
        let body = String(m.mes || '').replace(/\s+/g, ' ').trim();
        if (body.length > MSG_CHAR_CAP) body = body.slice(0, MSG_CHAR_CAP) + '…';
        return `${who}: ${body}`;
    });
    return { text: lines.join('\n'), source: 'messages' };
}

/**
 * Gather context for every chat in a storyline, in chronological order.
 * @returns {Promise<{blocks: string[], usedSummaries: boolean, usedMessages: boolean}>}
 */
async function gatherStorylineContext(storyline) {
    const chats = [...(storyline.chats || [])]
        .sort((a, b) => (a.chronoOrder || 0) - (b.chronoOrder || 0));

    const blocks = [];
    let usedSummaries = false;
    let usedMessages = false;

    for (const chat of chats) {
        const { text, source } = await gatherChatContext(chat);
        if (!text) continue;
        if (source === 'summary') usedSummaries = true;
        if (source === 'messages') usedMessages = true;
        const label = chat.chronoLabel ? ` (${chat.chronoLabel})` : '';
        blocks.push(`### Chat${label}\n${text}`);
    }
    return { blocks, usedSummaries, usedMessages };
}

// ============================================================
// Prompt builders
// ============================================================

function storylineMeta(storyline) {
    const bits = [];
    if (storyline.title) bits.push(`Title: ${storyline.title}`);
    if (storyline.character?.displayName || storyline.character?.name) {
        bits.push(`Main character: ${storyline.character.displayName || storyline.character.name}`);
    }
    const personas = (storyline.mainPersonas || [])
        .map(p => p?.name || p).filter(Boolean);
    if (personas.length) bits.push(`Player persona(s): ${personas.join(', ')}`);
    const npcs = (storyline.tags?.npc || [])
        .map(n => n?.name || n).filter(Boolean);
    if (npcs.length) bits.push(`Notable NPCs: ${npcs.join(', ')}`);
    return bits.join('\n');
}

function buildStorylinePrompt(storyline, blocks, fromSummaries) {
    const guide = lengthGuide();
    const meta = storylineMeta(storyline);
    const sourceNote = fromSummaries
        ? 'The context below is drawn from comprehensive chat summaries.'
        : 'The context below is a sparse sample (opening and closing messages of each chat), so infer the overall arc rather than recounting individual lines.';

    return [
        'You are writing a concise, evocative catalogue description for an archived roleplay storyline.',
        'Write it as a back-of-the-book blurb: third person, present tense, no spoilery beat-by-beat recap, no meta commentary about chats or summaries.',
        `Length: ${guide.words}.`,
        'Output ONLY the description text — no title, no quotes, no preamble.',
        '',
        meta ? `Storyline details:\n${meta}\n` : '',
        sourceNote,
        '',
        '--- CONTEXT ---',
        blocks.join('\n\n'),
        '--- END CONTEXT ---',
    ].filter(Boolean).join('\n');
}

function buildBookPrompt(book, descriptions) {
    const guide = lengthGuide();
    const titleLine = book.title ? `Book title: ${book.title}` : '';
    return [
        'You are writing a concise, evocative catalogue description for a "book" that collects several related roleplay storylines.',
        'Synthesize the storyline descriptions below into a single overview of the collection as a whole — its throughline, tone, and scope. Do not just list the storylines.',
        'Third person, present tense. Output ONLY the description text — no title, no quotes, no preamble.',
        `Length: ${guide.words}.`,
        '',
        titleLine,
        '',
        '--- STORYLINE DESCRIPTIONS ---',
        descriptions.map((d, i) => `${i + 1}. ${d}`).join('\n\n'),
        '--- END ---',
    ].filter(Boolean).join('\n');
}

// ============================================================
// Availability  (for enabling/disabling UI gen buttons)
// ============================================================

/**
 * Can we generate a description for this storyline? Cheapest-first:
 *   - If Summarizer is present and ANY chat has a summary → yes (summary path).
 *   - Else if ANY chat has at least one readable message → yes (fallback path).
 *   - Else no.
 * @returns {Promise<{available: boolean, source: 'summary'|'messages'|'none'}>}
 */
export async function canGenerateStoryline(storyline) {
    const chats = storyline?.chats || [];
    if (!chats.length) return { available: false, source: 'none' };

    if (hasSummarizer()) {
        for (const chat of chats) {
            const s = await getSummaryForChat(chat.file_name);
            if (s?.text?.trim()) return { available: true, source: 'summary' };
        }
    }
    // Fallback feasibility: any chat with messages.
    for (const chat of chats) {
        const msgs = await getChatMessages(chat.avatar, chat.file_name);
        if (msgs.length) return { available: true, source: 'messages' };
    }
    return { available: false, source: 'none' };
}

/**
 * Can we generate a description for this book?
 * Only if at least one member storyline has a non-empty description.
 */
export function canGenerateBook(memberStorylines = []) {
    const hasAny = memberStorylines.some(s => s?.description?.trim());
    return { available: hasAny };
}

// ============================================================
// Generators
// ============================================================

/**
 * Generate a storyline description.
 * @returns {Promise<{ok: boolean, text?: string, source?: string, reason?: string}>}
 */
export async function generateStorylineDescription(storyline) {
    if (!storyline) return { ok: false, reason: 'No storyline provided.' };

    const { blocks, usedSummaries, usedMessages } = await gatherStorylineContext(storyline);
    if (!blocks.length) {
        return {
            ok: false,
            reason: hasSummarizer()
                ? 'No summaries or readable messages found for this storyline\u2019s chats.'
                : 'No comprehensive summaries available, and no readable chat messages to fall back on.',
        };
    }

    const prompt = buildStorylinePrompt(storyline, blocks, usedSummaries);
    const text = await generateText(prompt, {
        profileName: getSetting('connectionProfile'),
        responseLength: lengthGuide().cap,
    });
    if (!text) return { ok: false, reason: 'The model returned an empty response.' };

    const source = usedSummaries ? (usedMessages ? 'mixed' : 'summary') : 'messages';
    return { ok: true, text, source };
}

/**
 * Generate a book description from member storyline descriptions.
 * @param {object} book
 * @param {Array} memberStorylines - the storyline objects this book contains
 */
export async function generateBookDescription(book, memberStorylines = []) {
    if (!book) return { ok: false, reason: 'No book provided.' };

    const descriptions = memberStorylines
        .map(s => s?.description?.trim())
        .filter(Boolean);
    if (!descriptions.length) {
        return {
            ok: false,
            reason: 'This book has no storylines with descriptions yet. Describe at least one storyline first.',
        };
    }

    const prompt = buildBookPrompt(book, descriptions);
    const text = await generateText(prompt, {
        profileName: getSetting('connectionProfile'),
        responseLength: lengthGuide().cap,
    });
    if (!text) return { ok: false, reason: 'The model returned an empty response.' };
    return { ok: true, text };
}

/**
 * Generate a one-line blurb for a single chat entry within a storyline.
 * Summary-first, message-fallback. Used by the chronology editor.
 */
export async function generateChatBlurb(storyline, chatEntry) {
    if (!chatEntry?.file_name) return { ok: false, reason: 'No chat selected.' };

    const { text: ctx, source } = await gatherChatContext(chatEntry);
    if (!ctx) return { ok: false, reason: 'No summary or readable messages for this chat.' };

    const charName = storyline?.character?.displayName
        || storyline?.character?.name || 'the character';
    const sourceNote = source === 'summary'
        ? 'Context is a comprehensive summary.'
        : 'Context is a sparse message sample; infer the gist.';

    const prompt = [
        `Write a single vivid one-line blurb (max ~18 words) capturing what happens in this roleplay chat with ${charName}.`,
        'No quotes, no preamble, no trailing period necessary. Output only the line.',
        sourceNote,
        '',
        '--- CONTEXT ---',
        ctx,
        '--- END ---',
    ].join('\n');

    const text = await generateText(prompt, {
        profileName: getSetting('connectionProfile'),
        responseLength: 128,
    });
    if (!text) return { ok: false, reason: 'The model returned an empty response.' };
    // Keep it to one line.
    return { ok: true, text: text.split('\n')[0].trim() };
}

/** Legacy alias kept for callers that checked Summarizer presence directly. */
export function isDescriptionGenAvailable() {
    return hasSummarizer();
}
