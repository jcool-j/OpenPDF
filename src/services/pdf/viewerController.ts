import type { StickyNote } from "./stickyNotes";
// The single frontend boundary that talks to PDF.js. React components consume
// the plain state exposed here and never import pdfjs-dist directly.
import {
  AnnotationEditorParamsType,
  AnnotationEditorType,
  AnnotationMode,
  GlobalWorkerOptions,
  PasswordResponses,
  getDocument,
  type PDFDocumentLoadingTask,
  type PDFDocumentProxy,
} from "pdfjs-dist";
import {
  EventBus,
  GenericL10n,
  LinkTarget,
  PDFFindController,
  PDFLinkService,
  PDFViewer,
  ScrollMode,
  SpreadMode,
} from "pdfjs-dist/web/pdf_viewer.mjs";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import "pdfjs-dist/web/pdf_viewer.css";

GlobalWorkerOptions.workerSrc = workerUrl;

const assetUrl = (dir: string) => new URL(`pdfjs/${dir}/`, document.baseURI).href;

export type EditorTool = "none" | "ink" | "text" | "highlight";
export type FitMode = "page-width" | "page-fit";

export interface ViewerState {
  hasDocument: boolean;
  page: number;
  pageCount: number;
  scale: number;
  scaleValue: string;
  rotation: number;
  twoPages: boolean;
  tool: EditorTool;
  canUndo: boolean;
  canRedo: boolean;
  hasSelectedEditor: boolean;
  modified: boolean;
  presenting: boolean;
  notes: readonly StickyNote[];
  notesReady: boolean;
  renderVersion: number;
}

export interface FindState {
  current: number;
  total: number;
  notFound: boolean;
  pending: boolean;
}

export interface FindOptions {
  query: string;
  caseSensitive: boolean;
  entireWord: boolean;
}

export type PasswordPrompt = (wrongPassword: boolean) => Promise<string | null>;

export class PasswordCancelled extends Error {}
export class OpenCancelled extends Error {}

export interface SaveSnapshot {
  readonly document: PDFDocumentProxy;
  readonly annotationHash: string;
  readonly data: Uint8Array;
  readonly notesVersion: number;
}

const TOOL_TO_MODE: Record<EditorTool, number> = {
  none: AnnotationEditorType.NONE,
  ink: AnnotationEditorType.INK,
  text: AnnotationEditorType.FREETEXT,
  highlight: AnnotationEditorType.HIGHLIGHT,
};

export const HIGHLIGHT_COLORS: Record<string, string> = {
  yellow: "#FFFF98",
  green: "#53FFBC",
  blue: "#80EBFF",
  pink: "#FFCBE6",
  red: "#FF4F5F",
};

// Preview-only per-page cap: 8 MP through 50 pages, 4 MP through 200,
// 2 MP through 500, then 1 MP. PDF.js still prioritizes visible pages and
// detail canvases. Printing has its own independent DPI and limits.
export function previewPixelBudget(pageCount: number): number {
  return (pageCount > 500 ? 1 : pageCount > 200 ? 2 : pageCount > 50 ? 4 : 8) * 1024 * 1024;
}

const MIN_SCALE = 0.1;
const MAX_SCALE = 10;

interface EditorUIManager {
  addEditListeners(): void;
  removeEditListeners(): void;
  updateParams(type: number, value: unknown): void;
  undo(): void;
  redo(): void;
  delete(): void;
  commitOrRemove(): void;
  currentLayer?: { endDrawingSession(isAborted: boolean): unknown } | null;
}

const INITIAL_STATE: ViewerState = {
  hasDocument: false,
  page: 1,
  pageCount: 0,
  scale: 1,
  scaleValue: "auto",
  rotation: 0,
  twoPages: false,
  tool: "none",
  canUndo: false,
  canRedo: false,
  hasSelectedEditor: false,
  modified: false,
  presenting: false,
  notes: [], notesReady: false, renderVersion: 0,
};

const INITIAL_FIND: FindState = { current: 0, total: 0, notFound: false, pending: false };

export class ViewerController {
  readonly eventBus = new EventBus();
  readonly container: HTMLDivElement;
  private readonly linkService: PDFLinkService;
  private readonly findController: PDFFindController;
  private readonly viewer: PDFViewer;
  private loadingTask: PDFDocumentLoadingTask | null = null;
  private openRequest = 0;
  private uiManager: EditorUIManager | null = null;
  private doc: PDFDocumentProxy | null = null;
  private state: ViewerState = INITIAL_STATE;
  private findState: FindState = INITIAL_FIND;
  private readonly listeners = new Set<() => void>();
  private scaleBeforePresenting = "auto";
  private lastFind: FindOptions | null = null;
  private readonly lifetime = new AbortController();
  private readonly resizeObserver: ResizeObserver;
  private active = true;
  private destroyed = false;
  private initialScalePending = false;
  private notesVersion = 0;
  private readonly changedNotes = new Set<string>();

