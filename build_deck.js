// Builds VentureCouncil.pptx. Animations are added afterwards by animate_deck.ps1, which reads
// each shape's objectName: "aNN_effect_label" = play at step NN with that effect.
const pptxgen = require('pptxgenjs');
const pres = new pptxgen();
pres.layout = 'LAYOUT_16x9'; // 10 x 5.625
pres.title = 'VentureCouncil';
pres.author = 'Niharika Singh, Shubham Singh, Rohit Swami, Akash Warde';

const BG = '0B0F0D', CARD = '151B18', EDGE = '26332D', TXT = 'FFFFFF', MUTED = 'A3ADA8', GREEN = '34D399', AMBER = 'FBBF24', RED = 'F87171';
const HF = 'Arial', BF = 'Calibri';
const A = (step, eff, label) => `a${String(step).padStart(2, '0')}_${eff}_${label}`;
const T = (s, text, o) => s.addText(text, Object.assign({ fontFace: BF, color: TXT, margin: 0, isTextBox: true }, o));

function glow(s, x, y, d, t = 92) {
  s.addShape(pres.shapes.OVAL, { x, y, w: d, h: d, fill: { color: GREEN, transparency: t }, line: { color: GREEN, transparency: 100, width: 0 }, objectName: 'Glow' });
}
function base(title, kicker, notes) {
  const s = pres.addSlide();
  s.background = { color: BG };
  glow(s, 7.2, -1.6, 4.2, 94);
  T(s, kicker, { x: 0.5, y: 0.3, w: 9, h: 0.25, fontSize: 11, bold: true, color: GREEN, charSpacing: 3, objectName: A(0, 'fade', 'kicker') });
  T(s, title, { x: 0.5, y: 0.55, w: 9, h: 0.6, fontFace: HF, fontSize: 28, bold: true, objectName: A(0, 'fade', 'title') });
  s.addNotes(notes);
  return s;
}
const card = (s, x, y, w, h, name, line = EDGE) => s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x, y, w, h, rectRadius: 0.08, fill: { color: CARD }, line: { color: line, width: 1 }, objectName: name });
const pill = (s, x, y, w, h, label, color, name, size = 13) => {
  s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x, y, w, h, rectRadius: h / 2, fill: { color }, line: { color, width: 0.5 }, objectName: name });
  T(s, label, { x, y, w, h, fontFace: HF, fontSize: size, bold: true, color: BG, align: 'center', valign: 'middle', objectName: name });
};
function line(s, x1, y1, x2, y2, name, arrow = true, color = GREEN) {
  const o = { x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.abs(x2 - x1), h: Math.abs(y2 - y1), line: { color, width: 1.5, endArrowType: arrow ? 'triangle' : undefined }, objectName: name };
  if ((y2 < y1) !== (x2 < x1)) o.flipV = true; // "/" instead of "\"; arrows here always point right
  s.addShape(pres.shapes.LINE, o);
}

