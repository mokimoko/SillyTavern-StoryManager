/** Pure chat-message filtering and formatting for ebook imports. */

export function isImportableMessage(message, includeSystemMessages = false) {
    return !!message
        && typeof message.mes === 'string'
        && (includeSystemMessages || !message.is_system);
}

export function filterImportableMessages(messages = [], includeSystemMessages = false) {
    return messages.filter(message => isImportableMessage(message, includeSystemMessages));
}

export function formatImportedMessages(messages = [], options = {}) {
    const includeNames = options.includeNames !== false;
    const includeSystemMessages = options.includeSystemMessages === true;
    return filterImportableMessages(messages, includeSystemMessages)
        .map(message => {
            const body = String(message.mes || '');
            return includeNames && message.name ? `${message.name}: ${body}` : body;
        })
        .join('\n\n')
        .trim();
}