  constructor(container: HTMLDivElement, viewerElement: HTMLDivElement) {
    this.container = container;
    const eventBus = this.eventBus;
    this.linkService = new PDFLinkService({ eventBus, externalLinkTarget: LinkTarget.BLANK });
    this.findController = new PDFFindController({
      eventBus,
      linkService: this.linkService,
      updateMatchesCountOnProgress: true,
    });
    this.viewer = new PDFViewer({
      // Supported by PDF.js 6.5; not included in its generated option types.
      ...{ abortSignal: this.lifetime.signal },
      container,
      viewer: viewerElement,
      eventBus,
      linkService: this.linkService,
      findController: this.findController,
      // No language: use the English strings bundled with PDF.js (nothing is fetched).
      l10n: new GenericL10n(undefined as unknown as string),
      annotationMode: AnnotationMode.ENABLE_FORMS,
      annotationEditorMode: AnnotationEditorType.NONE,
      annotationEditorHighlightColors: Object.entries(HIGHLIGHT_COLORS)
        .map(([name, value]) => `${name}=${value}`)
        .join(","),
      imageResourcesPath: assetUrl("images"),
      supportsPinchToZoom: true,
      maxCanvasPixels: 8 * 1024 * 1024,
      maxCanvasDim: 8192,
      enableDetailCanvas: true,
    });
    this.linkService.setViewer(this.viewer);

    eventBus.on("pagerendered", () => this.patch({ renderVersion: this.state.renderVersion + 1 }));
    eventBus.on("pagesinit", () => {
      this.initialScalePending = true;
      this.handleResize();
      this.patch({ pageCount: this.viewer.pagesCount, page: this.viewer.currentPageNumber });
    });
    eventBus.on("pagechanging", (evt: { pageNumber: number }) => this.patch({ page: evt.pageNumber }));
    eventBus.on("scalechanging", (evt: { scale: number; presetValue?: string }) =>
      this.patch({ scale: evt.scale, scaleValue: evt.presetValue ?? String(evt.scale) }),
    );
    eventBus.on("rotationchanging", (evt: { pagesRotation: number }) =>
      this.patch({ rotation: evt.pagesRotation }),
    );
    eventBus.on("spreadmodechanged", (evt: { mode: number }) =>
      this.patch({ twoPages: evt.mode !== SpreadMode.NONE }),
    );
    eventBus.on("annotationeditoruimanager", (evt: { uiManager: EditorUIManager }) => {
      this.uiManager = evt.uiManager;
      if (!this.active) this.uiManager.removeEditListeners();
    });
    eventBus.on("annotationeditormodechanged", (evt: { mode: number }) => {
      const tool = (Object.keys(TOOL_TO_MODE) as EditorTool[]).find((k) => TOOL_TO_MODE[k] === evt.mode);
      this.patch({ tool: tool ?? "none" });
    });
    eventBus.on(
      "editingstateschanged",
      (evt: { details: { hasSomethingToUndo: boolean; hasSomethingToRedo: boolean; hasSelectedEditor: boolean } }) =>
        this.patch({
          canUndo: evt.details.hasSomethingToUndo,
          canRedo: evt.details.hasSomethingToRedo,
          hasSelectedEditor: evt.details.hasSelectedEditor,
        }),
    );
    eventBus.on("updatefindmatchescount", (evt: { matchesCount: { current: number; total: number } }) =>
      this.patchFind({ current: evt.matchesCount.current, total: evt.matchesCount.total }),
    );
    eventBus.on(
      "updatefindcontrolstate",
      (evt: { state: number; matchesCount: { current: number; total: number } }) =>
        this.patchFind({
          current: evt.matchesCount.current,
          total: evt.matchesCount.total,
          notFound: evt.state === 1,
          pending: evt.state === 3,
        }),
    );

    this.resizeObserver = new ResizeObserver(() => this.handleResize());
    this.resizeObserver.observe(container);
  }

  // --- state subscription (useSyncExternalStore compatible) ---
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  getState = () => this.state;
  getFindState = () => this.findState;

