import { parsePageRange } from "../services/pdf/pageRange";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useI18n, type Language, type Translate } from "../i18n";
import { readDocumentInfo, type DocumentInfo } from "../services/pdf/documentInfo";
import type { ViewerController } from "../services/pdf/viewerController";

export function Dialog(props: { title: string; onClose(): void; children: ReactNode; actions: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) {
      dialog.showModal();
      // React's autoFocus runs before showModal. Focus again after opening so
      // a discard confirmation defaults to its safe primary (Cancel) action.
      dialog.querySelector<HTMLElement>("input:not([disabled]), button.primary-button:not([disabled])")?.focus();
    }
  }, []);
  return (
    <dialog
      ref={ref}
      className="dialog"
      onCancel={(event) => {
        event.preventDefault();
        props.onClose();
      }}
    >
      <h2>{props.title}</h2>
      <div className="dialog-body">{props.children}</div>
      <div className="dialog-actions">{props.actions}</div>
    </dialog>
  );
}

export function MessageDialog(props: { title: string; message: string; onClose(): void }) {
  const { t } = useI18n();
  return (
    <Dialog
      title={props.title}
      onClose={props.onClose}
      actions={
        <button type="button" className="primary-button" autoFocus onClick={props.onClose}>
          {t("ok")}
        </button>
      }
    >
      <p>{props.message}</p>
    </Dialog>
  );
}

export function ConfirmDialog(props: {
  title: string;
  message: string;
  confirmLabel: string;
  onConfirm(): void;
  onCancel(): void;
}) {
  const { t } = useI18n();
  return (
    <Dialog
      title={props.title}
      onClose={props.onCancel}
      actions={
        <>
          <button type="button" className="text-button" onClick={props.onConfirm}>
            {props.confirmLabel}
          </button>
          <button type="button" className="primary-button" autoFocus onClick={props.onCancel}>
            {t("cancel")}
          </button>
        </>
      }
    >
      <p>{props.message}</p>
    </Dialog>
  );
}

export function PasswordDialog(props: { wrong: boolean; onSubmit(password: string | null): void }) {
  const { t } = useI18n();
  const [password, setPassword] = useState("");
  return (
    <Dialog
      title={t("passwordTitle")}
      onClose={() => props.onSubmit(null)}
      actions={
        <>
          <button type="button" className="text-button" onClick={() => props.onSubmit(null)}>
            {t("cancel")}
          </button>
          <button type="submit" form="password-form" className="primary-button" disabled={!password}>
            {t("ok")}
          </button>
        </>
      }
    >
      <form
        id="password-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (password) props.onSubmit(password);
        }}
      >
        <p>{props.wrong ? t("passwordWrong") : t("passwordPrompt")}</p>
        <input
          className="dialog-input"
          type="password"
          dir="ltr"
          autoFocus
          autoComplete="off"
          aria-label={t("password")}
          placeholder={t("password")}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
      </form>
    </Dialog>
  );
}

export function ProgressDialog(props: { message: string; onCancel(): void }) {
  const { t } = useI18n();
  return (
    <Dialog
      title={t("print")}
      onClose={props.onCancel}
      actions={
        <button type="button" className="text-button" onClick={props.onCancel}>
          {t("cancel")}
        </button>
      }
    >
      <p aria-live="polite">{props.message}</p>
    </Dialog>
  );
}

function formatBytes(bytes: number, language: Language) {
  const format = (value: number, unit: string) =>
    `${value.toLocaleString(language, { maximumFractionDigits: value < 10 ? 2 : 1 })} ${unit}`;
  if (bytes < 1024) return format(bytes, "B");
  if (bytes < 1024 ** 2) return format(bytes / 1024, "KB");
  if (bytes < 1024 ** 3) return format(bytes / 1024 ** 2, "MB");
  return format(bytes / 1024 ** 3, "GB");
}

const PAPER_SIZES: [string, number, number][] = [
  ["A3", 297, 420],
  ["A4", 210, 297],
  ["A5", 148, 210],
  ["Letter", 215.9, 279.4],
  ["Legal", 215.9, 355.6],
];

