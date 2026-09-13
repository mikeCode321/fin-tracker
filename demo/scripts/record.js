// demo/scripts/record.js
// ─────────────────────────────────────────────────────────────────────────────
// FirePhin demo recorder — desktop 1440×900
// ─────────────────────────────────────────────────────────────────────────────

import { chromium }      from 'playwright';
import { scenario }      from '../scenarios/student.js';
import path              from 'path';
import fs                from 'fs';
import { fileURLToPath } from 'url';

const __dirname  = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = path.join(__dirname, '..', 'output');
fs.mkdirSync(OUTPUT_DIR, { recursive: true });

// ── Device ────────────────────────────────────────────────────────────────────
const DEVICE = {
  width:             1440,
  height:             900,
  deviceScaleFactor:    2,
};

// ── Timing ────────────────────────────────────────────────────────────────────
const T = {
  pageLoad:   2200,
  afterNav:    800,
  afterFill:   340,
  typeDelay:    50,
  moveSteps:    28,
  moveDelay:    10,
  zoomIn:      560,
  zoomOut:     460,
};

// Fast-fill timing — used for expense rows 3–5 + new additions
const FAST = {
  afterFill:   100,
  typeDelay:     8,
};

// ── Helpers ───────────────────────────────────────────────────────────────────

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function moveTo(page, x1, y1) {
  const cur = await page.evaluate(() => window.__pw_pos || { x: 720, y: 450 });
  const dx = (x1 - cur.x) / T.moveSteps;
  const dy = (y1 - cur.y) / T.moveSteps;
  for (let i = 1; i <= T.moveSteps; i++) {
    const nx = cur.x + dx * i;
    const ny = cur.y + dy * i;
    await page.mouse.move(nx, ny);
    await page.evaluate(({ x, y }) => {
      window.__pw_pos = { x, y };
      const el = document.getElementById('pw-cursor');
      if (el) { el.style.left = x + 'px'; el.style.top = y + 'px'; }
    }, { x: nx, y: ny });
    await sleep(T.moveDelay);
  }
}

async function clickAt(page, x, y) {
  await moveTo(page, x, y);
  await sleep(110);
  await page.evaluate(({ x, y }) => {
    const r = document.createElement('div');
    r.style.cssText = `
      position:fixed;left:${x - 18}px;top:${y - 18}px;
      width:36px;height:36px;border-radius:50%;
      background:rgba(255,255,255,.32);pointer-events:none;
      z-index:2147483647;animation:pw-ripple .42s ease-out forwards;
    `;
    document.body.appendChild(r);
    setTimeout(() => r.remove(), 480);
  }, { x, y });
  await page.mouse.click(x, y);
  await sleep(80);
}

// ── Desktop sidebar nav ───────────────────────────────────────────────────────

async function goToTab(page, label) {
  const sidebarSel  = `nav.ft-sidebar .ft-nav-item:has-text("${label}")`;
  const fallbackSel = `.ft-nav-item:has-text("${label}")`;
  let loc = page.locator(sidebarSel).first();
  if (!await loc.count().catch(() => 0)) loc = page.locator(fallbackSel).first();
  await loc.waitFor({ state: 'visible', timeout: 8_000 });
  const box = await loc.boundingBox();
  await clickAt(page, box.x + box.width / 2, box.y + box.height / 2);
  await sleep(T.afterNav);
}

// ── Zoom ──────────────────────────────────────────────────────────────────────

async function zoomTo(page, cx, cy, scale = 1.35) {
  await page.evaluate(({ cx, cy, scale }) => {
    document.body.style.transition      = 'transform .5s cubic-bezier(.25,.46,.45,.94)';
    document.body.style.transformOrigin = `${cx}px ${cy}px`;
    document.body.style.transform       = `scale(${scale})`;
  }, { cx, cy, scale });
  await sleep(T.zoomIn);
}

async function zoomReset(page) {
  await page.evaluate(() => {
    document.body.style.transition = 'transform .4s cubic-bezier(.25,.46,.45,.94)';
    document.body.style.transform  = 'scale(1)';
  });
  await sleep(T.zoomOut);
}

// ── Cursor injection ──────────────────────────────────────────────────────────