  private patch(partial: Partial<ViewerState>) {
    const next = { ...this.state, ...partial };
    if ((Object.keys(partial) as (keyof ViewerState)[]).every((k) => this.state[k] === next[k])) return;
    this.state = next;
    this.listeners.forEach((l) => l());
  }

  private patchFind(partial: Partial<FindState>) {
    this.findState = { ...this.findState, ...partial };
    this.listeners.forEach((l) => l());
  }

  get document() {
    return this.doc;
  }

  // --- document lifecycle ---
  async open(data: Uint8Array, askPassword: PasswordPrompt): Promise<void> {
    if (this.destroyed) throw new OpenCancelled();
    // Reserve the request before waiting for the previous worker to stop.
    const request = ++this.openRequest;
    await this.closeDocument();
    if (request !== this.openRequest) throw new OpenCancelled();
    const task = getDocument({
      data,
      cMapUrl: assetUrl("cmaps"),
      cMapPacked: true,
      standardFontDataUrl: assetUrl("standard_fonts"),
      wasmUrl: assetUrl("wasm"),
      iccUrl: assetUrl("iccs"),
    });
    this.loadingTask = task;
    task.onPassword = (update: (password: string | Error) => void, reason: number) => {
      void askPassword(reason === PasswordResponses.INCORRECT_PASSWORD).then((password) => {
        update(password ?? new PasswordCancelled("Password prompt cancelled"));
      });
    };
    let doc: PDFDocumentProxy;
    try {
      doc = await task.promise;
    } catch (error) {
      if (this.loadingTask === task) this.loadingTask = null;
      await task.destroy().catch(() => undefined);
      if (request !== this.openRequest) throw new OpenCancelled();
      throw error;
    }
    if (request !== this.openRequest) {
      await task.destroy().catch(() => undefined);
      throw new OpenCancelled();
    }
    this.doc = doc;
    const storage = doc.annotationStorage as unknown as {
      onSetModified: (() => void) | null;
    };
    // PDF.js clears its own flag whenever the bytes are generated; ours is only cleared by
    // markSaved(), i.e. once the file was really written (the user may cancel the save dialog).
    storage.onSetModified = () => this.patch({ modified: true });
    this.viewer.maxCanvasPixels = previewPixelBudget(doc.numPages);
    this.viewer.setDocument(doc);
    this.linkService.setDocument(doc, null);
    this.patch({ ...INITIAL_STATE, hasDocument: true, pageCount: doc.numPages });
    this.findState = INITIAL_FIND;
    // Read standard PDF Text notes, including those made in other readers.
    if (typeof doc.getAnnotationsByType === "function") {
      try {
        const annotations = await doc.getAnnotationsByType(new Set([1]), new Set()) as Array<{ id: string; pageIndex: number; rect: number[]; contentsObj?: { str?: string } }>;
        if (this.doc === doc && request === this.openRequest) this.patch({ notes: (annotations ?? []).map((note) => ({ id: note.id, page: note.pageIndex + 1, rect: note.rect, text: note.contentsObj?.str ?? "", original: true })), notesReady: true });
      } catch (error) {
        console.warn("Could not load PDF comments", error);
        // Do not expose editing over an incomplete comment list.
      }
    } else this.patch({ notesReady: true });
  }

  async close(): Promise<void> {
    ++this.openRequest;
    await this.closeDocument();
  }

  /** Release a closed tab's worker, PDF.js DOM listeners, and observers. */
  async destroy(): Promise<void> {
    if (this.destroyed) return;
    this.destroyed = true;
    await this.close();
    this.resizeObserver.disconnect();
    this.lifetime.abort();
    this.listeners.clear();
  }

  setActive(active: boolean) {
    if (this.destroyed) return;
    if (!active) {
      this.commitEdits();
      this.uiManager?.removeEditListeners();
    } else if (!this.active) {
      this.uiManager?.addEditListeners();
    }
    this.active = active;
    if (active) this.handleResize();
  }

  private async closeDocument(): Promise<void> {
    const task = this.loadingTask;
    this.loadingTask = null;
    this.uiManager = null;
    this.lastFind = null;
    this.notesVersion = 0;
    this.changedNotes.clear();
    this.initialScalePending = false;
    if (this.doc) {
      this.viewer.setDocument(null as unknown as PDFDocumentProxy);
      this.linkService.setDocument(null, null);
      this.doc = null;
    }
    this.findState = INITIAL_FIND;
    this.patch({ ...INITIAL_STATE });
    if (task) await task.destroy().catch(() => undefined);
  }