// ---------- 1. Title: council motif
{
  const s = pres.addSlide();
  s.background = { color: BG };
  glow(s, 5.0, 0.1, 4.8, 90);
  T(s, 'AI & DATA SCIENCE MINI-PROJECT', { x: 0.5, y: 0.55, w: 5, h: 0.25, fontSize: 11, bold: true, color: GREEN, charSpacing: 3, objectName: A(1, 'fade', 'kicker') });
  T(s, 'VENTURE\nCOUNCIL', { x: 0.5, y: 0.9, w: 4.5, h: 1.6, fontFace: HF, fontSize: 48, bold: true, objectName: A(1, 'fade', 'title') });
  T(s, 'Five AI agents debate every creator-brand deal. Fixed rules make the final call.', { x: 0.5, y: 2.6, w: 4.3, h: 0.7, fontSize: 15, color: MUTED, objectName: A(2, 'fade', 'tagline') });
  [['5', 'AI agents'], ['649', 'creators'], ['179', 'tests']].forEach(([n, l], i) => {
    const x = 0.5 + i * 1.45, nm = A(3 + i, 'up', 'stat' + i);
    card(s, x, 3.5, 1.32, 0.9, nm);
    T(s, n, { x, y: 3.55, w: 1.32, h: 0.48, fontFace: HF, fontSize: 22, bold: true, color: GREEN, align: 'center', valign: 'middle', objectName: nm });
    T(s, l, { x, y: 4.02, w: 1.32, h: 0.28, fontSize: 11, color: MUTED, align: 'center', objectName: nm });
  });
  T(s, 'Niharika Singh · Shubham Singh · Rohit Swami · Akash Warde   |   Guide: Prof. Megha Jain', { x: 0.5, y: 4.85, w: 9, h: 0.3, fontSize: 11, color: MUTED, objectName: A(12, 'fade', 'team') });

  const cx = 7.4, cy = 2.55, r = 1.6, names = ['Audience\nFit', 'Engage-\nment', 'Pricing', 'Risk', 'Negoti-\nation'];
  const pts = names.map((_, i) => { const a = (-90 + i * 72) * Math.PI / 180; return [cx + r * Math.cos(a), cy + r * Math.sin(a)]; });
  pts.forEach(([x, y], i) => line(s, cx, cy, x, y, A(6 + i, 'fade', 'spoke' + i), false, '2F5D4B'));
  pts.forEach(([x, y], i) => {
    const nm = A(6 + i, 'zoom', 'agent' + i);
    s.addShape(pres.shapes.OVAL, { x: x - 0.5, y: y - 0.5, w: 1.0, h: 1.0, fill: { color: CARD }, line: { color: GREEN, width: 1.5 }, objectName: nm });
    T(s, names[i], { x: x - 0.5, y: y - 0.5, w: 1.0, h: 1.0, fontSize: 10, bold: true, align: 'center', valign: 'middle', objectName: nm });
  });
  const c = A(11, 'zoom', 'core');
  s.addShape(pres.shapes.OVAL, { x: cx - 0.62, y: cy - 0.62, w: 1.24, h: 1.24, fill: { color: GREEN }, line: { color: GREEN, width: 1 }, objectName: c });
  T(s, 'VERDICT', { x: cx - 0.62, y: cy - 0.62, w: 1.24, h: 1.24, fontFace: HF, fontSize: 12, bold: true, color: BG, align: 'center', valign: 'middle', objectName: c });
  s.addNotes('VentureCouncil evaluates creator-brand sponsorship deals for Nitrix Talent Media. Five specialised AI agents each judge one side of the deal, and a supervisor combines them into Accept, Negotiate or Reject. The key idea: the final decision is made by fixed rules, not by the AI.');
}

