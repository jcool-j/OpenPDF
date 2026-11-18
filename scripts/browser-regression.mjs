import { chromium } from 'playwright';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { writeFile, mkdir } from 'node:fs/promises';
await mkdir('test-results', { recursive: true });
import assert from 'node:assert/strict';
const pdf = await PDFDocument.create(); const font = await pdf.embedFont(StandardFonts.Helvetica);
for (let i=0;i<20;i++) { const p=pdf.addPage(i%2 ? [842,595] : [595,842]);p.drawText(`OpenPDF regression page ${i+1}`,{x:50,y:500,font,size:24});p.drawText('Fine detail 0123456789 abcdef',{x:50,y:470,font,size:8}); }
await writeFile('test-results/openpdf-fixture.pdf',await pdf.save());
const browser = await chromium.launch({executablePath:process.env.CHROME_PATH || undefined,headless:true,args:['--no-sandbox']});
try {
const page = await browser.newPage({viewport:{width:1280,height:900}});const errors=[];
page.on('pageerror',e=>{errors.push(e.message);console.log('PAGE ERROR',e.stack);});
await page.addInitScript(()=>localStorage.setItem('openpdf.theme','dark'));
await page.goto(process.env.OPENPDF_URL || 'http://127.0.0.1:1420');
async function open(path='test-results/openpdf-fixture.pdf') {
 const chooser=page.waitForEvent('filechooser');await page.getByRole('button',{name:'Open file',exact:true}).first().click();await (await chooser).setFiles(path);
 await page.waitForFunction(()=>window.__openpdf?.getState().hasDocument && window.__openpdf?.getState().notesReady);
 await page.locator('.document-tab-panel:not([hidden]) canvas').first().waitFor();
}
await open();
await page.getByRole('button',{name:'Print (Ctrl+P)',exact:true}).click();
await page.getByRole('dialog').waitFor();
assert.equal(await page.evaluate(()=>document.querySelector('#print-container')),null);
await page.screenshot({path:'test-results/openpdf-print-setup.png'});
await page.getByRole('button',{name:'Cancel',exact:true}).click();
assert.equal(await page.evaluate(()=>document.querySelector('#print-container')),null);
await page.getByRole('button',{name:'Hand tool (drag to pan)',exact:true}).click();
let before=await page.locator('.document-tab-panel:not([hidden]) .viewer-container').evaluate(el=>el.scrollTop);
await page.mouse.move(850,650);await page.mouse.down();await page.mouse.move(850,350,{steps:8});await page.mouse.up();
let after=await page.locator('.document-tab-panel:not([hidden]) .viewer-container').evaluate(el=>el.scrollTop);assert.ok(after>before+150,`pan ${before} -> ${after}`);
await page.reload();await open();assert.equal(await page.getByRole('button',{name:'Hand tool (drag to pan)',exact:true}).getAttribute('aria-pressed'),'true');
await page.getByRole('button',{name:'Sticky note (click a page)',exact:true}).click();
await page.locator('.document-tab-panel:not([hidden]) .page').first().click({position:{x:180,y:180}});
await page.getByRole('textbox',{name:'Comment text'}).fill('הערה בעברית\nשורה שנייה');
await page.getByRole('button',{name:'Save comment',exact:true}).click();
await page.locator('.comment-card').waitFor();await page.screenshot({path:'test-results/openpdf-comments-dark.png'});
const bytes=await page.evaluate(async()=>Array.from(await window.__openpdf.getBytes()));await writeFile('test-results/openpdf-saved.pdf',Buffer.from(bytes));
await page.getByRole('button',{name:'Save a copy (Ctrl+S)',exact:true}).click();
await page.reload();await open('test-results/openpdf-saved.pdf');
await page.getByRole('button',{name:'Comments',exact:true}).click();assert.match(await page.locator('.comment-card').innerText(),/הערה בעברית/);
await page.locator('.comment-card').click();await page.getByRole('textbox',{name:'Comment text'}).fill('Edited Hebrew\nשינוי');await page.getByRole('button',{name:'Save comment',exact:true}).click();
await page.getByRole('button',{name:'More actions',exact:true}).click();await page.getByRole('radio',{name:'Light',exact:true}).click();await page.getByRole('button',{name:'More actions',exact:true}).click();await page.screenshot({path:'test-results/openpdf-comments-light.png'});
await page.locator('.comment-card').click();await page.getByRole('button',{name:'Delete selected',exact:true}).click();assert.equal(await page.locator('.comment-card').count(),0);

// Test actual PDF.js render at selected pages only, while stubbing only the OS print UI.
await page.evaluate(()=> {window.__printed=0;window.print=()=>{window.__printed++;};});
await page.getByRole('button',{name:'Print (Ctrl+P)',exact:true}).click();await page.getByLabel('Pages',{exact:true}).selectOption('range');await page.getByRole('textbox',{name:'Page range',exact:true}).fill('2, 5');
await page.getByRole('button',{name:'Prepare selected pages',exact:true}).click();await page.waitForFunction(()=>window.__printed===1);
assert.equal(await page.locator('#print-container .print-page').count(),2);
const dimensions=await page.locator('#print-container img').evaluateAll(items=>items.map(el=>[el.naturalWidth,el.naturalHeight]));
await page.emulateMedia({media:'print'});await page.pdf({path:'test-results/openpdf-printed.pdf',preferCSSPageSize:true,printBackground:true});await page.emulateMedia({media:'screen'});
await page.evaluate(()=>window.dispatchEvent(new Event('afterprint')));assert.equal(await page.locator('#print-container').count(),0);
await page.getByRole('button',{name:'More actions',exact:true}).click();await page.getByRole('menuitem',{name:'עברית',exact:true}).click();
await page.getByRole('button',{name:'הדפסה (Ctrl+P)',exact:true}).click();await page.screenshot({path:'test-results/openpdf-print-hebrew.png'});await page.getByRole('button',{name:'ביטול',exact:true}).click();
await page.getByRole('button',{name:'פתקית (לחצו על עמוד)',exact:true}).click();await page.locator('.document-tab-panel:not([hidden]) .page').first().click({position:{x:200,y:190}});
await page.getByRole('textbox',{name:'תוכן התגובה'}).fill('תגובה בעברית\nשורה נוספת');await page.screenshot({path:'test-results/openpdf-note-hebrew.png'});await page.getByRole('button',{name:'שמירת תגובה',exact:true}).click();await page.screenshot({path:'test-results/openpdf-sidebar-hebrew.png'});
await page.getByRole('button',{name:'שמירת עותק (Ctrl+S)',exact:true}).click();
await page.getByRole('button',{name:'פעולות נוספות',exact:true}).click();await page.getByRole('menuitem',{name:'English',exact:true}).click();
// Browser memory observations, not Windows process memory or a leak claim.
const memory=[];
for(let tabs=1;tabs<=10;tabs++){
 if(tabs>1){await page.getByRole('button',{name:'New tab (Ctrl+T)',exact:true}).click();await open();}
 if([1,5,10,20].includes(tabs)){
  const cdp=await page.context().newCDPSession(page);
  const heap=await cdp.send('Runtime.getHeapUsage');
  memory.push({tabs,workers:page.workers().length,canvases:await page.locator('canvas').count(),canvasPixels:await page.locator('canvas').evaluateAll(c=>c.reduce((s,v)=>s+v.width*v.height,0)),heapUsed:heap.usedSize});await writeFile('test-results/openpdf-memory.json',JSON.stringify(memory,null,2));await cdp.detach();
 }
}
await writeFile('test-results/openpdf-browser-results.json',JSON.stringify({errors,dimensions,memory},null,2));
console.log(JSON.stringify({errors,dimensions,memory},null,2));assert.deepEqual(errors,[]);
} finally { await browser.close(); }
