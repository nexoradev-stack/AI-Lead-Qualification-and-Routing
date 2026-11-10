/* ============================================================
   SETUP HELPERS — run these once from the Apps Script editor.
     checkSetup()          lists Script properties that are missing
     installMainTrigger()  runs main() every N minutes (default 5)
     removeMainTrigger()   stops the schedule
   ============================================================ */

const REQUIRED_PROPERTIES = [
  'SOURCE_SPREADSHEET_ID',      // the intake spreadsheet (Webflow -> Sheets)
  'SOURCE_TAB_NAME',            // usually "Contact"
  'RAW_TAB_NAME',               // usually "Raw Website Leads"
  'LAST_IMPORTED_ROW',          // start at 1 (header row)
  'VERTEX_PROJECT_ID',          // Google Cloud project with Vertex AI enabled
  'SALESFORCE_FORM_HANDLER_URL',// Account Engagement (Pardot) form handler
  'SLACK_EMAIL_ADDRESS',        // the Slack channel's email address
  'SALES_EMAIL_RECIPIENTS',     // comma-separated
  'PARTNER_EMAIL_RECIPIENTS'    // comma-separated
];

const OPTIONAL_PROPERTIES = {
  VERTEX_LOCATION: 'us-central1',
  GEMINI_MODEL: 'gemini-2.5-flash',
  OTHER_EMAIL_RECIPIENTS: '(same as PARTNER_EMAIL_RECIPIENTS)',
  MAIL_FROM: '(account running the script)',
  MAIL_FROM_NAME: '66degrees Marketing',
  TRIGGER_MINUTES: '5'
};

function checkSetup() {
  const props = PropertiesService.getScriptProperties().getProperties();
  const missing = REQUIRED_PROPERTIES.filter(name => !props[name]);

  Object.keys(OPTIONAL_PROPERTIES).forEach(name => {
    Logger.log((props[name] ? 'set      ' : 'default  ') + name +
      (props[name] ? '' : ' = ' + OPTIONAL_PROPERTIES[name]));
  });

  if (missing.length) {
    Logger.log('Missing required Script properties: ' + missing.join(', '));
  } else {
    Logger.log('All required Script properties are set.');
  }
  return missing;
}

function installMainTrigger(minutes) {
  const every = Number(minutes ||
    PropertiesService.getScriptProperties().getProperty('TRIGGER_MINUTES') || 5);

  // Apps Script only allows these minute intervals
  const allowed = [1, 5, 10, 15, 30];
  if (allowed.indexOf(every) === -1) {
    throw new Error('Trigger interval must be one of ' + allowed.join(', ') + ' minutes.');
  }

  removeMainTrigger();
  ScriptApp.newTrigger('main').timeBased().everyMinutes(every).create();
  Logger.log('main() will run every ' + every + ' minutes.');
}

function removeMainTrigger() {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'main')
    .forEach(t => ScriptApp.deleteTrigger(t));
}
