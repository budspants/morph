// Runs sizetest.html in Playwright WebKit (Safari engine) on this Mac with big test files.
// Usage: node scripts/run-sizetest.mjs http://localhost:5173/sizetest.html ~/Movies/morph-sizetest/*.mp4
// Mac WebKit has far more memory than an iPhone: this catches bugs (e.g. seeking past 2 GB),
// not the phone's crash limit. Run the page on the iPhone itself for that.
import { webkit } from '@playwright/test'

const [url, ...files] = process.argv.slice(2)
const browser = await webkit.launch()
const page = await browser.newPage()
page.on('crash', () => console.log('PAGE CRASHED'))
await page.goto(url)
await page.click('#clear')
await page.setInputFiles('#pick', files)
await page.waitForFunction(() => document.getElementById('status')?.textContent === 'Done.', null, { timeout: 0, polling: 2000 })
const rows = await page.$$eval('#rows tr', (trs) => trs.map((tr) => [...tr.children].map((td) => td.textContent?.replace(/\s+/g, ' ').trim()).join(' | ')))
console.log(rows.join('\n'))
await browser.close()
