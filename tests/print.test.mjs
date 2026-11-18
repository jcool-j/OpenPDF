import assert from "node:assert/strict";
import test from "node:test";
import { loadModule } from "./load-module.mjs";

async function printing({ count = 1, width = 595, height = 842, render, failImage = false, failPrint = false } = {}) {
  const urls = new Set();
  const canvases = [];
  const sizes = [];
  const events = new Map();
  let cleanedPages = 0;
  class Element {
    children = [];
    textContent = "";
    style = {};
    append(child) { child.parent = this; this.children.push(child); }
    remove() {
      if (this.parent) this.parent.children = this.parent.children.filter((child) => child !== this);
    }
    set src(value) { if (value) queueMicrotask(() => failImage ? this.onerror() : this.onload()); }
  }
  const document = {
    head: new Element(), body: new Element(),
    getElementById(id) { return this.body.children.find((element) => element.id === id); },
    createElement(tag) {
      const element = new Element();
      if (tag === "canvas") {
        Object.assign(element, {
          width: 0, height: 0,
          getContext: () => ({ save() {}, restore() {}, fillRect() {} }),
          toBlob: (callback) => callback(new Blob(["page"])),
        });
        canvases.push(element);
      }
      return element;
    },
  };
  const window = {
    addEventListener: (event, listener) => events.set(event, listener),
    removeEventListener: (event) => events.delete(event),
    print() {
      if (failPrint) throw new Error("print failed");
      events.get("afterprint")?.();
      events.delete("afterprint");
    },
  };
  const { printDocument } = await loadModule("src/services/pdf/print.ts", {
    "pdfjs-dist": { AnnotationMode: { ENABLE_STORAGE: 1 } },
  }, {
    document, window,
    URL: {
      createObjectURL: () => { const url = `blob:${sizes.length}`; urls.add(url); return url; },
      revokeObjectURL: (url) => urls.delete(url),
    },
  });
  const doc = {
    numPages: count, annotationStorage: { print: {} },
    async getPage() {
      return {
        getViewport: () => ({ width, height }),
        render(options) {
          sizes.push({ width: options.canvas.width, height: options.canvas.height, scale: options.transform[0] });
          return render?.(options) ?? { promise: Promise.resolve(), cancel() {} };
        },
        cleanup() { cleanedPages++; },
      };
    },
  };
  return { printDocument, doc, sizes, urls, canvases, document, events, get cleanedPages() { return cleanedPages; } };
}

test("ordinary documents retain 150 DPI and release their rasters after printing", async () => {
  const fixture = await printing();
  const ready = await fixture.printDocument(fixture.doc);
  assert.equal(fixture.sizes[0].scale, 150 / 72);
  assert.equal(fixture.urls.size, 1);
  assert.equal(fixture.cleanedPages, 1);
  assert.equal(fixture.canvases[0].width, 0, "working canvas is released before the print dialog");
  ready();
  assert.equal(fixture.urls.size, 0);
  assert.equal(fixture.document.body.children.length, 0);
  assert.equal(fixture.document.head.children.length, 0);
});

test("long documents never silently lower print resolution, and oversized jobs fail before rendering", async () => {
  const fixture = await printing({ count: 500 });
  await assert.rejects(fixture.printDocument(fixture.doc), /smaller page range/);
  assert.equal(fixture.sizes.length, 0);
  const short = await printing();
  const shortReady = await short.printDocument(short.doc);
  const ready = await fixture.printDocument(fixture.doc, { pages: [1, 250, 500] });
  assert.equal(fixture.sizes.length, 3);
  assert.equal(fixture.sizes[0].scale, short.sizes[0].scale);
  assert.ok(fixture.sizes.every((size) => size.scale === 150 / 72));
  ready(); shortReady();
  assert.equal(fixture.urls.size, 0);
});

test("selected pages only are rendered, in order, with selected-job progress and annotations", async () => {
  const requested = [], progress = [], storage = {};
  const fixture = await printing({ count: 500, render(options) {
    assert.equal(options.intent, "print");
    assert.equal(options.printAnnotationStorage, storage);
  } });
  fixture.doc.annotationStorage.print = storage;
  const original = fixture.doc.getPage;
  fixture.doc.getPage = async (page) => { requested.push(page); return original(page); };
  const ready = await fixture.printDocument(fixture.doc, { pages: [3, 17], dpi: 300, onProgress: (done, total) => progress.push([done,total]) });
  assert.deepEqual(requested, [3,17,3,17]); // preflight then render; never reads all source pages.
  assert.deepEqual(progress, [[1,2],[2,2]]);
  assert.equal(fixture.sizes[0].scale, 300 / 72);
  ready();
});

test("invalid page selections and pre-aborted jobs do no rendering", async () => {
  const fixture = await printing({ count: 5 });
  for (const pages of [[], [0], [6], [1,1], [1.5]]) await assert.rejects(fixture.printDocument(fixture.doc, { pages }), /Invalid print pages/);
  const abort = new AbortController(); abort.abort();
  assert.equal(await fixture.printDocument(fixture.doc, { signal: abort.signal }), null);
  assert.equal(fixture.sizes.length, 0);
});

test("oversized pages respect both per-page pixel and canvas dimension limits", async () => {
  for (const [width, height] of [[100000, 200000], [1e12, 1]]) {
    const fixture = await printing({ width, height });
    const ready = await fixture.printDocument(fixture.doc);
    const size = fixture.sizes[0];
    assert.ok(size.width <= 8192 && size.height <= 8192);
    assert.ok(size.width * size.height <= 16 * 1024 * 1024);
    ready();
  }
});

test("cancellation interrupts the current page render and releases resources", async () => {
  const abort = new AbortController();
  let cancelled = false;
  const fixture = await printing({
    render() {
      let reject;
      const promise = new Promise((_, fail) => { reject = fail; });
      queueMicrotask(() => abort.abort());
      return { promise, cancel() { cancelled = true; reject(new Error("render cancelled")); } };
    },
  });
  assert.equal(await fixture.printDocument(fixture.doc, { signal: abort.signal }), null);
  assert.equal(cancelled, true);
  assert.equal(fixture.canvases[0].width, 0);
  assert.equal(fixture.urls.size, 0);
});

test("image and native print failures release blob URLs, styles and canvases", async () => {
  const failedImage = await printing({ failImage: true });
  await assert.rejects(failedImage.printDocument(failedImage.doc), /image failed/);
  assert.equal(failedImage.urls.size, 0);
  assert.equal(failedImage.canvases[0].width, 0);
  const failedPrint = await printing({ failPrint: true });
  const ready = await failedPrint.printDocument(failedPrint.doc);
  assert.throws(ready, /print failed/);
  assert.equal(failedPrint.urls.size, 0);
  assert.equal(failedPrint.document.head.children.length, 0);
  assert.equal(failedPrint.events.size, 0);
});
