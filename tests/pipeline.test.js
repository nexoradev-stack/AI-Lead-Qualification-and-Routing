const test = require('node:test');
const assert = require('node:assert');
const { FakeSpreadsheet, load, leadRow, HEADER } = require('./harness');

const PROPS = {
  SOURCE_SPREADSHEET_ID: 'src', SOURCE_TAB_NAME: 'Contact', RAW_TAB_NAME: 'Raw Website Leads',
  LAST_IMPORTED_ROW: '1', VERTEX_PROJECT_ID: 'example-project',
  SALESFORCE_FORM_HANDLER_URL: 'https://forms.example.com/l/EXAMPLE/handler',
  SLACK_EMAIL_ADDRESS: 'website-leads@team.example',
  SALES_EMAIL_RECIPIENTS: 'sales@example.com, marketing@example.com',
  PARTNER_EMAIL_RECIPIENTS: 'marketing@example.com'
};

function gemini(answer) {
  return () => ({
    getResponseCode: () => 200,
    getContentText: () => JSON.stringify({ candidates: [{ content: { parts: [{ text: '```json\n' + JSON.stringify(answer) + '\n```' }] } }] })
  });
}

function setup(rows, fetchImpl) {
  const active = new FakeSpreadsheet({ 'Raw Website Leads': [HEADER, ...rows], Logs: [] });
  const env = load(['apps-script/pipeline/Code.gs', 'apps-script/pipeline/Setup.gs'], {
    props: PROPS, active, fetch: fetchImpl || (() => ({ getResponseCode: () => 200, getContentText: () => '' }))
  });
  return { active, raw: active.sheets['Raw Website Leads'], ...env };
}

test('importNewLeads copies new rows once and skips duplicates', () => {
  const src = new FakeSpreadsheet({ Contact: [HEADER.slice(0, 14), leadRow().slice(0, 14), leadRow().slice(0, 14)] });
  const active = new FakeSpreadsheet({ 'Raw Website Leads': [HEADER] });
  const env = load(['apps-script/pipeline/Code.gs'], { props: PROPS, active, byId: { src } });
  env.ctx.importNewLeads();
  assert.equal(active.sheets['Raw Website Leads'].rows.length, 2);
  assert.equal(env.store.LAST_IMPORTED_ROW, '3');
});

test('checkDuplicates marks the second identical submission', () => {
  const { ctx, raw } = setup([leadRow(), leadRow()]);
  ctx.checkDuplicates();
  assert.equal(raw.rows[2][15], 'Duplicate');
  assert.equal(raw.rows[2][17], 'Ignore');
  assert.equal(raw.rows[1][15], '');
});

test('test emails and gibberish are marked Spam without calling Gemini', () => {
  const { ctx, raw, fetched } = setup([
    leadRow({ 3: 'test@example.com' }),
    leadRow({ 8: 'kjhsdfkjhsdfkjhsdf' })
  ]);
  ctx.processOneLeadWithGemini();
  assert.equal(fetched.length, 0);
  assert.equal(raw.rows[1][15], 'Spam');
  assert.equal(raw.rows[2][15], 'Spam');
  assert.equal(raw.rows[2][18], 'Gibberish content detected');
});

test('Gemini results get a fixed priority per category', () => {
  const cases = [['Sales', 'High'], ['Genuine Inquiry', 'Medium'], ['Support', 'Medium'],
    ['Partner', 'Low'], ['Review Required', 'Low'], ['Career', 'Ignore']];
  for (const [category, priority] of cases) {
    const { ctx, raw, fetched } = setup([leadRow()], gemini({ category, score: 50, priority: 'whatever', reason: 'r' }));
    ctx.processOneLeadWithGemini();
    assert.equal(raw.rows[1][15], category);
    assert.equal(raw.rows[1][17], priority, category);
    assert.equal(raw.rows[1][19], 'TRUE');
    assert.match(fetched[0].url, /us-central1-aiplatform\.googleapis\.com\/v1\/projects\/example-project\/.*gemini-2\.5-flash:generateContent$/);
    assert.equal(fetched[0].opts.headers.Authorization, 'Bearer test-token');
  }
});

test('a missing Vertex project setting stops with a clear error', () => {
  const { ctx, store } = setup([leadRow()]);
  delete store.VERTEX_PROJECT_ID;
  assert.throws(() => ctx.processOneLeadWithGemini(), /VERTEX_PROJECT_ID/);
});

test('routing: every category except Spam and Duplicate goes to Salesforce, Slack and email', () => {
  const routed = ['Sales', 'Partner', 'Genuine Inquiry', 'Support', 'Review Required', 'Career'];
  const rows = routed.map((cat, i) => leadRow({ 3: `lead${i}@example.com`, 15: cat, 16: 50, 17: 'Low', 18: 'r' }));
  rows.push(leadRow({ 3: 'spam@example.com', 15: 'Spam', 16: 0, 17: 'Ignore' }));
  rows.push(leadRow({ 3: 'dup@example.com', 15: 'Duplicate', 16: 0, 17: 'Ignore' }));
  rows.push(leadRow({ 3: 'new@example.com' }));          // not classified yet
  const { ctx, raw, sent, fetched } = setup(rows);
  ctx.sendGenuineLeads();

  assert.equal(fetched.length, routed.length);
  assert.ok(fetched.every(f => f.url === PROPS.SALESFORCE_FORM_HANDLER_URL));
  assert.equal(fetched[0].opts.payload.email, 'lead0@example.com');

  const slack = sent.filter(m => m.to === PROPS.SLACK_EMAIL_ADDRESS);
  const mail = sent.filter(m => m.htmlBody);
  assert.equal(slack.length, routed.length);
  assert.equal(mail.length, routed.length);
  routed.forEach((cat, i) => {
    assert.match(slack[i].subject, new RegExp('New General Enquiry ' + cat + ' Lead$'));
    assert.deepEqual(raw.rows[i + 1].slice(21, 24), ['TRUE', 'TRUE', 'TRUE'], cat);
  });
  for (let r = routed.length + 1; r < raw.rows.length; r++) {
    assert.deepEqual(raw.rows[r].slice(21, 24), ['', '', '']);
  }

  ctx.sendGenuineLeads();                       // second run sends nothing again
  assert.equal(sent.length, routed.length * 2);
  assert.equal(fetched.length, routed.length);
});