  /** Returns the document bytes, including any annotations added by the user. */
  async getBytes(): Promise<Uint8Array> {
    const doc = this.requireDoc();
    this.commitEdits();
    const bytes = await (doc.annotationStorage.size > 0 ? doc.saveDocument() : doc.getData());
    if (!this.changedNotes.size) return bytes;
    const { writeStickyNotes } = await import("./stickyNotes");
    return writeStickyNotes(bytes, this.state.notes, this.changedNotes);
  }

  /** Captures the exact document and annotation contents being written. */
  async prepareSave(): Promise<SaveSnapshot> {
    const doc = this.requireDoc();
    this.commitEdits();
    // PDF.js only emits onSetModified on its first change, so a boolean or
    // event counter cannot detect subsequent edits during serialization.
    const annotationHash = doc.annotationStorage.serializable.hash;
    const notesVersion = this.notesVersion;
    const notes = this.state.notes.map((note) => ({ ...note, rect: [...note.rect] }));
    const changed = new Set(this.changedNotes);
    let data = await (doc.annotationStorage.size > 0 ? doc.saveDocument() : doc.getData());
    if (changed.size) {
      const { writeStickyNotes } = await import("./stickyNotes");
      data = await writeStickyNotes(data, notes, changed);
    }
    return { document: doc, annotationHash, notesVersion, data };
  }

  /**
   * Finishes any stroke or text box that is still being edited so it reaches the
   * document's annotation storage (needed before saving, printing or closing).
   */
  commitEdits() {
    try {
      this.uiManager?.currentLayer?.endDrawingSession(false);
      this.uiManager?.commitOrRemove();
    } catch (error) {
      console.warn("Could not commit the active annotation", error);
    }
  }

  hasUnsavedChanges(): boolean {
    this.commitEdits();
    return this.state.modified;
  }

  markSaved(snapshot: SaveSnapshot): boolean {
    if (this.doc !== snapshot.document) return false;
    this.commitEdits();
    if (this.notesVersion !== snapshot.notesVersion || this.doc.annotationStorage.serializable.hash !== snapshot.annotationHash) {
      this.patch({ modified: true });
      return false;
    }
    this.doc.annotationStorage.resetModified();
    this.patch({ modified: false });
    return true;
  }

  hasNoteChanges() { return this.changedNotes.size > 0; }
  saveNote(note: StickyNote) {
    if (!this.doc || !this.state.notesReady || !note.text.trim() || note.page < 1 || note.page > this.doc.numPages) return;
    const notes = this.state.notes.filter((item) => item.id !== note.id);
    notes.push({ ...note, rect: [...note.rect] });
    this.changedNotes.add(note.id); this.notesVersion++;
    this.patch({ notes: notes.sort((a, b) => a.page - b.page), modified: true });
  }
  deleteNote(id: string) {
    if (!this.state.notes.some((note) => note.id === id)) return;
    const note = this.state.notes.find((note) => note.id === id)!;
    if (note.original) this.changedNotes.add(id); else this.changedNotes.delete(id);
    this.notesVersion++;
    this.patch({ notes: this.state.notes.filter((note) => note.id !== id), modified: true });
  }
  notePosition(pageNumber: number, rect: readonly number[]) {
    const view = this.viewer.getPageView(pageNumber - 1);
    if (!view?.div) return null;
    const [x, y] = view.viewport.convertToViewportPoint(rect[0], rect[3]);
    return { element: view.div, x, y };
  }
  noteAtPoint(pageNumber: number, clientX: number, clientY: number): number[] | null {
    const view = this.viewer.getPageView(pageNumber - 1);
    if (!view?.div) return null;
    const box = view.div.getBoundingClientRect();
    const [x, y] = view.viewport.convertToPdfPoint(clientX - box.left, clientY - box.top);
    return [x, y - 22, x + 22, y];
  }

  private requireDoc(): PDFDocumentProxy {
    if (!this.doc) throw new Error("No document is open");
    return this.doc;
  }

  // --- navigation ---
  goToPage(page: number) {
    if (!this.doc) return;
    this.viewer.currentPageNumber = Math.min(Math.max(1, Math.round(page)), this.viewer.pagesCount);
  }
  nextPage() {
    this.viewer.nextPage();
  }
  previousPage() {
    this.viewer.previousPage();
  }
  goToDestination(dest: string | unknown[]) {
    void this.linkService.goToDestination(dest as string | never[]);
  }
  focus() {
    this.container.focus({ preventScroll: true });
  }