async function injectCursor(page) {
  await page.addStyleTag({ content: '*, *::before, *::after { cursor: none !important; }' });
  await page.evaluate(() => {
    const dot = document.createElement('div');
    dot.id = 'pw-cursor';
    dot.style.cssText = `
      position:fixed;width:20px;height:20px;border-radius:50%;
      background:rgba(255,255,255,.90);border:2px solid rgba(45,107,90,.9);
      box-shadow:0 2px 10px rgba(0,0,0,.28);pointer-events:none;
      z-index:2147483647;transform:translate(-50%,-50%);
      transition:transform .08s ease;left:50%;top:50%;
    `;
    document.body.appendChild(dot);
    document.addEventListener('mousedown', () =>
      dot.style.transform = 'translate(-50%,-50%) scale(.60)');
    document.addEventListener('mouseup', () =>
      dot.style.transform = 'translate(-50%,-50%) scale(1)');
    const s = document.createElement('style');
    s.textContent = '@keyframes pw-ripple{0%{transform:scale(.5);opacity:1}100%{transform:scale(2.4);opacity:0}}';
    document.head.appendChild(s);
    window.__pw_pos = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
  });
}

// ── NumInput fill ─────────────────────────────────────────────────────────────

async function fillByLabel(page, labelText, value, { zoom = false } = {}) {
  const sel = `.num-field:has(.field-label:text-is("${labelText}")) input.num-field-input`;
  const loc = page.locator(sel).first();
  try { await loc.waitFor({ state: 'visible', timeout: 8_000 }); }
  catch { console.warn(`    ⚠ label not found: "${labelText}" — skipping`); return; }
  const box = await loc.boundingBox();
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  if (zoom) await zoomTo(page, cx, cy, 1.35);
  await moveTo(page, cx, cy);
  await sleep(140);
  await page.mouse.click(cx, cy, { clickCount: 3 });
  await sleep(90);
  await page.keyboard.type(String(value), { delay: T.typeDelay });
  await page.evaluate(() => document.activeElement?.blur());
  if (zoom) { await sleep(440); await zoomReset(page); }
  await sleep(T.afterFill);
}

async function fillInCard(page, cardTitle, labelText, value, { zoom = false } = {}) {
  const sel = `.card:has(.card-title:text-is("${cardTitle}")) .num-field:has(.field-label:text-is("${labelText}")) input.num-field-input`;
  const loc = page.locator(sel).first();
  try { await loc.waitFor({ state: 'visible', timeout: 8_000 }); }
  catch {
    const loc2 = page.locator(`.card:has(.card-title:text("${cardTitle}")) input.num-field-input`).first();
    try { await loc2.waitFor({ state: 'visible', timeout: 5_000 }); }
    catch { console.warn(`    ⚠ card "${cardTitle}" / "${labelText}" not found`); return; }
  }
  const box = await loc.boundingBox();
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  if (zoom) await zoomTo(page, cx, cy, 1.35);
  await moveTo(page, cx, cy);
  await sleep(140);
  await page.mouse.click(cx, cy, { clickCount: 3 });
  await sleep(90);
  await page.keyboard.type(String(value), { delay: T.typeDelay });
  await page.evaluate(() => document.activeElement?.blur());
  if (zoom) { await sleep(440); await zoomReset(page); }
  await sleep(T.afterFill);
}

async function scrollToSel(page, selector) {
  const loc = page.locator(selector).first();
  await loc.waitFor({ state: 'visible', timeout: 8_000 });
  await loc.scrollIntoViewIfNeeded();
  await sleep(350);
}

// ── Expense helpers ───────────────────────────────────────────────────────────

/**
 * Update an existing expense row in-place by DOM index.
 * Pass `fast: true` for the 3-up rows to halve timing.
 * Name and category are optional — only amount is required.
 */
async function updateExpenseRow(page, index, { name, category, amount } = {}, fast = false) {
  const delay  = fast ? FAST.typeDelay  : T.typeDelay;
  const settle = fast ? FAST.afterFill  : T.afterFill;

  if (name !== undefined) {
    const input = page.locator('input.expense-input').nth(index);
    await input.waitFor({ state: 'visible', timeout: 5_000 });
    const box = await input.boundingBox();
    const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
    if (!fast) await moveTo(page, cx, cy);
    await page.mouse.click(cx, cy, { clickCount: 3 });
    await sleep(60);
    await page.keyboard.type(name, { delay });
    await sleep(settle / 2);
  }

  if (category !== undefined) {
    const sel = page.locator('select.expense-select').nth(index);
    await sel.selectOption(category);
    await sleep(fast ? 60 : 180);
  }

  if (amount !== undefined) {
    const input = page.locator('input.expense-amount-input').nth(index);
    const box = await input.boundingBox();
    const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
    if (!fast) await moveTo(page, cx, cy);
    await page.mouse.click(cx, cy, { clickCount: 3 });
    await sleep(60);
    await page.keyboard.type(String(amount), { delay });
    await page.keyboard.press('Tab');
    await sleep(settle);
  }
}