function formatPageSize(size: { width: number; height: number }, t: Translate) {
  const mm = (points: number) => (points / 72) * 25.4;
  const width = mm(size.width);
  const height = mm(size.height);
  const short = Math.min(width, height);
  const long = Math.max(width, height);
  const paper = PAPER_SIZES.find(([, w, h]) => Math.abs(w - short) < 2 && Math.abs(h - long) < 2);
  const orientation = t(height >= width ? "portrait" : "landscape");
  const dimensions = `${width.toFixed(0)} × ${height.toFixed(0)} mm`;
  return `${dimensions} (${paper ? `${paper[0]}, ` : ""}${orientation})`;
}

export function PropertiesDialog(props: {
  controller: ViewerController;
  fileName: string;
  filePath?: string;
  onClose(): void;
}) {
  const { t, language } = useI18n();
  const [info, setInfo] = useState<DocumentInfo | null>(null);

  useEffect(() => {
    const doc = props.controller.document;
    if (!doc) return;
    let stale = false;
    void readDocumentInfo(doc).then((value) => !stale && setInfo(value));
    return () => {
      stale = true;
    };
  }, [props.controller]);

  const date = (value?: Date) =>
    value?.toLocaleString(language, { dateStyle: "medium", timeStyle: "short" });
  const folder = props.filePath?.replace(/[\\/][^\\/]*$/, "");
  const rows: [string, string | undefined][] = [
    [t("propFileName"), props.fileName],
    [t("propFileSize"), info?.fileSize !== undefined ? formatBytes(info.fileSize, language) : undefined],
    [t("propLocation"), folder],
    [t("propTitle"), info?.title],
    [t("propAuthor"), info?.author],
    [t("propSubject"), info?.subject],
    [t("propKeywords"), info?.keywords],
    [t("propCreated"), date(info?.created)],
    [t("propModified"), date(info?.modified)],
    [t("propCreator"), info?.creator],
    [t("propProducer"), info?.producer],
    [t("propVersion"), info?.pdfVersion],
    [t("propPageCount"), info ? String(info.pageCount) : undefined],
    [t("propPageSize"), info?.pageSize ? formatPageSize(info.pageSize, t) : undefined],
  ];

  return (
    <Dialog
      title={t("documentProperties")}
      onClose={props.onClose}
      actions={
        <button type="button" className="primary-button" autoFocus onClick={props.onClose}>
          {t("close")}
        </button>
      }
    >
      <dl className="properties">
        {rows.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd dir="auto">{value || "–"}</dd>
          </div>
        ))}
      </dl>
    </Dialog>
  );
}

export function PrintSetupDialog(props: { count: number; current: number; onCancel(): void; onSubmit(pages: number[], dpi: 150 | 300): void }) {
  const { t } = useI18n();
  const [mode, setMode] = useState("all");
  const [range, setRange] = useState(String(props.current));
  const [dpi, setDpi] = useState<150 | 300>(150);
  let pages: number[] = [];
  try { pages = parsePageRange(mode === "all" ? `1-${props.count}` : mode === "current" ? String(props.current) : range, props.count); } catch { /* Keep invalid input editable. */ }
  return <Dialog title={t("printSetup")} onClose={props.onCancel} actions={<>
    <button type="button" className="text-button" onClick={props.onCancel}>{t("cancel")}</button>
    <button type="button" className="primary-button" disabled={!pages.length} onClick={() => props.onSubmit(pages, dpi)}>{t("preparePrint")}</button>
  </>}>
    <p>{t("printSetupHint")}</p>
    <label className="print-option">{t("printPages")} <select aria-label={t("printPages")} value={mode} onChange={(event) => setMode(event.target.value)}>
      <option value="current">{t("currentPage")}</option><option value="all">{t("allPages")}</option><option value="range">{t("pageRange")}</option>
    </select></label>
    {mode === "range" && <><input className="dialog-input" dir="ltr" aria-label={t("pageRange")} aria-invalid={!pages.length} value={range} onChange={(event) => setRange(event.target.value)} placeholder="1-3, 5, 8-10" />
      {!pages.length && <p role="alert">{t("invalidRange", { count: props.count })}</p>}</>}
    <label className="print-option">{t("printResolution")} <select dir="ltr" aria-label={t("printResolution")} value={dpi} onChange={(event) => setDpi(Number(event.target.value) as 150 | 300)}><option value={150}>150 DPI</option><option value={300}>300 DPI</option></select></label>
    <p>{t("printRasterHint")}</p>
  </Dialog>;
}