// ---------- 2. Problem -> solution
{
  const s = base('FROM GUT FEEL TO A COUNCIL', 'THE PROBLEM', 'Today brands pick creators by gut feel, creator prices are opaque, and risky contract clauses slip through unnoticed. VentureCouncil replaces that with a council of agents that gives a verdict, a score and a plain-English reason, and can also find creators that fit a budget.');
  const probs = [['Gut-feel picks', 'No consistent way to judge audience fit'], ['Opaque prices', 'Is ₹35,000 fair for this creator?'], ['Risky contracts', 'Perpetual rights and exclusivity slip through']];
  probs.forEach(([t, d], i) => {
    const y = 1.35 + i * 1.08, nm = A(1 + i, 'flyL', 'prob' + i);
    card(s, 0.5, y, 3.9, 0.9, nm);
    s.addShape(pres.shapes.OVAL, { x: 0.7, y: y + 0.25, w: 0.4, h: 0.4, fill: { color: RED }, line: { color: RED, width: 0.5 }, objectName: nm });
    T(s, '✕', { x: 0.7, y: y + 0.25, w: 0.4, h: 0.4, fontSize: 13, bold: true, color: BG, align: 'center', valign: 'middle', objectName: nm });
    T(s, t, { x: 1.3, y: y + 0.12, w: 3.0, h: 0.35, fontSize: 15, bold: true, objectName: nm });
    T(s, d, { x: 1.3, y: y + 0.47, w: 3.0, h: 0.3, fontSize: 12, color: MUTED, objectName: nm });
  });
  s.addShape(pres.shapes.RIGHT_ARROW, { x: 4.62, y: 2.45, w: 0.8, h: 0.6, fill: { color: GREEN }, line: { color: GREEN, width: 0.5 }, objectName: A(4, 'wipeL', 'arrow') });
  const sol = A(5, 'zoom', 'solution');
  card(s, 5.65, 1.35, 3.85, 3.06, sol, GREEN);
  T(s, 'THE COUNCIL', { x: 5.9, y: 1.55, w: 3.4, h: 0.4, fontFace: HF, fontSize: 18, bold: true, color: GREEN, objectName: sol });
  T(s, '5 specialised AI agents judge every deal. Fixed rules, not the AI, make the final call.', { x: 5.9, y: 1.98, w: 3.4, h: 0.65, fontSize: 13, objectName: sol });
  ['Accept / Negotiate / Reject + score', 'A plain-English "why"', 'Find creators inside a budget'].forEach((t, i) => {
    const y = 2.8 + i * 0.45, nm = A(6 + i, 'fade', 'check' + i);
    s.addShape(pres.shapes.OVAL, { x: 5.9, y: y + 0.06, w: 0.28, h: 0.28, fill: { color: GREEN }, line: { color: GREEN, width: 0.5 }, objectName: nm });
    T(s, '✓', { x: 5.9, y: y + 0.06, w: 0.28, h: 0.28, fontSize: 11, bold: true, color: BG, align: 'center', valign: 'middle', objectName: nm });
    T(s, t, { x: 6.3, y, w: 3.1, h: 0.4, fontSize: 13, valign: 'middle', objectName: nm });
  });
}

// ---------- 3. Pipeline diagram (drawn, not a screenshot)
{
  const s = base('HOW THE COUNCIL DECIDES', 'THE PIPELINE', 'A deal comes in. Four agents run in parallel: audience fit, engagement ranked against same-platform peers, pricing against similar past deals found by vector search, and risk including contract clauses. A gate waits for all four, then Negotiation runs, then the Supervisor takes a weighted score. 50 or above is Accept, 45 to 50 Negotiate, below 45 Reject, and a high-risk label blocks Accept.');
  const midY = 2.85;
  const i0 = A(1, 'zoom', 'intake');
  card(s, 0.5, midY - 0.4, 1.3, 0.8, i0, GREEN);
  T(s, [{ text: 'DEAL', options: { bold: true, breakLine: true } }, { text: 'creator + offer', options: { fontSize: 10, color: MUTED } }], { x: 0.5, y: midY - 0.4, w: 1.3, h: 0.8, fontSize: 13, align: 'center', valign: 'middle', objectName: i0 });
  const agents = ['Audience Fit', 'Engagement', 'Pricing', 'Risk'];
  const ays = [1.45, 2.38, 3.32, 4.25];
  ays.forEach((y, i) => line(s, 1.8, midY, 2.3, y, A(2, 'fade', 'fan' + i)));
  ays.forEach((y, i) => {
    const nm = A(3, 'zoom', 'agent' + i);
    card(s, 2.3, y - 0.3, 1.65, 0.6, nm);
    T(s, agents[i], { x: 2.3, y: y - 0.3, w: 1.65, h: 0.6, fontSize: 13, bold: true, align: 'center', valign: 'middle', objectName: nm });
  });
  T(s, 'in parallel', { x: 2.3, y: 4.62, w: 1.65, h: 0.25, fontSize: 10, color: GREEN, align: 'center', italic: true, objectName: A(3, 'fade', 'parallel') });
  ays.forEach((y, i) => line(s, 3.95, y, 4.4, midY, A(4, 'fade', 'fanin' + i), false));
  const g = A(4, 'zoom', 'gate');
  s.addShape(pres.shapes.OVAL, { x: 4.4, y: midY - 0.27, w: 0.54, h: 0.54, fill: { color: BG }, line: { color: GREEN, width: 1.5 }, objectName: g });
  T(s, 'GATE', { x: 4.25, y: midY + 0.32, w: 0.84, h: 0.25, fontSize: 9, color: MUTED, align: 'center', objectName: g });
  line(s, 4.94, midY, 5.3, midY, A(5, 'wipeL', 'l1'));
  const n = A(5, 'zoom', 'neg');
  card(s, 5.3, midY - 0.3, 1.45, 0.6, n);
  T(s, 'Negotiation', { x: 5.3, y: midY - 0.3, w: 1.45, h: 0.6, fontSize: 13, bold: true, align: 'center', valign: 'middle', objectName: n });
  line(s, 6.75, midY, 7.1, midY, A(6, 'wipeL', 'l2'));
  const sp = A(6, 'zoom', 'sup');
  s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: 7.1, y: midY - 0.4, w: 1.3, h: 0.8, rectRadius: 0.08, fill: { color: GREEN }, line: { color: GREEN, width: 1 }, objectName: sp });
  T(s, [{ text: 'Supervisor', options: { bold: true, breakLine: true } }, { text: 'weighted score', options: { fontSize: 10 } }], { x: 7.1, y: midY - 0.4, w: 1.3, h: 0.8, fontSize: 13, color: BG, align: 'center', valign: 'middle', objectName: sp });
  [['ACCEPT', '≥ 50', GREEN], ['NEGOTIATE', '45–50', AMBER], ['REJECT', '< 45', RED]].forEach(([l, r, c], i) => {
    const y = 2.05 + i * 0.58, nm = A(7 + i, 'flyR', 'band' + i);
    line(s, 8.4, midY, 8.62, y + 0.2, nm, false, c);
    pill(s, 8.62, y, 0.95, 0.4, l, c, nm, 9);
    T(s, r, { x: 8.62, y: y + 0.4, w: 0.95, h: 0.16, fontSize: 9, color: MUTED, align: 'center', objectName: nm });
  });
  const v = A(10, 'fade', 'veto');
  card(s, 5.3, 4.05, 4.2, 0.6, v, RED);
  T(s, [{ text: 'Veto  ', options: { bold: true, color: RED } }, { text: 'a "high risk" label makes Accept impossible.' }], { x: 5.45, y: 4.05, w: 4.0, h: 0.6, fontSize: 12, valign: 'middle', objectName: v });
}

