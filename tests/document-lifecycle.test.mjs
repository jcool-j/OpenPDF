import assert from "node:assert/strict";
import test from "node:test";
import { loadModule } from "./load-module.mjs";

function deferred() {
  const result = {};
  result.promise = new Promise((resolve, reject) => Object.assign(result, { resolve, reject }));
  return result;
}

function document() {
  let modified = false;
  const storage = {
    hash: "initial", size: 1,
    get serializable() { return { hash: this.hash }; },
    change(hash) {
      this.hash = hash;
      if (!modified) { modified = true; this.onSetModified?.(); }
    },
    resetModified() { modified = false; },
  };
  return {
    numPages: 1, annotationStorage: storage,
    saveDocument: async () => new Uint8Array([1]),
    getData: async () => new Uint8Array([1]),
  };
}

function task(promise, destroy = async () => {}) {
  return { promise, destroyed: 0, async destroy() { this.destroyed++; await destroy(); } };
}

async function viewer() {
  const tasks = [];
  const resets = [];
  let started = 0;
  class EventBus {
    listeners = new Map();
    on(name, fn) { this.listeners.set(name, fn); }
    dispatch(name, value) { this.listeners.get(name)?.(value); }
  }
  class PDFViewer {
    pagesCount = 2;
    getPageView(index) { return { reset: options => resets.push({ index, options }) }; }
    setDocument() {}
    update() {}
  }
  const module = await loadModule("src/services/pdf/viewerController.ts", {
    "pdfjs-dist": {
      AnnotationEditorParamsType: {},
      AnnotationEditorType: { NONE: 0, INK: 1, FREETEXT: 2, HIGHLIGHT: 3 },
      AnnotationMode: { ENABLE_FORMS: 1 }, GlobalWorkerOptions: {},
      PasswordResponses: { INCORRECT_PASSWORD: 2 },
      getDocument: () => { started++; return tasks.shift(); },
    },
    "pdfjs-dist/web/pdf_viewer.mjs": {
      EventBus, PDFViewer, GenericL10n: class {},
      LinkTarget: { BLANK: 1 }, PDFFindController: class {},
      PDFLinkService: class { setViewer() {} setDocument() {} },
      ScrollMode: { PAGE: 1, VERTICAL: 0 }, SpreadMode: { NONE: 0, ODD: 1 },
    },
    "pdfjs-dist/build/pdf.worker.min.mjs?url": { default: "worker.mjs" },
    "pdfjs-dist/web/pdf_viewer.css": {},
  }, { document: { baseURI: "http://localhost/" }, ResizeObserver: class { observe() {} disconnect() {} } });
  const controller = new module.ViewerController({}, {});
  return { controller, tasks, module, resets, get started() { return started; } };
}

const open = async (fixture, doc) => {
  fixture.tasks.push(task(Promise.resolve(doc)));
  await fixture.controller.open(new Uint8Array(), async () => null);
};

test("edits made during serialization remain unsaved, even without another modified event", async () => {
  const fixture = await viewer();
  const doc = document();
  await open(fixture, doc);
  doc.annotationStorage.change("first edit");
  const serialized = deferred();
  doc.saveDocument = async () => {
    const bytes = await serialized.promise;
    doc.annotationStorage.resetModified();
    return bytes;
  };
  const pending = fixture.controller.prepareSave();
  doc.annotationStorage.change("second edit");
  serialized.resolve(new Uint8Array([1]));
  const snapshot = await pending;
  assert.equal(fixture.controller.markSaved(snapshot), false);
  assert.equal(fixture.controller.hasUnsavedChanges(), true);
});

test("a successful save clears only an unchanged snapshot", async () => {
  const fixture = await viewer();
  const doc = document();
  await open(fixture, doc);
  doc.annotationStorage.change("saved edit");
  const snapshot = await fixture.controller.prepareSave();
  assert.equal(fixture.controller.hasUnsavedChanges(), true, "generating bytes is not a completed save");
  assert.equal(fixture.controller.markSaved(snapshot), true);
  assert.equal(fixture.controller.hasUnsavedChanges(), false);
  doc.annotationStorage.change("later edit");
  assert.equal(fixture.controller.hasUnsavedChanges(), true);
});

test("a completed save for another document never clears the current document's edits", async () => {
  const fixture = await viewer();
  await open(fixture, document());
  const snapshot = await fixture.controller.prepareSave();
  const next = document();
  await open(fixture, next);
  next.annotationStorage.change("new document edit");
  assert.equal(fixture.controller.markSaved(snapshot), false);
  assert.equal(fixture.controller.hasUnsavedChanges(), true);
});

test("failed PDF loads destroy their worker, including password cancellation", async () => {
  const fixture = await viewer();
  for (const message of ["invalid PDF", "Password prompt cancelled"]) {
    const rejected = deferred();
    const failed = task(rejected.promise);
    fixture.tasks.push(failed);
    const pending = fixture.controller.open(new Uint8Array(), async () => null);
    await Promise.resolve();
    rejected.reject(new Error(message));
    await assert.rejects(pending, { message });
    assert.equal(failed.destroyed, 1);
    await fixture.controller.close();
    assert.equal(failed.destroyed, 1, "a failed task must not remain installed");
  }
});

