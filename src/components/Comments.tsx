import { Dialog } from "./Dialogs";
import { useEffect, useState } from "react";
import { useI18n } from "../i18n";
import type { StickyNote } from "../services/pdf/stickyNotes";
import type { ViewerController, ViewerState } from "../services/pdf/viewerController";
import { Icon } from "./Icon";

export function NoteMarkers(props: { controller: ViewerController; state: ViewerState; onEdit(note: StickyNote): void }) {
  const { t } = useI18n();
  useEffect(() => {
    // PDF.js owns page DOM and can replace it during zoom/render. Imperative
    // marker hosts keep React from trying to remove PDF.js-detached nodes.
    const markers: HTMLButtonElement[] = [];
    for (const note of props.state.notes) {
      const position = props.controller.notePosition(note.page, note.rect);
      if (!position) continue;
      const button = document.createElement("button");
      button.type = "button"; button.className = "openpdf-note";
      button.textContent = "▤"; button.title = note.text;
      button.setAttribute("aria-label", `${t("stickyNote")}: ${note.text}`);
      button.style.left = `${Math.max(0, Math.min(position.x, position.element.clientWidth - 26))}px`;
      button.style.top = `${Math.max(0, Math.min(position.y, position.element.clientHeight - 26))}px`;
      button.addEventListener("click", (event) => { event.stopPropagation(); props.onEdit(note); });
      position.element.append(button); markers.push(button);
    }
    return () => markers.forEach((marker) => marker.remove());
  }, [props.controller, props.state, props.onEdit, t]);
  return null;
}

export function CommentsPanel(props: { controller: ViewerController; notes: readonly StickyNote[]; onEdit(note: StickyNote): void; onClose(): void }) {
  const { t } = useI18n();
  return <aside className="comments-panel" aria-label={t("comments")}>
    <div className="comments-heading"><h2>{t("comments")}</h2><button type="button" className="icon-button" aria-label={t("close")} onClick={props.onClose}><Icon name="close" /></button></div>
    {!props.notes.length && <p>{t("noComments")}</p>}
    {props.notes.map((note) => <button type="button" className="comment-card" key={note.id} onClick={() => { props.controller.goToPage(note.page); props.onEdit(note); }}>
      <strong>{t("page")} {note.page}</strong><span dir="auto">{note.text}</span>
    </button>)}
  </aside>;
}

export function NoteEditor(props: { note: StickyNote; onSave(note: StickyNote): void; onDelete(): void; onCancel(): void }) {
  const { t } = useI18n();
  const [text, setText] = useState(props.note.text);
  return <Dialog title={`${t("stickyNote")} - ${t("page")} ${props.note.page}`} onClose={props.onCancel} actions={<>

        <button type="button" className="text-button" onClick={props.onDelete}>{t("deleteSelected")}</button>
        <button type="button" className="text-button" onClick={props.onCancel}>{t("cancel")}</button>
        <button type="button" className="primary-button" disabled={!text.trim()} onClick={() => props.onSave({ ...props.note, text })}>{t("saveComment")}</button>
      </>}>
      <textarea className="dialog-input" rows={7} autoFocus dir="auto" aria-label={t("commentText")} value={text} onChange={(event) => setText(event.target.value)} />
    </Dialog>;
}
