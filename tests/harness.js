// Loads Apps Script files into a Node sandbox with small fakes of the Google services.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

class FakeSheet {
  constructor(name, rows = []) { this.name = name; this.rows = rows.map(r => r.slice()); this.backgrounds = {}; }
  getDataRange() { return { getValues: () => this.rows.map(r => r.slice()) }; }
  getLastRow() { return this.rows.length; }
  getLastColumn() { return this.rows.reduce((m, r) => Math.max(m, r.length), 0); }
  appendRow(row) { this.rows.push(row.slice()); }
  getRange(row, col, numRows = 1, numCols = 1) {
    const sheet = this;
    return {
      getValues() {
        const out = [];
        for (let r = 0; r < numRows; r++) {
          const src = sheet.rows[row - 1 + r] || [];
          const line = [];
          for (let c = 0; c < numCols; c++) line.push(src[col - 1 + c] ?? '');
          out.push(line);
        }
        return out;
      },
      setValue(v) {
        while (sheet.rows.length < row) sheet.rows.push([]);
        const r = sheet.rows[row - 1];
        while (r.length < col) r.push('');
        r[col - 1] = v;
      },
      setValues(values) {
        values.forEach((line, r) => line.forEach((v, c) =>
          sheet.getRange(row + r, col + c).setValue(v)));
      },
      setBackground(color) { sheet.backgrounds[row] = color; }
    };
  }
}

class FakeSpreadsheet {
  constructor(sheets = {}) { this.sheets = {}; Object.entries(sheets).forEach(([n, rows]) => { this.sheets[n] = new FakeSheet(n, rows); }); }
  getSheetByName(n) { return this.sheets[n] || null; }
  insertSheet(n) { this.sheets[n] = new FakeSheet(n); return this.sheets[n]; }
}

function load(files, { props = {}, active, byId = {}, fetch } = {}) {
  const sent = [];
  const fetched = [];
  const store = Object.assign({}, props);
  const sandbox = {
    console,
    Logger: { log() {} },
    PropertiesService: { getScriptProperties: () => ({
      getProperty: k => (k in store ? store[k] : null),
      setProperty: (k, v) => { store[k] = v; },
      getProperties: () => Object.assign({}, store)
    }) },
    SpreadsheetApp: { getActiveSpreadsheet: () => active, openById: id => byId[id] },
    MailApp: { sendEmail: (...args) => sent.push(args.length === 1 ? args[0] : { to: args[0], subject: args[1], body: args[2] }) },
    UrlFetchApp: { fetch: (url, opts) => { fetched.push({ url, opts }); return fetch(url, opts); } },
    ScriptApp: { getOAuthToken: () => 'test-token' },
    Session: { getScriptTimeZone: () => 'UTC' },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }) },
    ContentService: {
      MimeType: { TEXT: 'text' },
      createTextOutput: t => ({ text: t, setMimeType() { return this; } })
    },
    Utilities: {
      base64Decode: b => Array.from(Buffer.from(b, 'base64')),
      newBlob: (bytes, type, name) => ({ bytes, type, name }),
      formatDate: (d, tz, fmt) => {
        const months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
        if (fmt === 'MMMM yyyy') return months[d.getUTCMonth()] + ' ' + d.getUTCFullYear();
        if (fmt === 'MMMM') return months[d.getUTCMonth()];
        return d.toISOString();
      }
    }
  };
  vm.createContext(sandbox);
  for (const f of files) {
    const code = fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
    vm.runInContext(code, sandbox, { filename: f });
  }
  return { ctx: sandbox, sent, fetched, store };
}

// A made-up lead row in the "Raw Website Leads" layout (24 columns, A..X).
function leadRow(over = {}) {
  const row = [
    new Date('2026-07-14T15:30:00Z'), 'Alex', 'Morgan', 'alex.morgan@example.com',
    'Northwind Analytics', 'VP of Operations', 'Texas', 'Consulting Services',
    'We want to move our analytics stack to Google Cloud this quarter.',
    'Contact Us', 'contact', 'summer-cloud', 'linkedin', 'paid',
    '', '', '', '', '', '', '', '', '', ''
  ];
  Object.entries(over).forEach(([i, v]) => { row[Number(i)] = v; });
  return row;
}

const HEADER = ['Timestamp','First Name','Last Name','Email','Company','Job Title','State','Reason','Message',
  'Event Page','Form Name','UTM Campaign','UTM Source','UTM Medium','Status','AI Category','AI Score',
  'AI Priority','AI Reason','AI Processed','Month Moved','Salesforce Sent','Slack Sent','Email Sent'];

module.exports = { FakeSheet, FakeSpreadsheet, load, leadRow, HEADER };