// ---------- 4. Built and running (the one screenshot)
{
  const s = base('BUILT AND RUNNING', 'DATA AND STACK', 'The database is Supabase Postgres with pgvector: 649 creators, 18 brands and 52 past deals, each embedded locally with sentence-transformers. The screenshot is a real run: Bulky at Rs.35,000 for Volt Energy Drinks scored 72.8 and was accepted. The stack runs from a React frontend through FastAPI and LangGraph to the agents; the LLM layer is provider-agnostic.');
  [['649', 'creators'], ['18', 'brands'], ['52', 'past deals'], ['384', 'dim vectors']].forEach(([n, l], i) => {
    const x = 0.5 + (i % 2) * 2.1, y = 1.35 + Math.floor(i / 2) * 1.2, nm = A(1 + i, 'zoom', 'stat' + i);
    card(s, x, y, 1.95, 1.05, nm);
    T(s, n, { x, y: y + 0.1, w: 1.95, h: 0.55, fontFace: HF, fontSize: 28, bold: true, color: GREEN, align: 'center', valign: 'middle', objectName: nm });
    T(s, l, { x, y: y + 0.66, w: 1.95, h: 0.28, fontSize: 12, color: MUTED, align: 'center', objectName: nm });
  });
  const shot = A(5, 'fade', 'shot');
  s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: 4.86, y: 1.31, w: 4.68, h: 2.67, rectRadius: 0.06, fill: { color: EDGE }, line: { color: GREEN, width: 1 }, shadow: { type: 'outer', color: '000000', blur: 16, offset: 5, angle: 90, opacity: 0.6 }, objectName: shot });
  s.addImage({ path: 'screenshots/04-verdict.png', x: 4.9, y: 1.35, w: 4.6, h: 2.59, altText: 'Real verdict: ACCEPT, score 72.8', objectName: shot });
  pill(s, 7.6, 3.68, 1.75, 0.45, 'LIVE · 72.8', GREEN, A(6, 'zoom', 'badge'), 13);
  ['React 19', 'FastAPI', 'LangGraph', 'Groq LLM', 'pgvector'].forEach((t, i) => {
    const x = 0.5 + i * 1.84, nm = A(7 + i, 'fade', 'stack' + i);
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x, y: 4.45, w: 1.6, h: 0.5, rectRadius: 0.25, fill: { color: CARD }, line: { color: GREEN, width: 1 }, objectName: nm });
    T(s, t, { x, y: 4.45, w: 1.6, h: 0.5, fontSize: 12, bold: true, align: 'center', valign: 'middle', objectName: nm });
    if (i < 4) T(s, '→', { x: x + 1.6, y: 4.45, w: 0.24, h: 0.5, fontSize: 14, color: GREEN, align: 'center', valign: 'middle', objectName: nm });
  });
}

