import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { writeFile, mkdir } from 'node:fs/promises';
await mkdir('test-results', { recursive: true });
const pdf = await PDFDocument.create();
const font = await pdf.embedFont(StandardFonts.Helvetica);
for (let n = 1; n <= 20; n++) {
  const p = pdf.addPage([595, 842]);
  p.drawText(`Memory regression page ${n}`, { x: 50, y: 700, size: 22, font });
}
await writeFile('test-results/memory-fixture.pdf', await pdf.save());
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, headless: true, args: ['--no-sandbox'] });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(process.env.OPENPDF_URL || 'http://127.0.0.1:1420');
  const active = '.document-tab-panel:not([hidden])';
  async function open() {
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Open file', exact: true }).first().click();
    await (await chooser).setFiles(process.env.OPENPDF_MEMORY_FIXTURE || 'test-results/memory-fixture.pdf');
    await page.waitForFunction(() => window.__openpdf?.getState().notesReady);
    await page.locator(`${active} .page canvas`).first().waitFor();
  }
  await open();
  // Use the dev-only controller to set state; actual drawing is pointer-driven.
  await page.evaluate(() => {
    window.__first = window.__openpdf;
    window.__first.setScalePercent(130);
    window.__first.goToPage(4);
    window.__first.find({ query: 'regression', caseSensitive: false, entireWord: false, highlightAll: true, findPrevious: false });
  });
  await page.locator(`${active} .page[data-page-number="4"] canvas`).waitFor();
  await page.evaluate(() => window.__first.goToPage(4));
  await page.waitForFunction(() => !window.__first.getFindState().pending);
  await page.getByRole('button', { name: 'Draw', exact: true }).click();
  const bounds = await page.locator(`${active} .viewer-container`).boundingBox();
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + 250);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width / 2 + 80, bounds.y + 290, { steps: 10 });
  await page.mouse.up();
  await page.evaluate(() => window.__first.setTool('none'));
  await page.waitForFunction(() => window.__first.getState().canUndo);
  await page.evaluate(() => {
    window.__first.saveNote({ id: 'memory-note', page: 4, rect: [100, 500, 125, 525], text: 'זיכרון - הערה בעברית', original: false });
    window.__savedState = { ...window.__first.getState() };
    window.__savedFind = { ...window.__first.getFindState() };
    window.__savedScroll = window.__first.container.scrollTop;
    window.__savedDoc = window.__first.document;
  });
  const samples = [];
  for (let tabs = 1; tabs <= 20; tabs++) {
    if (tabs > 1) { await page.getByRole('button', { name: 'New tab (Ctrl+T)', exact: true }).click(); await open(); }
    if ([1, 5, 10, 20].includes(tabs)) {
      // Waiting for a condition, not a timed sampling sleep.
      await page.waitForFunction(() => [...document.querySelectorAll('.document-tab-panel[hidden] .page canvas')].every(c => c.width === 0 || c.height === 0));
      const cdp = await page.context().newCDPSession(page);
      const heap = await cdp.send('Runtime.getHeapUsage');
      samples.push({ tabs, workers: page.workers().length, heapUsed: heap.usedSize, ...await page.evaluate(() => ({ canvases: document.querySelectorAll('canvas').length, pixels: [...document.querySelectorAll('canvas')].reduce((sum, c) => sum + c.width * c.height, 0) })) });
      await cdp.detach();
      await writeFile('test-results/openpdf-memory-suspension.json', JSON.stringify({ errors, samples }, null, 2));
    }
  }
  await page.getByRole('tab').first().click();
  await page.waitForFunction(() => window.__openpdf === window.__first);
  await page.locator(`${active} .page canvas`).first().waitFor();
  await page.getByRole('button', { name: /זיכרון - הערה בעברית/ }).waitFor();
  const restored = await page.evaluate(() => ({
    sameDoc: window.__first.document === window.__savedDoc,
    page: window.__first.getState().page === window.__savedState.page,
    scale: window.__first.getState().scale === window.__savedState.scale,
    rotation: window.__first.getState().rotation === window.__savedState.rotation,
    scroll: Math.abs(window.__first.container.scrollTop - window.__savedScroll) < 5,
    undo: window.__first.getState().canUndo,
    notes: window.__first.getState().notes.some(note => note.id === 'memory-note' && note.text.includes('עברית')),
    search: ['current', 'total', 'notFound'].every(key => window.__first.getFindState()[key] === window.__savedFind[key]),
    modified: window.__first.hasUnsavedChanges(),
  }));
  for (const [key, value] of Object.entries(restored)) assert.equal(value, true, key);
  await page.evaluate(() => window.__first.undo());
  await page.waitForFunction(() => window.__first.getState().canRedo);
  await page.evaluate(() => window.__first.redo());
  await page.waitForFunction(() => window.__first.getState().canUndo);
  await page.screenshot({ path: 'test-results/openpdf-memory-restored.png' });
  // Closing unmodified tabs must destroy their workers, not only hide canvases.
  while (await page.getByRole('tab').count() > 1) {
    await page.getByRole('tab').last().click();
    await page.keyboard.press('Control+w');
  }
  await page.waitForFunction(() => document.querySelectorAll('[role=tab]').length === 1);
  assert.equal(page.workers().length, 1);
  assert.deepEqual(errors, []);
  await writeFile('test-results/openpdf-memory-suspension.json', JSON.stringify({ errors, samples, restored, workersAfterClose: page.workers().length }, null, 2));
  console.log(JSON.stringify({ errors, samples, restored, workersAfterClose: page.workers().length }, null, 2));
} finally { await browser.close(); }