/**
 * Add a new expense row at the bottom. Always fast — called after the
 * user has already seen the first two rows filled at normal speed.
 */
async function addExpense(page, name, category, amount) {
  const addBtn = page.locator('button.expense-add-btn').first();
  await addBtn.scrollIntoViewIfNeeded();
  const btnBox = await addBtn.boundingBox();
  await clickAt(page, btnBox.x + btnBox.width / 2, btnBox.y + btnBox.height / 2);
  await sleep(180);

  const rowCount = await page.locator('input.expense-input').count();
  const idx = rowCount - 1;

  const nameInput = page.locator('input.expense-input').nth(idx);
  await nameInput.waitFor({ state: 'visible', timeout: 5_000 });
  const nameBox = await nameInput.boundingBox();
  await page.mouse.click(nameBox.x + nameBox.width / 2, nameBox.y + nameBox.height / 2, { clickCount: 3 });
  await page.keyboard.type(name, { delay: FAST.typeDelay });
  await sleep(60);

  await page.locator('select.expense-select').nth(idx).selectOption(category);
  await sleep(60);

  const amtInput = page.locator('input.expense-amount-input').nth(idx);
  const amtBox   = await amtInput.boundingBox();
  await page.mouse.click(amtBox.x + amtBox.width / 2, amtBox.y + amtBox.height / 2, { clickCount: 3 });
  await page.keyboard.type(String(amount), { delay: FAST.typeDelay });
  await page.keyboard.press('Tab');
  await sleep(FAST.afterFill);
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function run() {
  console.log('🎬  FirePhin demo recorder');
  console.log(`🖥️   Desktop — ${DEVICE.width}×${DEVICE.height} @${DEVICE.deviceScaleFactor}×`);
  console.log(`📁  ${OUTPUT_DIR}\n`);

  const browser = await chromium.launch({
    headless: false,
    args: ['--disable-blink-features=AutomationControlled'],
  });
  const context = await browser.newContext({
    viewport:          { width: DEVICE.width, height: DEVICE.height },
    deviceScaleFactor: DEVICE.deviceScaleFactor,
    colorScheme:       'dark',
    recordVideo: { dir: OUTPUT_DIR, size: { width: DEVICE.width, height: DEVICE.height } },
  });
  const page = await context.newPage();

  // ── 1. Load ──────────────────────────────────────────────────────────────
  console.log('  [1/10] Loading firephin.com …');
  await page.goto(scenario.url, { waitUntil: 'networkidle' });
  await sleep(T.pageLoad);
  await injectCursor(page);
  await sleep(600);

  // ── 2. Income tab ────────────────────────────────────────────────────────
  console.log('  [2/10] Income tab …');
  await goToTab(page, 'Income');
  const p = scenario.profile;
  await fillByLabel(page, 'Actual monthly take-home', p.monthlyTakeHome, { zoom: true });
  await fillByLabel(page, 'Gross annual salary',      p.annualIncome,    { zoom: true });
  await fillByLabel(page, 'Current age',              p.age,             { zoom: true });

  // ── 3. Expenses tab ──────────────────────────────────────────────────────
  console.log('  [3/10] Expenses tab — updating defaults + adding 2 new rows …');
  await goToTab(page, 'Expenses');
  await sleep(400);

  const { update: toUpdate, add: toAdd } = scenario.expenses;

  // First 2 updates: normal speed with cursor movement so it reads clearly on screen
  for (let i = 0; i < Math.min(2, toUpdate.length); i++) {
    const row = toUpdate[i];
    console.log(`         ✎ row ${row.index} → ${row.name ?? '(same name)'} $${row.amount}`);
    await updateExpenseRow(page, row.index, row, false);
  }

  // Remaining updates: fast (no zoom, minimal delays)
  for (let i = 2; i < toUpdate.length; i++) {
    const row = toUpdate[i];
    console.log(`         ✎ row ${row.index} (fast) → $${row.amount}`);
    await updateExpenseRow(page, row.index, row, true);
  }

  // New rows: also fast
  for (const exp of toAdd) {
    console.log(`         + ${exp.name} (${exp.category}) $${exp.amount} (fast)`);
    await addExpense(page, exp.name, exp.category, exp.amount);
  }

  // Brief pause so the expense summary is visible before moving on
  await sleep(700);

  // ── 4. Investments tab — Simulation 1 (baseline: $50 brokerage) ──────────
  console.log('  [4/10] Investments tab — Sim 1 baseline contributions …');
  await goToTab(page, 'Investments');
  await fillInCard(page, 'Roth IRA', 'Monthly contribution', scenario.accounts.rothIRA, { zoom: true });
  await scrollToSel(page, '.card:has(.card-title:text("Taxable Brokerage"))');
  await fillInCard(page, 'Taxable Brokerage', 'Monthly contribution', scenario.comparisonDemo.before, { zoom: true });

  // ── 5. Clone → Simulation 2 ──────────────────────────────────────────────
  // Clicking "+ New simulation" in the sidebar clones the active sim.
  // We then update only the brokerage contribution on the clone.
  console.log('  [5/10] Creating Simulation 2 (clone of Sim 1) …');
  const addSimBtn = page.locator('button.ft-sim-add').first();
  await addSimBtn.waitFor({ state: 'visible', timeout: 8_000 });
  const addSimBox = await addSimBtn.boundingBox();
  await clickAt(page, addSimBox.x + addSimBox.width / 2, addSimBox.y + addSimBox.height / 2);
  await sleep(600); // let the new sim become active and re-render

  // ── 6. Investments tab — Simulation 2 (bump brokerage to $150) ───────────
  console.log(`  [6/10] Investments — Sim 2 brokerage $${scenario.comparisonDemo.before} → $${scenario.comparisonDemo.after} …`);
  await goToTab(page, 'Investments');
  await scrollToSel(page, '.card:has(.card-title:text("Taxable Brokerage"))');
  await fillInCard(page, 'Taxable Brokerage', 'Monthly contribution', scenario.comparisonDemo.after, { zoom: true });

  // ── 7. Outlook tab ───────────────────────────────────────────────────────
  console.log('  [7/10] Outlook tab …');
  await goToTab(page, 'Outlook');
  await sleep(500);
  await zoomTo(page, DEVICE.width / 2, 400, 1.25);
  await sleep(2400);
  await zoomReset(page);
  await sleep(500);

  // ── 8. Compare tab — both simulations ────────────────────────────────────
  console.log('  [8/10] Compare tab — Sim 1 vs Sim 2 …');
  await goToTab(page, 'Compare');
  await sleep(600);
  await zoomTo(page, DEVICE.width / 2, 440, 1.25);
  await sleep(3600);
  await zoomReset(page);
  await sleep(800);

  // ── 9. Final hold ─────────────────────────────────────────────────────────
  console.log('  [9/10] Final hold …');
  await sleep(2500);

  // ── Done ─────────────────────────────────────────────────────────────────
  console.log('  [10/10] Closing …');
  await context.close();
  await browser.close();

  const files = fs.readdirSync(OUTPUT_DIR)
    .filter(f => f.endsWith('.webm'))
    .map(f => ({ f, t: fs.statSync(path.join(OUTPUT_DIR, f)).mtimeMs }))
    .sort((a, b) => b.t - a.t);
  const webm = files[0]?.f;
  const mp4  = `${scenario.name}.mp4`;

  console.log('\n✅  Recording complete!');
  if (webm) {
    console.log(`\n📹  Raw webm: demo/output/${webm}`);
    console.log('\n── Convert to MP4 ───────────────────────────────────────────');
    console.log(`ffmpeg -i "demo/output/${webm}" \\`);
    console.log(`  -c:v libx264 -preset slow -crf 18 -pix_fmt yuv420p "demo/output/${mp4}"`);
    console.log('\n── Scale to 1920×1080 for YouTube ───────────────────────────');
    console.log(`ffmpeg -i "demo/output/${mp4}" \\`);
    console.log(`  -vf "scale=1920:1080:flags=lanczos" \\`);
    console.log(`  -c:v libx264 -crf 20 -preset slow -pix_fmt yuv420p "demo/output/${scenario.name}-1080p.mp4"`);
    console.log('\n── Compress for upload (<50 MB) ─────────────────────────────');
    console.log(`ffmpeg -i "demo/output/${mp4}" -c:v libx264 -crf 26 -preset veryslow "demo/output/${scenario.name}-compressed.mp4"`);
  }
}

run().catch(err => {
  console.error('❌  Error:', err);
  process.exit(1);
});