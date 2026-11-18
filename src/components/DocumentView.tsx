import { CommentsPanel, NoteEditor, NoteMarkers } from "./Comments";
import type { StickyNote } from "../services/pdf/stickyNotes";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { ConfirmDialog, PrintSetupDialog, MessageDialog, PasswordDialog, ProgressDialog, PropertiesDialog } from "./Dialogs";
import { EditorBar } from "./EditorBar";
import { FindBar } from "./FindBar";
import { Icon } from "./Icon";
import { Sidebar } from "./Sidebar";
import { Toolbar } from "./Toolbar";
import { I18nContext, translator, type Language, type ThemePreference } from "../i18n";
import {
  baseName,
  isDesktop,
  openExternal,
  savePdf,
  setFullscreen,
  setWindowTitle,
  type OpenedFile,
} from "../services/files/platform";
import { initialPointerMode, installHandPan, storePointerMode } from "../services/pdf/pointer";
import { printDocument, PrintBudgetError } from "../services/pdf/print";
import type { FileOperations } from "../services/files/operations";
import { OpenCancelled, PasswordCancelled, ViewerController } from "../services/pdf/viewerController";
import type { DocumentHandle, DocumentStatus } from "../services/tabs";

interface DocumentViewProps {
  id: number;
  active: boolean;
  language: Language;
  operations: FileOperations;
  onOpen(): void;
  onToggleLanguage(): void;
  theme: ThemePreference;
  onThemeChange(theme: ThemePreference): void;
  onReady(id: number, handle: DocumentHandle): void;
  onStatus(id: number, status: DocumentStatus): void;
}

interface CurrentFile {
  name: string;
  path?: string;
}

type Modal =
  | { kind: "message"; title: string; message: string }
  | { kind: "password"; id: number; wrong: boolean; resolve(password: string | null): void }
  | { kind: "confirm"; resolve(discard: boolean): void }
  | { kind: "printSetup" }
  | { kind: "print"; done: number; total: number; abort: AbortController }
  | { kind: "note"; note: StickyNote }
  | { kind: "properties" };

const isEditable = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));