// ---------- 5. Safety
{
  const s = base('WHAT WE LEARNED THE HARD WAY', 'SAFETY AND KEY DECISIONS', 'Three decisions. First, the LLM called a terrible contract only medium risk, so a fixed-pattern scanner now forces high risk and Accept becomes Negotiate. Second, the explanation is written by the AI but the headline verdict is built in code, with a template fallback. Third, rewriting the brand query into the same template used to embed creators lifted similarity from 0.274 to 0.654.');
  const cards = [
    ['1', 'Contract veto', RED, 'Perpetual rights + 24 months unpaid exclusivity: the AI said "medium risk" and the deal was accepted.', 'Now a fixed rule forces "high risk".'],
    ['2', 'AI explains, never decides', GREEN, 'The verdict headline is built in code.', 'The AI only writes the "why", with a safe fallback.'],
    ['3', 'Better search', AMBER, 'Brand brief rewritten in the creator-embedding format.', 'Similarity 0.274 → 0.654.'],
  ];
  cards.forEach(([n, t, c, a, b], i) => {
    const x = 0.5 + i * 3.05, nm = A(1 + i, 'up', 'card' + i);
    card(s, x, 1.35, 2.9, 2.7, nm);
    s.addShape(pres.shapes.OVAL, { x: x + 0.2, y: 1.52, w: 0.48, h: 0.48, fill: { color: c }, line: { color: c, width: 0.5 }, objectName: nm });
    T(s, n, { x: x + 0.2, y: 1.52, w: 0.48, h: 0.48, fontFace: HF, fontSize: 16, bold: true, color: BG, align: 'center', valign: 'middle', objectName: nm });
    T(s, t, { x: x + 0.8, y: 1.47, w: 2.0, h: 0.58, fontFace: HF, fontSize: 14, bold: true, valign: 'middle', objectName: nm });
    T(s, [{ text: a, options: { breakLine: true } }, { text: b, options: { color: c, bold: true } }], { x: x + 0.2, y: 2.2, w: 2.5, h: 1.75, fontSize: 13, paraSpaceAfter: 8, valign: 'top', objectName: nm });
  });
  const bn = A(4, 'fade', 'banner');
  card(s, 0.5, 4.25, 9.0, 0.85, bn);
  T(s, 'Same deal, only the contract changed:', { x: 0.75, y: 4.25, w: 3.2, h: 0.85, fontSize: 14, bold: true, valign: 'middle', objectName: bn });
  pill(s, 4.1, 4.45, 1.7, 0.45, 'ACCEPT', GREEN, A(5, 'zoom', 'before'));
  T(s, '→', { x: 5.85, y: 4.25, w: 0.5, h: 0.85, fontSize: 22, color: MUTED, align: 'center', valign: 'middle', objectName: A(6, 'wipeL', 'arrow') });
  pill(s, 6.4, 4.45, 1.9, 0.45, 'NEGOTIATE', AMBER, A(7, 'zoom', 'after'));
}

