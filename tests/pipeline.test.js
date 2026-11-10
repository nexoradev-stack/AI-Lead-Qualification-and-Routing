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

test('routing: Sales -> Salesforce + Slack + email, Partner -> Slack + email, others -> nothing', () => {
  const { ctx, raw, sent, fetched } = setup([
    leadRow({ 15: 'Sales', 16: 92, 17: 'High', 18: 'Clear buying intent' }),
    leadRow({ 3: 'p@example.com', 15: 'Partner', 16: 50, 17: 'Low', 18: 'Award nomination' }),
    leadRow({ 3: 's@example.com', 15: 'Support', 16: 45, 17: 'Medium' })
  ]);
  ctx.sendGenuineLeads();

  assert.equal(fetched.length, 1);
  assert.equal(fetched[0].url, PROPS.SALESFORCE_FORM_HANDLER_URL);
  assert.equal(fetched[0].opts.payload.email, 'alex.morgan@example.com');

  const slack = sent.filter(m => m.to === PROPS.SLACK_EMAIL_ADDRESS);
  const mail = sent.filter(m => m.htmlBody);
  assert.equal(slack.length, 2);
  assert.equal(mail.length, 2);
  assert.equal(mail[0].to, PROPS.SALES_EMAIL_RECIPIENTS);
  assert.equal(mail[0].subject, 'New Sales Lead');
  assert.equal(mail[1].to, PROPS.PARTNER_EMAIL_RECIPIENTS);
  assert.equal(mail[1].from, undefined);

  assert.deepEqual(raw.rows[1].slice(21, 24), ['TRUE', 'TRUE', 'TRUE']);
  assert.deepEqual(raw.rows[2].slice(21, 24), ['', 'TRUE', 'TRUE']);
  assert.deepEqual(raw.rows[3].slice(21, 24), ['', '', '']);

  ctx.sendGenuineLeads();                       // second run sends nothing again
  assert.equal(sent.length, 4);
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