export function DocumentView(props: DocumentViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<HTMLDivElement>(null);
  const [controller, setController] = useState<ViewerController | null>(null);
  const language = props.language;
  const [file, setFile] = useState<CurrentFile | null>(null);
  const [loading, setLoading] = useState(false);
  const [modal, setModal] = useState<Modal | null>(null);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [noteTool, setNoteTool] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [pointerMode, setPointerMode] = useState(initialPointerMode);
  const [findOpen, setFindOpen] = useState(false);
  const [findFocus, setFindFocus] = useState(0);
  const [annotationsVisible, setAnnotationsVisible] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const fileOperations = useRef(props.operations);
  const ownedController = useRef<ViewerController | null>(null);
  const mountVersion = useRef(0);

  const i18n = useMemo(() => ({ t: translator(language), language }), [language]);
  const { t } = i18n;

  // Each mounted tab owns its viewer. Defer unmount cleanup past StrictMode's
  // effect replay, so development mode does not destroy a live document.
  useEffect(() => {
    if (!containerRef.current || !viewerRef.current) return;
    const ctrl = ownedController.current ??= new ViewerController(containerRef.current, viewerRef.current);
    const version = ++mountVersion.current;
    setController(ctrl);
    return () => queueMicrotask(() => {
      if (mountVersion.current === version) void ctrl.destroy();
    });
  }, []);

  useEffect(() => {
    if (!props.active) return;
    // Handle for manual testing from the dev tools; never present in release builds.
    if (import.meta.env.DEV) (window as unknown as { __openpdf?: unknown }).__openpdf = controller;
  }, [controller, props.active]);

  const subscribe = useCallback((listener: () => void) => controller?.subscribe(listener) ?? (() => undefined), [controller]);
  const state = useSyncExternalStore(subscribe, () => controller?.getState() ?? null);
  const findState = useSyncExternalStore(subscribe, () => controller?.getFindState() ?? null);

  useEffect(() => {
    if (!props.active) return;
    void setWindowTitle(file ? `${file.name} – OpenPDF` : "OpenPDF").catch(() => undefined);
  }, [file, props.active]);

  useEffect(() => {
    props.onStatus(props.id, {
      name: file?.name ?? null,
      modified: !!state?.modified,
      presenting: !!state?.presenting,
      modal: !!modal,
    });
  }, [props.id, props.onStatus, file?.name, state?.modified, state?.presenting, modal]);

  useEffect(() => {
    controller?.setActive(props.active);
    if (props.active && document.activeElement?.closest(".document-tab-panel[hidden]")) controller?.focus();
  }, [controller, props.active]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(timer);
  }, [toast]);

  // Callbacks registered once (native listeners) read the latest values through this ref.
  const latest = useRef({ controller, state, t, modal, active: props.active });
  latest.current = { controller, state, t, modal, active: props.active };

  const confirmDiscard = useCallback(async () => {
    if (!latest.current.controller?.hasUnsavedChanges()) return true;
    return new Promise<boolean>((resolve) =>
      setModal({
        kind: "confirm",
        resolve(discard) {
          setModal(null);
          resolve(discard);
        },
      }),
    );
  }, []);

  const showError = useCallback((title: string, message: string) => setModal({ kind: "message", title, message }), []);

  const openFile = useCallback(
    async (opened: OpenedFile) => {
      const ctrl = latest.current.controller;
      const translate = latest.current.t;
      if (!ctrl || latest.current.modal) return;
      setLoading(true);
      setLoadError(null);
      try {
        setFindOpen(false);
        await ctrl.open(opened.data, (wrong) =>
          new Promise((resolve) =>
            setModal({
              kind: "password",
              id: Date.now(),
              wrong,
              resolve(password) {
                setModal(null);
                resolve(password);
              },
            }),
          ),
        );
        // Publish file metadata only after PDF.js has successfully loaded the document.
        setFile({ name: opened.name, path: opened.path });
        if (latest.current.active) ctrl.focus();
      } catch (error) {
        // ViewerController closes the previous document before starting a new load.
        // Do not leave its old filename (or the failed new filename) attached to an empty tab.
        setFile(null);
        if (error instanceof OpenCancelled || error instanceof PasswordCancelled || (error as Error)?.message?.includes("Password prompt cancelled")) return;
        console.error(error);
        setLoadError(translate("errorInvalid"));
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  const openPicker = props.onOpen;

  useEffect(() => {
    if (!controller) return;
    props.onReady(props.id, {
      load: openFile,
      hasDocument: () => !!controller.document,
      hasUnsavedChanges: () => controller.hasUnsavedChanges(),
      confirmClose: confirmDiscard,
      async exitPresentation() {
        if (!controller.getState().presenting) return;
        await setFullscreen(false);
        controller.setPresenting(false);
      },
      destroy: () => controller.destroy(),
    });
  }, [controller, props.id, props.onReady, openFile, confirmDiscard]);

  const save = useCallback(() => fileOperations.current.run(async () => {
    if (!controller?.document || !file || latest.current.modal) return;
    try {
      const snapshot = await controller.prepareSave();
      const saved = await savePdf(file.path ?? file.name, snapshot.data);
      if (!saved) return;
      controller.markSaved(snapshot);
      setToast(t("saved", { name: baseName(saved) }));
    } catch (error) {
      console.error(error);
      showError(t("download"), t(controller.hasNoteChanges() ? "errorNoteSave" : "errorSave"));
    }
  }), [controller, file, showError, t]);

  const preparePrint = useCallback((pages: number[], dpi: 150 | 300) => fileOperations.current.run(async () => {
    let doc = controller?.document;
    if (!controller || !doc || latest.current.modal?.kind !== "printSetup") return;
    controller.commitEdits();
    const abort = new AbortController();
    setModal({ kind: "print", done: 0, total: pages.length, abort });
    let printCopy: import("pdfjs-dist").PDFDocumentLoadingTask | null = null;
    try {
      if (controller.getState().notes.some((note) => !note.original) || controller.hasNoteChanges()) {
        const { getDocument } = await import("pdfjs-dist");
        // Includes unsaved notes and all existing PDF.js edits. Do not replace the live document.
        printCopy = getDocument({ data: await controller.getBytes() });
        doc = await printCopy.promise;
      }
      // Let the progress dialog close before the system print dialog blocks the page.
      const ready = await printDocument(doc, {
        signal: abort.signal, pages, dpi,
        onProgress: (done) => setModal((current) => (current?.kind === "print" ? { ...current, done } : current)),
      });
      setModal((current) => (current?.kind === "print" ? null : current));
      if (ready) {
        await new Promise((resolve) => setTimeout(resolve, 50));
        ready();
      }
    } catch (error) {
      console.error(error);
      showError(t("print"), t(error instanceof PrintBudgetError ? "printBudget" : "errorPrint"));
    } finally {
      await printCopy?.destroy();
    }
  }), [controller, showError, t]);

  const print = useCallback(() => {
    if (controller?.document && !latest.current.modal) setModal({ kind: "printSetup" });
  }, [controller]);

  const setPresenting = useCallback(
    (enabled: boolean) => {
      if (!controller?.document && enabled) return;
      controller?.setPresenting(enabled);
      void setFullscreen(enabled).catch(() => undefined);
      if (enabled) controller?.focus();
    },
    [controller],
  );

  const openFind = useCallback(() => {
    if (!latest.current.state?.hasDocument) return;
    setFindOpen(true);
    setFindFocus((token) => token + 1);
  }, []);

  // Leaving fullscreen by other means (e.g. the browser's own Esc handling) ends the presentation.
  useEffect(() => {
    const onChange = () => !document.fullscreenElement && !isDesktop && controller?.setPresenting(false);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, [controller]);

  // Keyboard shortcuts.
  useEffect(() => {
    if (!controller) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const current = latest.current;
      const viewer = current.state;
      if (!current.active || !viewer || current.modal || event.defaultPrevented) return;
      const ctrl = event.ctrlKey || event.metaKey;
      const key = event.key;
      const run = (action: () => void) => {
        event.preventDefault();
        action();
      };

      if (ctrl && !event.altKey) {
        switch (key.toLowerCase()) {
          case "o":
            return run(openPicker);
          case "s":
            return run(() => void save());
          case "p":
            return run(() => void print());
          case "f":
            return run(openFind);
          case "=":
          case "+":
            return run(() => controller.zoomIn());
          case "-":
            return run(() => controller.zoomOut());
          case "0":
            return run(() => controller.setFit("auto"));
          case "]":
            return run(() => controller.rotate(90));
          case "[":
            return run(() => controller.rotate(-90));
          // Keep the webview from reloading or opening its own tools over the document.
          case "r":
          case "g":
          case "j":
          case "u":
            return event.preventDefault();
        }
        return;
      }

      if (key === "F3") return run(openFind);
      if (key === "F5") return run(() => setPresenting(!viewer.presenting));
      if (key === "F11" && viewer.presenting) return run(() => setPresenting(false));
      if (key === "Escape") {
        if (viewer.presenting) return run(() => setPresenting(false));
        if (isEditable(event.target)) return;
        if (viewer.tool !== "none" && !viewer.hasSelectedEditor) return run(() => controller.setTool("none"));
        return;
      }
      if (!viewer.hasDocument || isEditable(event.target) || viewer.tool !== "none" || event.altKey) return;
      switch (key) {
        case "ArrowLeft":
          return run(() => controller.previousPage());
        case "ArrowRight":
          return run(() => controller.nextPage());
        case "Home":
          return run(() => controller.goToPage(1));
        case "End":
          return run(() => controller.goToPage(viewer.pageCount));
        case "PageUp":
        case "ArrowUp":
          if (viewer.presenting) return run(() => controller.previousPage());
          return;
        case "PageDown":
        case "ArrowDown":
        case " ":
          if (viewer.presenting) return run(() => controller.nextPage());
          return;
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [controller, openFind, openPicker, print, save, setPresenting]);

  // Ctrl+wheel zoom around the pointer, external links, and the webview's default context menu.
  useEffect(() => {
    const container = containerRef.current;
    if (!controller || !container) return;
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      const origin: [number, number] = [event.clientX, event.clientY];
      if (event.deltaY < 0) controller.zoomIn(origin);
      else if (event.deltaY > 0) controller.zoomOut(origin);
    };
    const onClick = (event: MouseEvent) => {
      const link = (event.target as HTMLElement).closest?.("a[href]") as HTMLAnchorElement | null;
      const href = link?.getAttribute("href") ?? "";
      if (/^(https?:|mailto:)/i.test(href)) {
        event.preventDefault();
        void openExternal(href).catch(console.error);
      }
    };
    const onContextMenu = (event: MouseEvent) => {
      if (latest.current.active && isDesktop && !isEditable(event.target) && !window.getSelection()?.toString()) event.preventDefault();
    };
    const blockPageZoom = (event: WheelEvent) => latest.current.active && (event.ctrlKey || event.metaKey) && event.preventDefault();
    container.addEventListener("wheel", onWheel, { passive: false });
    container.addEventListener("click", onClick);
    window.addEventListener("wheel", blockPageZoom, { passive: false });
    window.addEventListener("contextmenu", onContextMenu);
    return () => {
      container.removeEventListener("wheel", onWheel);
      container.removeEventListener("click", onClick);
      window.removeEventListener("wheel", blockPageZoom);
      window.removeEventListener("contextmenu", onContextMenu);
    };
  }, [controller]);

  useEffect(() => {
    const container = containerRef.current;
    if (container) return installHandPan(container);
  }, []);

  const hasDocument = !!state?.hasDocument;
  const presenting = !!state?.presenting;

  return (
    <I18nContext.Provider value={i18n}>
      <main className={"app-shell" + (presenting ? " is-presenting" : "")}>
        {controller && state && !presenting && (
          <Toolbar
            controller={controller}
            state={state}
            fileName={file?.name ?? "OpenPDF"}
            sidebarOpen={sidebarOpen}
            pointerMode={pointerMode}
            noteTool={noteTool}
            commentsOpen={commentsOpen}
            onComments={() => setCommentsOpen((open) => !open)}
            onNoteTool={() => { controller.setTool("none"); setPointerMode("select"); setNoteTool((active) => !active); }}
            onPointerModeChange={(mode) => {
              setNoteTool(false);
              controller.setTool("none");
              setPointerMode(mode);
              storePointerMode(mode);
            }}
            annotationsVisible={annotationsVisible}
            onToggleSidebar={() => setSidebarOpen((open) => !open)}
            onOpen={openPicker}
            onSave={() => void save()}
            onPrint={() => void print()}
            onFind={openFind}
            onProperties={() => setModal({ kind: "properties" })}
            onPresent={() => setPresenting(true)}
            onToggleAnnotations={() => setAnnotationsVisible((visible) => !visible)}
            onToggleLanguage={props.onToggleLanguage}
            theme={props.theme}
            onThemeChange={props.onThemeChange}
          />
        )}
        {controller && state && !presenting && <EditorBar controller={controller} state={state} />}

        <div className="workspace">
          {controller && state && hasDocument && sidebarOpen && !presenting && (
            <Sidebar controller={controller} state={state} />
          )}
          {controller && state?.notesReady && commentsOpen && !presenting && <CommentsPanel controller={controller} notes={state.notes}
            onEdit={(note) => setModal({ kind: "note", note })} onClose={() => setCommentsOpen(false)} />}
          <div className="viewer-area">
            <div
              ref={containerRef}
              className={"viewer-container" + (state?.notesReady ? " notes-enabled" : "") + (noteTool && state?.tool === "none" ? " note-tool" : "") + (pointerMode === "hand" && state?.tool === "none" ? " hand-mode" : "") + (annotationsVisible ? "" : " hide-annotations")}
              onClickCapture={(event) => {
                if (!noteTool || !controller || !state?.notesReady || state.tool !== "none" || modal || (event.target as HTMLElement).closest(".openpdf-note")) return;
                const pageElement = (event.target as HTMLElement).closest<HTMLElement>(".page[data-page-number]");
                if (!pageElement) return;
                event.preventDefault(); event.stopPropagation();
                const page = Number(pageElement.dataset.pageNumber);
                const rect = controller.noteAtPoint(page, event.clientX, event.clientY);
                if (rect) setModal({ kind: "note", note: { id: crypto.randomUUID(), page, rect, text: "" } });
              }}
              dir="ltr"
              tabIndex={0}
            >
              <div ref={viewerRef} className="pdfViewer" />
              {controller && state?.notesReady && annotationsVisible && <NoteMarkers controller={controller} state={state} onEdit={(note) => setModal({ kind: "note", note })} />}
            </div>

            {controller && findState && findOpen && hasDocument && !presenting && (
              <FindBar
                controller={controller}
                findState={findState}
                focusToken={findFocus}
                onClose={() => {
                  setFindOpen(false);
                  controller.focus();
                }}
              />
            )}

            {!hasDocument && (
              <div className="welcome">
                <div className="welcome-card">
                  <div className="document-icon" aria-hidden="true">
                    PDF
                  </div>
                  <h1>OpenPDF</h1>
                  <p>{loading ? t("loading") : loadError ?? t("openHint")}</p>
                  <button type="button" className="primary-button" disabled={loading} onClick={openPicker}>
                    <Icon name="open" size={18} />
                    {t("openFile")}
                  </button>
                </div>
              </div>
            )}

            {presenting && (
              <button type="button" className="exit-present" onClick={() => setPresenting(false)}>
                {t("exitPresent")} (Esc)
              </button>
            )}
          </div>
        </div>

        {toast && (
          <div className="toast" role="status">
            {toast}
          </div>
        )}

        {modal?.kind === "note" && controller && <NoteEditor key={modal.note.id} note={modal.note}
          onSave={(note) => { controller.saveNote(note); setModal(null); setNoteTool(false); setCommentsOpen(true); }}
          onDelete={() => { controller.deleteNote(modal.note.id); setModal(null); }} onCancel={() => setModal(null)} />}
        {modal?.kind === "message" && (
          <MessageDialog title={modal.title} message={modal.message} onClose={() => setModal(null)} />
        )}
        {modal?.kind === "password" && <PasswordDialog key={modal.id} wrong={modal.wrong} onSubmit={modal.resolve} />}
        {modal?.kind === "confirm" && (
          <ConfirmDialog
            title={t("unsavedTitle")}
            message={t("unsavedPrompt")}
            confirmLabel={t("discard")}
            onConfirm={() => modal.resolve(true)}
            onCancel={() => modal.resolve(false)}
          />
        )}
        {modal?.kind === "printSetup" && state && <PrintSetupDialog count={state.pageCount} current={state.page} onCancel={() => setModal(null)} onSubmit={(pages, dpi) => void preparePrint(pages, dpi)} />}
        {modal?.kind === "print" && state && (
          <ProgressDialog
            message={t("preparingPrint", { done: modal.done, count: modal.total })}
            onCancel={() => {
              modal.abort.abort();
              setModal(null);
            }}
          />
        )}
        {modal?.kind === "properties" && controller && file && (
          <PropertiesDialog controller={controller} fileName={file.name} filePath={file.path} onClose={() => setModal(null)} />
        )}
      </main>
    </I18nContext.Provider>
  );
}