// ---------- 6. Results + thanks
{
  const s = base('RESULTS', 'VALIDATION', 'We calibrated the thresholds on eleven labelled deals: the old 70 and 45 got 9 right, the new 50 and 45 get all 11 with no severe errors. The sample is small and we say so. Groq scores harsher than Gemini and was often more correct, so all reported numbers are from Groq. There are 179 automated tests that need no database or network. Thank you.');
  s.addChart(pres.charts.BAR, [{ name: 'Old 70 / 45', labels: ['Correct verdicts (of 11)'], values: [9] }, { name: 'New 50 / 45', labels: ['Correct verdicts (of 11)'], values: [11] }], {
    x: 0.5, y: 1.3, w: 4.3, h: 2.75, barDir: 'col', barGapWidthPct: 60, chartColors: ['4B5A53', GREEN],
    showValue: true, dataLabelPosition: 'outEnd', dataLabelColor: TXT, dataLabelFontSize: 14, dataLabelFontBold: true, dataLabelFontFace: BF,
    valAxisHidden: true, valAxisMaxVal: 12, valAxisMinVal: 0, valGridLine: { style: 'none' }, catGridLine: { style: 'none' },
    catAxisLabelColor: MUTED, catAxisLabelFontFace: BF, catAxisLabelFontSize: 12, catAxisLineShow: false,
    showLegend: true, legendPos: 'b', legendColor: MUTED, legendFontFace: BF, legendFontSize: 12,
    showTitle: true, title: 'Threshold calibration', titleColor: TXT, titleFontFace: BF, titleFontSize: 14,
    objectName: A(1, 'fade', 'chart'),
  });
  T(s, 'Groq vs Gemini, same deal', { x: 5.2, y: 1.3, w: 4.3, h: 0.3, fontSize: 13, bold: true, color: GREEN, objectName: A(2, 'fade', 'cmpTitle') });
  [['Bulky', 'Accept 79.9', GREEN, 'Negotiate 69.2', AMBER], ['Chirag', 'Negotiate 69.3', AMBER, 'Reject 40.2', RED]].forEach(([nme, g, gc, q, qc], i) => {
    const y = 1.7 + i * 0.72, nm = A(3 + i, 'flyR', 'cmp' + i);
    card(s, 5.2, y, 4.3, 0.6, nm);
    T(s, nme, { x: 5.35, y, w: 0.8, h: 0.6, fontSize: 13, bold: true, valign: 'middle', objectName: nm });
    pill(s, 6.15, y + 0.13, 1.4, 0.34, g, gc, nm, 10);
    T(s, '→', { x: 7.55, y, w: 0.4, h: 0.6, fontSize: 14, color: MUTED, align: 'center', valign: 'middle', objectName: nm });
    pill(s, 7.95, y + 0.13, 1.4, 0.34, q, qc, nm, 10);
  });
  T(s, 'Gemini  →  Groq (pinned)', { x: 6.15, y: 3.12, w: 3.2, h: 0.25, fontSize: 10, color: MUTED, align: 'center', objectName: A(4, 'fade', 'cmpLegend') });
  const tests = A(5, 'zoom', 'tests');
  card(s, 5.2, 3.5, 4.3, 0.6, tests);
  T(s, [{ text: '179 ', options: { fontFace: HF, fontSize: 20, bold: true, color: GREEN } }, { text: 'automated tests, no DB or network', options: { fontSize: 12, color: MUTED } }], { x: 5.35, y: 3.5, w: 4.1, h: 0.6, valign: 'middle', objectName: tests });
  T(s, [{ text: 'Next: ', options: { bold: true, color: GREEN } }, { text: 'real contract upload · more past deals · live creator metrics' }], { x: 0.5, y: 4.35, w: 5.5, h: 0.4, fontSize: 12, color: MUTED, objectName: A(6, 'fade', 'next') });
  T(s, 'Thank you · Questions?', { x: 0.5, y: 4.75, w: 9, h: 0.5, fontFace: HF, fontSize: 22, bold: true, objectName: A(7, 'up', 'thanks') });
}

pres.writeFile({ fileName: 'VentureCouncil.pptx' }).then(() => console.log('written'));
