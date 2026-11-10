const test = require('node:test');
const assert = require('node:assert');
const { FakeSpreadsheet, load } = require('./harness');

function setup() {
  const ss = new FakeSpreadsheet({ eBooks: [], Contact: [], Forms: [] });
  const env = load(['apps-script/intake/Intake.gs'], {
    props: { INTAKE_SPREADSHEET_ID: 'sheet-1' }, byId: { 'sheet-1': ss }
  });
  return { ss, ...env };
}

test('ebook forms go to the eBooks tab', () => {
  const { ss, ctx } = setup();
  const out = ctx.doPost({ parameter: { email: 'sam@example.com', formName: 'eBook - Data Strategy', event_page: 'Data eBook' } });
  assert.equal(out.text, 'Success');
  assert.equal(ss.sheets.eBooks.rows.length, 1);
  assert.deepEqual(ss.sheets.eBooks.rows[0].slice(1, 4), ['sam@example.com', 'ebook - data strategy', 'Data eBook']);
});

test('contact forms go to the Contact tab with 14 columns', () => {
  const { ss, ctx } = setup();
  ctx.doPost({ parameter: { first_name: 'Alex', last_name: 'Morgan', email: 'alex@example.com', formName: 'Contact', message: 'Hi', utmCampaignSource: 'linkedin' } });
  const row = ss.sheets.Contact.rows[0];
  assert.equal(row.length, 14);
  assert.equal(row[1], 'Alex');
  assert.equal(row[8], 'Hi');
  assert.equal(row[10], 'contact');
  assert.equal(row[12], 'linkedin');
});

test('a message alone counts as a contact form', () => {
  const { ss, ctx } = setup();
  ctx.doPost({ parameter: { email: 'a@example.com', formName: 'Footer', message: 'Hello' } });
  assert.equal(ss.sheets.Contact.rows.length, 1);
});

test('other forms go to the Forms tab with dietary restrictions last', () => {
  const { ss, ctx } = setup();
  ctx.doPost({ parameter: { email: 'b@example.com', formName: 'Event RSVP', 'Dietary restrictions': 'Vegetarian' } });
  const row = ss.sheets.Forms.rows[0];
  assert.equal(row.length, 12);
  assert.equal(row[11], 'Vegetarian');
});

test('a missing spreadsheet setting returns a plain error without details', () => {
  const env = load(['apps-script/intake/Intake.gs'], { props: {} });
  assert.equal(env.ctx.doPost({ parameter: {} }).text, 'Error');
});

test('doGet reports the integration is live', () => {
  const { ctx } = setup();
  assert.match(ctx.doGet().text, /LIVE/);
});
