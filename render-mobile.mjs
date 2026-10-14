// Render the preview at a phone viewport (390px) and report horizontal overflow per view.
import pw from '/home/nah/Claudia/civic-chain-test-suite/node_modules/playwright/index.js';
const { chromium } = pw;
import { mkdirSync } from 'node:fs';

const file = 'file://' + process.cwd() + '/site-preview/index.html';
mkdirSync('shots-mobile', { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
await page.goto(file, { waitUntil: 'networkidle' });
await page.waitForTimeout(400);

async function overflow() {
  return await page.evaluate(() => {
    const de = document.documentElement;
    const over = de.scrollWidth - de.clientWidth;
    // find elements wider than viewport
    const bad = [];
    document.querySelectorAll('#viewport *').forEach(el => {
      if (el.scrollWidth > de.clientWidth + 1) {
        bad.push(el.className || el.tagName);
      }
    });
    return { over, bad: [...new Set(bad)].slice(0, 8) };
  });
}
async function shot(name) {
  await page.waitForTimeout(250);
  const o = await overflow();
  await page.screenshot({ path: `shots-mobile/${name}.png`, fullPage: true });
  console.log(name.padEnd(18), 'overflowPx=' + o.over, o.bad.length ? 'WIDE:' + o.bad.join(',') : '');
}
async function toSec(i) {
  await page.click('#bar-toc');
  await page.waitForSelector('.toc-list');
  await page.click(`.toc[data-sec="${i}"]`);
  await page.waitForSelector('.section');
}

await shot('0-cover');
await page.click('#bar-toc'); await page.waitForSelector('.toc-list'); await shot('1-contents');
const nSec = await page.$$eval('.toc', els => els.length);
for (let i = 0; i < nSec; i++) { await toSec(i); await shot(`sec-${String(i + 1).padStart(2, '0')}`); }

console.log('sections:', nSec);
console.log('page errors:', errors.length ? errors : 'none');
await browser.close();
console.log('done');