test('email recipients per category, with OTHER_EMAIL_RECIPIENTS optional', () => {
  const { ctx, sent, store } = setup([]);
  const to = cat => { ctx.sendLeadEmail(leadRow({ 15: cat }), cat); return sent[sent.length - 1]; };

  assert.equal(to('Sales').to, PROPS.SALES_EMAIL_RECIPIENTS);
  assert.equal(to('Sales').subject, 'New Sales Lead');
  assert.equal(to('Partner').to, PROPS.PARTNER_EMAIL_RECIPIENTS);
  assert.equal(to('Support').to, PROPS.PARTNER_EMAIL_RECIPIENTS);       // fallback
  store.OTHER_EMAIL_RECIPIENTS = 'support@example.com, hr@example.com';
  for (const cat of ['Genuine Inquiry', 'Support', 'Review Required', 'Career']) {
    assert.equal(to(cat).to, 'support@example.com, hr@example.com', cat);
  }
  assert.equal(to('Genuine Inquiry').subject, 'New General Inquiry');
  assert.equal(to('Review Required').subject, 'New Lead to Review');
  assert.equal(to('Career').subject, 'New Career / Job Application');
  assert.equal(sent[0].from, undefined);
});

test('the log counts routed leads as genuine and Spam / Duplicate as not', () => {
  const { ctx, active } = setup([
    leadRow({ 15: 'Sales' }), leadRow({ 15: 'Career' }), leadRow({ 15: 'Support' }),
    leadRow({ 15: 'Spam' }), leadRow({ 15: 'Duplicate' }), leadRow()
  ]);
  ctx.writeLog('ok', 'done');
  const row = active.sheets.Logs.rows[0];
  assert.equal(row[2], 3);
  assert.equal(row[3], 2);
});

test('MAIL_FROM is used only when set', () => {
  const { ctx, sent, store } = setup([leadRow({ 15: 'Partner', 17: 'Low' })]);
  store.MAIL_FROM = 'marketing@example.com';
  ctx.sendLeadEmail(leadRow({ 15: 'Partner' }), 'Partner');
  assert.equal(sent[0].from, 'marketing@example.com');
});

test('email HTML escapes lead input and shows the Scout card', () => {
  const { ctx } = setup([]);
  const html = ctx.buildLeadEmailHtml(leadRow({ 1: '<b>Alex</b>', 16: 95, 17: 'High', 18: 'Ready to buy' }), 'Sales');
  assert.ok(!html.includes('<b>Alex</b>'));
  assert.ok(html.includes('&lt;b&gt;Alex&lt;/b&gt;'));
  assert.ok(html.includes('cid:scoutLogo'));
  assert.ok(html.includes('>Scout<'));
  assert.ok(html.includes('High priority'));
  assert.ok(!/SIA/.test(html));
});

test('the inline Scout logo is a complete PNG', () => {
  const code = require('node:fs').readFileSync(require('node:path').join(__dirname, '../apps-script/pipeline/Code.gs'), 'utf8');
  const b64 = code.match(/const SCOUT_LOGO_B64 =\s*"([^"]+)"/)[1];
  const buf = Buffer.from(b64, 'base64');
  assert.equal(buf.toString('base64'), b64);
  assert.deepEqual([...buf.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  assert.equal(buf.subarray(buf.length - 8, buf.length - 4).toString('latin1'), 'IEND');
});

test('month routing copies leads from June 2026 on and colours rows', () => {
  const { ctx, active, raw } = setup([
    leadRow({ 0: new Date('2026-05-20T10:00:00Z') }),
    leadRow({ 0: new Date('2026-07-14T15:30:00Z'), 15: 'Sales' }),
    leadRow({ 0: new Date('2026-07-15T09:00:00Z'), 3: 'x@example.com', 15: 'Support' })
  ]);
  ctx.moveLeadToMonthTab();
  ctx.moveLeadToMonthTab();                     // idempotent
  const july = active.sheets['July 2026'];
  assert.ok(!active.sheets['May 2026']);
  assert.equal(july.rows.length, 3);
  assert.equal(july.backgrounds[2], '#D9EAD3');
  assert.equal(july.backgrounds[3], '#FFF2CC');
  assert.equal(raw.rows[2][20], 'TRUE');
});

test('checkSetup lists missing settings and the trigger interval is validated', () => {
  const { ctx, store } = setup([]);
  assert.equal(ctx.checkSetup().length, 0);
  delete store.SLACK_EMAIL_ADDRESS;
  assert.deepEqual(Array.from(ctx.checkSetup()), ['SLACK_EMAIL_ADDRESS']);
  assert.throws(() => ctx.installMainTrigger(7), /one of 1, 5, 10, 15, 30/);
});