  // --- zoom / layout ---
  zoomIn(origin?: [number, number]) {
    if (this.doc) this.viewer.updateScale({ steps: 1, origin, drawingDelay: origin ? 300 : 0 });
  }
  zoomOut(origin?: [number, number]) {
    if (this.doc) this.viewer.updateScale({ steps: -1, origin, drawingDelay: origin ? 300 : 0 });
  }
  setScalePercent(percent: number) {
    if (!this.doc || !Number.isFinite(percent)) return;
    const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, percent / 100));
    this.viewer.currentScaleValue = String(scale);
  }
  setFit(mode: FitMode | "auto" | "page-actual") {
    if (this.doc) this.viewer.currentScaleValue = mode;
  }
  rotate(delta: 90 | -90) {
    if (this.doc) this.viewer.pagesRotation = (this.viewer.pagesRotation + delta + 360) % 360;
  }
  setTwoPages(enabled: boolean) {
    if (!this.doc) return;
    this.viewer.spreadMode = enabled ? SpreadMode.ODD : SpreadMode.NONE;
    this.handleResize();
  }

  private handleResize() {
    if (!this.doc || !this.active || !this.container.clientWidth || !this.container.clientHeight) return;
    if (this.initialScalePending) {
      this.initialScalePending = false;
      this.viewer.currentScaleValue = "auto";
    }
    const value = this.viewer.currentScaleValue;
    if (value === "auto" || value === "page-fit" || value === "page-width") {
      this.viewer.currentScaleValue = value;
    }
    this.viewer.update();
  }

  setPresenting(enabled: boolean) {
    if (!this.doc || enabled === this.state.presenting) {
      if (!enabled) this.patch({ presenting: false });
      return;
    }
    if (enabled) {
      this.setTool("none");
      this.scaleBeforePresenting = this.viewer.currentScaleValue;
      this.viewer.scrollMode = ScrollMode.PAGE;
      this.viewer.currentScaleValue = "page-fit";
    } else {
      this.viewer.scrollMode = ScrollMode.VERTICAL;
      this.viewer.currentScaleValue = this.scaleBeforePresenting;
    }
    this.patch({ presenting: enabled });
  }

  // --- annotation editing ---
  setTool(tool: EditorTool) {
    if (!this.doc || !this.uiManager) return;
    this.viewer.annotationEditorMode = { mode: TOOL_TO_MODE[tool] };
  }
  setInkStyle(style: { color?: string; thickness?: number; opacity?: number }) {
    const m = this.uiManager;
    if (!m) return;
    if (style.color !== undefined) m.updateParams(AnnotationEditorParamsType.INK_COLOR, style.color);
    if (style.thickness !== undefined) m.updateParams(AnnotationEditorParamsType.INK_THICKNESS, style.thickness);
    if (style.opacity !== undefined) m.updateParams(AnnotationEditorParamsType.INK_OPACITY, style.opacity);
  }
  setTextStyle(style: { color?: string; size?: number }) {
    const m = this.uiManager;
    if (!m) return;
    if (style.color !== undefined) m.updateParams(AnnotationEditorParamsType.FREETEXT_COLOR, style.color);
    if (style.size !== undefined) m.updateParams(AnnotationEditorParamsType.FREETEXT_SIZE, style.size);
  }
  setHighlightColor(color: string) {
    this.uiManager?.updateParams(AnnotationEditorParamsType.HIGHLIGHT_COLOR, color);
  }
  undo() {
    this.uiManager?.undo();
  }
  redo() {
    this.uiManager?.redo();
  }
  deleteSelected() {
    this.uiManager?.delete();
  }

  // --- find ---
  find(options: FindOptions, direction: "new" | "next" | "previous" = "new") {
    if (!this.doc) return;
    const sameQuery =
      this.lastFind?.query === options.query &&
      this.lastFind.caseSensitive === options.caseSensitive &&
      this.lastFind.entireWord === options.entireWord;
    this.lastFind = options;
    this.eventBus.dispatch("find", {
      source: this,
      type: direction === "new" || !sameQuery ? "" : "again",
      query: options.query,
      caseSensitive: options.caseSensitive,
      entireWord: options.entireWord,
      highlightAll: true,
      findPrevious: direction === "previous",
      matchDiacritics: false,
    });
    if (!options.query) this.findState = INITIAL_FIND;
  }
  closeFind() {
    this.lastFind = null;
    this.eventBus.dispatch("findbarclose", { source: this });
    this.patchFind(INITIAL_FIND);
  }
}
