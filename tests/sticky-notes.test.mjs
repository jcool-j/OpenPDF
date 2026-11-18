import assert from "node:assert/strict";
import test from "node:test";
import * as pdfLib from "pdf-lib";
import { loadModule } from "./load-module.mjs";

const { PDFDocument, PDFName, PDFArray, PDFDict, PDFHexString } = pdfLib;
const { writeStickyNotes } = await loadModule("src/services/pdf/stickyNotes.ts", { "pdf-lib": pdfLib });
const text = "הערה בעברית\nשורה שנייה";
async function fixture() { const pdf = await PDFDocument.create(); pdf.addPage(); pdf.addPage([842, 595]); return pdf.save(); }
const added = { id: "new-note", page: 2, rect: [30, 60, 52, 82], text };
async function annotations(bytes) {
  const doc = await PDFDocument.load(bytes);
  const values = doc.getPage(1).node.lookup(PDFName.of("Annots"), PDFArray);
  return { doc, values, items: values.asArray().map((ref) => ({ ref, dict: doc.context.lookup(ref, PDFDict) })) };
}

test("sticky notes serialize as standard Text plus linked Popup, with Unicode contents", async () => {
  const bytes = await writeStickyNotes(await fixture(), [added], new Set([added.id]));
  const { items } = await annotations(bytes);
  const note = items.find(({ dict }) => dict.get(PDFName.of("Subtype")) === PDFName.of("Text"));
  const popup = items.find(({ dict }) => dict.get(PDFName.of("Subtype")) === PDFName.of("Popup"));
  assert.equal(note.dict.lookup(PDFName.of("Contents"), PDFHexString).decodeText(), text);
  assert.equal(popup.dict.get(PDFName.of("Parent")), note.ref);
  assert.equal(note.dict.get(PDFName.of("Popup")), popup.ref);
  assert.deepEqual(note.dict.lookup(PDFName.of("Rect"), PDFArray).asArray().map((value) => value.asNumber()), added.rect);
});

test("editing and deleting reopened notes preserves unrelated annotations", async () => {
  let bytes = await writeStickyNotes(await fixture(), [added], new Set([added.id]));
  const { doc, values, items } = await annotations(bytes);
  const note = items.find(({ dict }) => dict.get(PDFName.of("Subtype")) === PDFName.of("Text"));
  const id = `${note.ref.objectNumber}R`;
  values.push(doc.context.register(doc.context.obj({ Type: "Annot", Subtype: "Link", Rect: [0,0,10,10] })));
  bytes = await doc.save();
  const reopened = { ...added, id, original: true, text: "Updated\nעוד שורה" };
  bytes = await writeStickyNotes(bytes, [reopened], new Set([id]));
  const edited = await annotations(bytes);
  assert.equal(edited.items.find(({dict}) => dict.get(PDFName.of("Subtype")) === PDFName.of("Text")).dict.lookup(PDFName.of("Contents"), PDFHexString).decodeText(), reopened.text);
  bytes = await writeStickyNotes(bytes, [], new Set([id]));
  const deleted = await annotations(bytes);
  assert.equal(deleted.items.length, 1);
  assert.equal(deleted.items[0].dict.get(PDFName.of("Subtype")), PDFName.of("Link"));
});

test("unchanged note saves return the original data without rewriting the PDF", async () => {
  const bytes = await fixture();
  assert.equal(await writeStickyNotes(bytes, [], new Set()), bytes);
});
