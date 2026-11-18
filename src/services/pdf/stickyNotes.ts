import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFRef } from "pdf-lib";

export interface StickyNote {
  id: string;
  page: number;
  rect: number[];
  text: string;
  original?: boolean;
}

/** Only touched /Text annotations are changed. Other annotation types stay intact. */
export async function writeStickyNotes(bytes: Uint8Array, notes: readonly StickyNote[], changed: ReadonlySet<string>): Promise<Uint8Array> {
  if (!changed.size) return bytes;
  // Do not ignore encryption: pdf-lib cannot safely rewrite encrypted PDFs.
  const pdf = await PDFDocument.load(bytes);
  const applied = new Set<string>();
  for (const [index, page] of pdf.getPages().entries()) {
    let annots = page.node.lookupMaybe(PDFName.of("Annots"), PDFArray);
    if (!annots) { annots = pdf.context.obj([]); page.node.set(PDFName.of("Annots"), annots); }
    const handled = new Set<string>();
    for (let position = annots.size() - 1; position >= 0; position--) {
      const ref = annots.get(position);
      const annotation = pdf.context.lookup(ref);
      if (!(annotation instanceof PDFDict) || annotation.get(PDFName.of("Subtype")) !== PDFName.of("Text")) continue;
      const id = ref instanceof PDFRef ? `${ref.objectNumber}R${ref.generationNumber || ""}` : "";
      if (!changed.has(id)) continue;
      handled.add(id); applied.add(id);
      const note = notes.find((item) => item.id === id && item.page === index + 1);
      if (!note) {
        const popup = annotation.get(PDFName.of("Popup"));
        if (popup) for (let p = annots.size() - 1; p >= 0; p--) if (annots.get(p) === popup) annots.remove(p);
        // Removing a popup after the parent may have shifted the parent index.
        for (let p = annots.size() - 1; p >= 0; p--) if (annots.get(p) === ref) annots.remove(p);
      } else {
        annotation.set(PDFName.of("Contents"), PDFHexString.fromText(note.text));
        // Rich text could override the newly edited plain-text contents.
        annotation.delete(PDFName.of("RC"));
      }
    }
    for (const note of notes) {
      if (note.page !== index + 1 || note.original || !changed.has(note.id) || handled.has(note.id)) continue;
      const annotation = pdf.context.obj({ Type: "Annot", Subtype: "Text", Rect: note.rect,
        Contents: PDFHexString.fromText(note.text), NM: PDFHexString.fromText(note.id),
        Name: "Note", C: [1, 0.85, 0.2], F: 4, Open: false });
      const ref = pdf.context.register(annotation);
      const [x, y] = note.rect;
      const popup = pdf.context.register(pdf.context.obj({ Type: "Annot", Subtype: "Popup", Parent: ref,
        Rect: [x + 24, y, x + 224, y + 120], Open: false }));
      annotation.set(PDFName.of("Popup"), popup);
      annots.push(ref); annots.push(popup); applied.add(note.id);
    }
  }
  for (const id of changed) {
    if (!applied.has(id)) throw new Error("Cannot safely match the original PDF comment");
  }
  return pdf.save();
}
