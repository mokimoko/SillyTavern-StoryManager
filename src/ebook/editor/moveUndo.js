/** Pure state checks for the editor's single-step chapter assignment undo. */

export function createMoveUndoSnapshot({ rawBefore, rawAfter, chapterId, chapterBefore, chapterAfter }) {
    return {
        rawBefore: String(rawBefore ?? ''),
        rawAfter: String(rawAfter ?? ''),
        chapterId: String(chapterId ?? ''),
        chapterBefore: String(chapterBefore ?? ''),
        chapterAfter: String(chapterAfter ?? ''),
    };
}

export function canRestoreMove(snapshot, rawText, chapter) {
    return !!snapshot
        && !!chapter
        && String(chapter.id) === snapshot.chapterId
        && String(rawText ?? '') === snapshot.rawAfter
        && String(chapter.content ?? '') === snapshot.chapterAfter;
}