test("a superseded load rejects instead of reporting success to its caller", async () => {
  const fixture = await viewer();
  const first = deferred();
  fixture.tasks.push(task(first.promise));
  const pending = fixture.controller.open(new Uint8Array(), async () => null);
  const rejected = assert.rejects(pending, fixture.module.OpenCancelled);
  await Promise.resolve();
  const next = document();
  await open(fixture, next);
  first.resolve(document());
  await rejected;
  assert.equal(fixture.controller.document, next);
});

test("a slow previous-worker shutdown cannot let an older request replace a newer document", async () => {
  const fixture = await viewer();
  const shutdown = deferred();
  fixture.tasks.push(task(Promise.resolve(document()), () => shutdown.promise));
  await fixture.controller.open(new Uint8Array(), async () => null);
  const pending = fixture.controller.open(new Uint8Array(), async () => null);
  const rejected = assert.rejects(pending, fixture.module.OpenCancelled);
  const next = document();
  await open(fixture, next);
  shutdown.resolve();
  await rejected;
  assert.equal(fixture.controller.document, next);
  assert.equal(fixture.started, 2, "the stale request must not start a new worker");
});

test("file operations exclude overlapping opens/saves before the first await and unlock after failure", async () => {
  const { FileOperations } = await loadModule("src/services/files/operations.ts");
  const operations = new FileOperations();
  const gate = deferred();
  const first = operations.run(() => gate.promise);
  assert.equal(operations.busy, true);
  let secondRan = false;
  await operations.run(async () => { secondRan = true; });
  assert.equal(secondRan, false);
  gate.resolve();
  await first;
  assert.equal(operations.busy, false);
  await assert.rejects(operations.run(async () => { throw new Error("save failed"); }));
  await operations.run(async () => { secondRan = true; });
  assert.equal(secondRan, true);
});

test("file operation subscribers are notified when the queue can be flushed", async () => {
  const { FileOperations } = await loadModule("src/services/files/operations.ts");
  const operations = new FileOperations();
  const states = [];
  const unsubscribe = operations.subscribe(() => states.push(operations.busy));
  await operations.run(async () => {
    assert.equal(operations.busy, true);
  });
  unsubscribe();
  assert.deepEqual(states, [true, false]);
});

test("switching inactive suspends a tab's editor shortcuts without closing its document", async () => {
  const fixture = await viewer();
  const doc = document();
  await open(fixture, doc);
  const calls = [];
  fixture.controller.eventBus.dispatch("annotationeditoruimanager", {
    uiManager: {
      removeEditListeners() { calls.push("suspend"); },
      addEditListeners() { calls.push("resume"); },
      commitOrRemove() { calls.push("commit"); },
    },
  });
  doc.annotationStorage.change("unsaved tab edit");
  fixture.controller.setActive(false);
  fixture.controller.setActive(true);
  assert.deepEqual(calls, ["commit", "suspend", "resume"]);
  assert.equal(fixture.controller.document, doc);
  assert.equal(fixture.controller.hasUnsavedChanges(), true);
});

test("destroying a tab releases its worker exactly once and prevents it reopening", async () => {
  const fixture = await viewer();
  const current = task(Promise.resolve(document()));
  fixture.tasks.push(current);
  await fixture.controller.open(new Uint8Array(), async () => null);
  await fixture.controller.destroy();
  await fixture.controller.destroy();
  assert.equal(current.destroyed, 1);
  assert.equal(fixture.controller.document, null);
  await assert.rejects(fixture.controller.open(new Uint8Array(), async () => null), fixture.module.OpenCancelled);
});


test("preview quality uses a page-count budget independent of printing", async () => {
  const { module } = await viewer();
  assert.equal(module.previewPixelBudget(1), 8 * 1024 * 1024);
  assert.equal(module.previewPixelBudget(50), 8 * 1024 * 1024);
  assert.equal(module.previewPixelBudget(51), 4 * 1024 * 1024);
  assert.equal(module.previewPixelBudget(201), 2 * 1024 * 1024);
  assert.equal(module.previewPixelBudget(501), 1024 * 1024);
});


test("inactive tabs release raster canvases without discarding editor and text layers", async () => {
  const fixture = await viewer();
  const doc = document();
  await open(fixture, doc);
  fixture.controller.setActive(false);
  assert.equal(fixture.controller.document, doc);
  assert.equal(fixture.resets.length, 2);
  for (const { options } of fixture.resets) {
    assert.equal(options.keepTextLayer, true);
    assert.equal(options.keepAnnotationLayer, true);
    assert.equal(options.keepAnnotationEditorLayer, true);
    assert.equal(options.keepXfaLayer, true);
    assert.equal(options.keepCanvasWrapper, undefined);
  }
  fixture.controller.setActive(true);
  assert.equal(fixture.controller.document, doc);
});
