// Copies the PDF.js runtime resources (CMaps, standard fonts, WASM decoders,
// ICC profiles) into public/pdfjs so the app can render every PDF offline.
import { cp, mkdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = join(root, "node_modules", "pdfjs-dist");
const target = join(root, "public", "pdfjs");

await rm(target, { recursive: true, force: true });
await mkdir(target, { recursive: true });
for (const dir of ["cmaps", "standard_fonts", "wasm", "iccs"]) {
  await cp(join(source, dir), join(target, dir), { recursive: true });
}
await cp(join(source, "web", "images"), join(target, "images"), { recursive: true });
await cp(join(source, "LICENSE"), join(target, "LICENSE"));
console.log("PDF.js assets copied to public/pdfjs");
