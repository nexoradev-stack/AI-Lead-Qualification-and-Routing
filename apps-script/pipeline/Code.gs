/* ============================================================
   AI Lead Qualification & Routing — lead pipeline (Apps Script)
   Bound to the spreadsheet "Website General Inquiries (Vertex AI)".

   Every run of main():
     1. importNewLeads()          new rows from the intake sheet -> "Raw Website Leads"
     2. checkDuplicates()         same email + message -> Duplicate
     3. processOneLeadWithGemini() quick spam rules, then Gemini on Vertex AI:
                                   category, score (0-100), priority, reason
     4. sendGenuineLeads()        routing:
                                     Salesforce : Sales only
                                     Slack      : Sales + Partner
                                     Email      : Sales + Partner
     5. moveLeadToMonthTab()      copy each lead to its month tab ("June 2026" ...)
     then writeLog()              counts + status to the "Logs" tab

   Email design
   - Header: 66degrees wordmark, centred, linked to the website
   - Priority pill: High / Medium / Low (never for Career)
   - Body font: Lexend (light weight)
   - "Scout" AI lead scoring card (badge logo, inline image)
   - Source & tracking chip grid
   - Footer: copyright only

   Settings live in Script properties (Project Settings > Script properties).
   Nothing private is written in this file. See README > Setup.
   ============================================================ */


/* ------------------------------------------------------------
   CONFIG
   ------------------------------------------------------------ */

// Optional: hosted PNG of the Scout badge logo.
// Leave '' to use the built-in inline (CID) logo embedded below.
// A hosted PNG renders identically in ALL clients (incl. Outlook & Gmail).
const SCOUT_AVATAR_URL = '';

// Header logo link
const LOGO_LINK = 'https://www.66degrees.com/';

// Inline Scout badge logo (72 x 72 PNG, base64). Decoded and attached as an inline
// (CID) image by sendLeadEmail() when SCOUT_AVATAR_URL is empty. No hosting needed.
const SCOUT_LOGO_B64 =
"iVBORw0KGgoAAAANSUhEUgAAAEgAAABICAMAAABiM0N1AAAAwFBMVEURFTEXHEI7QH0AAAA1OXAkKVP8/PwFCyellv6WhvqGdfkdIUh6Z/UQFC9LRZEAAFVyZ8kPFC5WUZgRFTMuLGQ9QoCCecs4PFVVTK1PUmliWrGAbfpDPY4AAD8PFC4ZHUdkV8kQFTAXHUgZHUcAAH+ZnKifoK2pq7W9vsbExcwOEzB7cckHDx4LDiIYHUY9OIRbVKVfUsKfkPwLDyIMEh8ZGUQaHEhBP3dCQHlvZrgAAAAAAAAAAAAAAAAAAAAAAAAaW4lNAAAAQHRSTlP+/v8A//////////7/rf8D/3D/Lf///////////wTWrP9VLm4C//////8d/yFO1v////+xKR5Y////AAAAAAAAbaNQzwAAA4tJREFUeNqtmIl2ojAUhi+SCCSAiNS9LtXu7bTT2d//xeaGBGRJBIX/9JzWmnz5c292sKWOR9u+O2y/WVqBRptgPMF6qr4N8tcIMVvLJDApmKRVT6DROYyZI1GjE2hkH6zrOKixJAnQrX3gV3ME6VaCOnIUCdDY724cgD1C4GjfWR05AJg8GNlb3pUDgT2Cc4agtSYYI7Oh9hy0BL968IN6gUMvHBjDthcOBNAw3y1OU/EG8gZMHFGRU0IGSoTQE4uQOsrMKVAyFpd1nOnUaQUS/+dIET/oBEWI+ii+c4jrEqcFKLUj6hW7YwmDiKJApi5qShpBgkPy5otFBf2GtAUhxxKcLCClwkSQ2nUtTQpyqD7NNCW1CHaNQ0kYx+HJniDR5vSLvNMC58+rJwLiel5EiiRoAMm85xwZ1pSDipKcNGgAydqYGvlV7Lpfrhct4/gzSlEhVEoYQFl7KiBL13O9WJmjIfOY95nNkAE/A6o0FyMn4nl2HB4hKVSNaSxVOBghOQ4Jcv5JxGIhcUuPsURZMoPynKjGMM6vysvzs/IVMRZltqkBlC8Qqshf98uTZZ3ZcDiTJM4YS5vhmr5V1jGiZljkurGs7TwMhw/qz5CxpWpPD8o/ZU1RTJgyRIcoKkl0xXw1+Ac6UHEqSRDJIuTQRwF6pE6K2qlwI4jXQaU5KUMUui72wXFm90Ol+5lAzRn7KJYrgUADwkEdAyyehgU9LbABxtaOAQSXgVYmEGhBoevpu7ZaEWgJksHGyZ7Guhps3zcFu6ws/Rznuib9lu8b019RPiBx0agPyLXvz00DsgaSnce+MV6dIsJQYpoihiAJS1F10n73/Z1x0tY2HLWMJLj6LMvLyBwNUeMyYuobhEgqLmwW+vE/zAtbPW/KEsxxHWOh6gLHOPt+eGap1VlSzeF8YGy1m4fhfCcw/vrc4l+P0mlbSyImtRKYHT27HWl35TwnZOkLDoLmScMGqR+Up+xaCVmvSWKVNv+2J8vKIcJxynZbcySJGL64uYCDFW6wSi0S9GKOrCOOfoUBlh79CIVLpT+MwhXi9eOxBVeqfGBvOvs3GUtvEE2lNngb6UUB3o960RhvbL3oBexe+oZXUXvSB2girus9WPqRPmn0YOlNPmnsu3Les0eWjkNgfHr2GXfmZA9RHXq3Lz+NTa7MXfCz9li3vwIVvNuVV79Uk3GwaQ/B58O3QuX/V5IwR6j3IHsAAAAASUVORK5CYII=";

// Reads one setting from Script properties; `fallback` is used when it isn't set.
function setting_(name, fallback) {
  const value = PropertiesService.getScriptProperties().getProperty(name);
  return (value === null || value === undefined || value === '') ? fallback : value;
}

// Fails with a clear message when a required setting is missing.
function requiredSetting_(name) {
  const value = setting_(name, '');
  if (!value) {
    throw new Error('Script property ' + name + ' is not set. See README > Setup.');
  }
  return value;
}


/* ============================================================
   IMPORT NEW LEADS
   ============================================================ */

function importNewLeads() {

  const props = PropertiesService.getScriptProperties();

  const sourceSpreadsheetId = props.getProperty('SOURCE_SPREADSHEET_ID');
  const sourceTabName = props.getProperty('SOURCE_TAB_NAME');
  const rawTabName = props.getProperty('RAW_TAB_NAME');

  const lastImportedRow = Number(props.getProperty('LAST_IMPORTED_ROW'));

  const sourceSpreadsheet = SpreadsheetApp.openById(sourceSpreadsheetId);
  const sourceSheet = sourceSpreadsheet.getSheetByName(sourceTabName);

  const rawSheet = SpreadsheetApp
    .getActiveSpreadsheet()
    .getSheetByName(rawTabName);

  const sourceLastRow = sourceSheet.getLastRow();
  const sourceLastColumn = sourceSheet.getLastColumn();

  if (sourceLastRow <= lastImportedRow) {
    Logger.log('No new leads found.');
    return;
  }

  const numRows = sourceLastRow - lastImportedRow;

  const data = sourceSheet
    .getRange(lastImportedRow + 1, 1, numRows, sourceLastColumn)
    .getValues();

  // Build a set of keys already present in the raw sheet
  // Key = email | message (same key checkDuplicates uses, ignores timestamp)
  const existing = {};

  const rawData = rawSheet.getDataRange().getValues();

  for (let r = 1; r < rawData.length; r++) {
    const key =
      String(rawData[r][3] || '').trim().toLowerCase() + '|' +
      String(rawData[r][8] || '').trim().toLowerCase();
    existing[key] = true;
  }

  // Keep only rows not already present, and dedupe within this batch too
  const toImport = [];

  for (let k = 0; k < data.length; k++) {
    const key =
      String(data[k][3] || '').trim().toLowerCase() + '|' +
      String(data[k][8] || '').trim().toLowerCase();

    if (!existing[key]) {
      existing[key] = true;
      toImport.push(data[k]);
    }
  }

  if (toImport.length > 0) {
    rawSheet
      .getRange(rawSheet.getLastRow() + 1, 1, toImport.length, toImport[0].length)
      .setValues(toImport);
  }

  props.setProperty('LAST_IMPORTED_ROW', String(sourceLastRow));

  Logger.log(
    toImport.length + ' new leads imported, ' +
    (data.length - toImport.length) + ' duplicates skipped.'
  );
}


/* ============================================================
   DUPLICATE CHECK
   ============================================================ */

function checkDuplicates() {

  const rawSheet = SpreadsheetApp
    .getActiveSpreadsheet()
    .getSheetByName('Raw Website Leads');

  const data = rawSheet.getDataRange().getValues();

  const emailCol = 3;
  const messageCol = 8;

  const aiCategoryCol = 15;
  const aiScoreCol = 16;
  const aiPriorityCol = 17;
  const aiReasonCol = 18;
  const aiProcessedCol = 19;

  const seen = {};

  for (let i = 1; i < data.length; i++) {

    const email = String(data[i][emailCol] || '').trim().toLowerCase();
    const message = String(data[i][messageCol] || '').trim().toLowerCase();
    const key = email + '|' + message;

    if (seen[key]) {
      rawSheet.getRange(i + 1, aiCategoryCol + 1).setValue('Duplicate');
      rawSheet.getRange(i + 1, aiScoreCol + 1).setValue(0);
      rawSheet.getRange(i + 1, aiPriorityCol + 1).setValue('Ignore');
      rawSheet.getRange(i + 1, aiReasonCol + 1).setValue('Duplicate submission detected');
      rawSheet.getRange(i + 1, aiProcessedCol + 1).setValue('TRUE');
    } else {
      seen[key] = true;
    }
  }

  Logger.log('Duplicate check completed.');
}


/* ============================================================
   GEMINI CLASSIFICATION
   ============================================================ */

function processOneLeadWithGemini() {

  const sheet = SpreadsheetApp
    .getActiveSpreadsheet()
    .getSheetByName('Raw Website Leads');

  const data = sheet.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {

    const aiProcessed = String(data[i][19] || '').trim();

    if (!aiProcessed) {

      const firstName = String(data[i][1] || '');
      const lastName = String(data[i][2] || '');
      const email = String(data[i][3] || '');
      const company = String(data[i][4] || '');
      const jobTitle = String(data[i][5] || '');
      const reasonForContact = String(data[i][7] || '');
      const message = String(data[i][8] || '');

      const textToCheck = (
        firstName + ' ' + lastName + ' ' + email + ' ' +
        company + ' ' + jobTitle + ' ' + reasonForContact + ' ' + message
      ).toLowerCase().trim();

      const spamKeywords = ['asdf', 'qwerty', '12345'];

      const spamEmailPatterns = [
        'test@', 'testing@', 'demo@', 'admin@', 'noreply@'
      ];

      if (
        spamKeywords.some(word => textToCheck.includes(word)) ||
        spamEmailPatterns.some(word => email.toLowerCase().includes(word))
      ) {
        sheet.getRange(i + 1, 15).setValue('Completed');
        sheet.getRange(i + 1, 16).setValue('Spam');
        sheet.getRange(i + 1, 17).setValue(0);
        sheet.getRange(i + 1, 18).setValue('Ignore');
        sheet.getRange(i + 1, 19).setValue('Test/Spam submission detected');
        sheet.getRange(i + 1, 20).setValue('TRUE');
        Logger.log('Spam lead skipped');
        continue;
      }

      const cleanMessage = message.trim();
      const gibberishPattern = /^[a-zA-Z0-9]{10,}$/;

      if (
        gibberishPattern.test(cleanMessage) &&
        !cleanMessage.includes(' ') &&
        cleanMessage.length > 10
      ) {
        sheet.getRange(i + 1, 15).setValue('Completed');
        sheet.getRange(i + 1, 16).setValue('Spam');
        sheet.getRange(i + 1, 17).setValue(0);
        sheet.getRange(i + 1, 18).setValue('Ignore');
        sheet.getRange(i + 1, 19).setValue('Gibberish content detected');
        sheet.getRange(i + 1, 20).setValue('TRUE');
        Logger.log('Gibberish lead skipped');
        continue;
      }

      const prompt = `

Classify this website lead.

Return ONLY valid JSON.

Categories:
Sales
Genuine Inquiry
Support
Career
Spam
Review Required
Partner

Scoring Rules:
Career = 0
Spam = 0
Sales = 80-100
Genuine Inquiry = 60-79
Support = 40-59
Partner = 40-59
Review Required = 1-39

Be extremely strict.

Classify based on the full lead profile and message intent.

Spam:

* Test submissions
* Dummy submissions
* Fake names
* Fake companies
* Random text
* Gibberish

Career:

* Job applications
* Resume submissions
* Employment inquiries

Sales:

* Looking to purchase services
* Looking for consulting
* Looking for implementation support
* Looking for cloud, AI, data, analytics, migration or managed services
* Requests for meetings, quotes or proposals

Genuine Inquiry:

* Business inquiry
* Information request

Partner:

* Magazine outreach
* Media outreach
* Award nominations
* Sponsorship opportunities
* Partnership proposals
* Collaboration opportunities
* Strategic alliances
* Vendor partnerships
* Technology partnerships

Review Required:

* Intent cannot be confidently determined

Lead Details:

First Name:
${firstName}

Last Name:
${lastName}

Email:
${email}

Company:
${company}

Job Title:
${jobTitle}

Reason For Contact:
${reasonForContact}

Message:
${message}

JSON Format:
{
"category":"",
"score":"",
"priority":"",
"reason":""
}
`;

      const projectId = requiredSetting_('VERTEX_PROJECT_ID');
      const location = setting_('VERTEX_LOCATION', 'us-central1');
      const model = setting_('GEMINI_MODEL', 'gemini-2.5-flash');

      const url =
        "https://" + location +
        "-aiplatform.googleapis.com/v1/projects/" +
        projectId + "/locations/" + location +
        "/publishers/google/models/" + model + ":generateContent";

      const payload = {
        contents: [
          { role: "user", parts: [{ text: prompt }] }
        ]
      };

      const response = UrlFetchApp.fetch(url, {
        method: "post",
        contentType: "application/json",
        headers: { Authorization: "Bearer " + ScriptApp.getOAuthToken() },
        payload: JSON.stringify(payload),
        muteHttpExceptions: true
      });

      if (response.getResponseCode() != 200) {
        throw new Error(response.getContentText());
      }

      const result = JSON.parse(response.getContentText());
      const text = result.candidates[0].content.parts[0].text;

      const cleanText = text
        .replace(/```json/g, "")
        .replace(/```/g, "")
        .trim();

      const aiResult = JSON.parse(cleanText);

      if (aiResult.category === 'Career') {
        aiResult.priority = 'Ignore';
      } else if (aiResult.category === 'Spam') {
        aiResult.priority = 'Ignore';
      } else if (aiResult.category === 'Sales') {
        aiResult.priority = 'High';
      } else if (aiResult.category === 'Genuine Inquiry') {
        aiResult.priority = 'Medium';
      } else if (aiResult.category === 'Support') {
        aiResult.priority = 'Medium';
      } else if (aiResult.category === 'Partner') {
        aiResult.priority = 'Low';
      } else if (aiResult.category === 'Review Required') {
        aiResult.priority = 'Low';
      }

      sheet.getRange(i + 1, 15).setValue('Completed');
      sheet.getRange(i + 1, 16).setValue(aiResult.category);
      sheet.getRange(i + 1, 17).setValue(aiResult.score);
      sheet.getRange(i + 1, 18).setValue(aiResult.priority);
      sheet.getRange(i + 1, 19).setValue(aiResult.reason);
      sheet.getRange(i + 1, 20).setValue('TRUE');

      Logger.log('Lead processed successfully: ' + aiResult.category);
    }
  }

  Logger.log('Lead processing completed.');
}


/* ============================================================
   SEND GENUINE LEADS
   ------------------------------------------------------------
   Routing:
     - Salesforce : SALES ONLY
     - Slack      : Sales + Partner
     - Email      : Sales + Partner
   ============================================================ */

function sendGenuineLeads() {

  const sheet = SpreadsheetApp
    .getActiveSpreadsheet()
    .getSheetByName('Raw Website Leads');

  const data = sheet.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {

    const category = String(data[i][15] || '').trim();      // P = AI Category
    const salesforceSent = String(data[i][21] || '').trim(); // V
    const slackSent = String(data[i][22] || '').trim();      // W
    const emailSent = String(data[i][23] || '').trim();      // X

    // Slack + Email still handle BOTH Sales and Partner
    if (category !== 'Sales' && category !== 'Partner') {
      continue;
    }

    // Salesforce: SALES ONLY
    if (category === 'Sales' && !salesforceSent) {
      sendLeadToSalesforce(data[i]);
      sheet.getRange(i + 1, 22).setValue('TRUE');
      Logger.log('Salesforce sent for row ' + (i + 1));
    }

    if (!slackSent) {
      sendLeadToSlack(data[i], category);
      sheet.getRange(i + 1, 23).setValue('TRUE');
      Logger.log('Slack sent for row ' + (i + 1));
    }

    if (!emailSent) {
      sendLeadEmail(data[i], category);
      sheet.getRange(i + 1, 24).setValue('TRUE');
      Logger.log('Email sent for row ' + (i + 1));
    }
  }

  Logger.log('Sales and Partner lead sending completed.');
}


/* ============================================================
   SALESFORCE (Account Engagement form handler)
   ============================================================ */

function sendLeadToSalesforce(rowData) {

  const formHandlerURL = requiredSetting_('SALESFORCE_FORM_HANDLER_URL');

  const payload = {
    first_name: rowData[1],
    last_name: rowData[2],
    email: rowData[3],
    company: rowData[4],
    job_title: rowData[5],
    state: rowData[6],
    reason_for_contact: rowData[7],
    message: rowData[8],
    event_page: rowData[9],
    formName: rowData[10],
    utmCampaignName: rowData[11],
    utmCampaignSource: rowData[12],
    utmCampaignMedium: rowData[13]
  };

  const options = {
    method: 'post',
    payload: payload,
    followRedirects: true,
    muteHttpExceptions: true
  };

  const response = UrlFetchApp.fetch(formHandlerURL, options);
  const responseCode = response.getResponseCode();

  if (responseCode >= 200 && responseCode < 400) {
    Logger.log('Salesforce Form Handler success: ' + responseCode);
  } else {
    throw new Error(
      'Salesforce Form Handler failed. HTTP Code: ' +
      responseCode + ' Response: ' + response.getContentText()
    );
  }
}


/* ============================================================
   SLACK (email-to-Slack, plain text)
   ============================================================ */

function sendLeadToSlack(rowData, category) {

  const slackEmail = requiredSetting_('SLACK_EMAIL_ADDRESS');

  const isSales = category === 'Sales';
  const catEmoji = isSales ? '🚀' : '🤝'; // rocket / handshake

  const priority = String(rowData[17] || '').trim();
  const prLower = priority.toLowerCase();
  const prEmoji =
    prLower === 'high' ? '🔴' :
    prLower === 'medium' ? '🟠' :
    '⚪';

  const score =
    (rowData[16] !== '' && rowData[16] != null) ? rowData[16] + '/100' : '—';

  const divider =
    '━━━━━━━━━━━━' +
    '━━━━━━━━━━';

  const subject = isSales
    ? ':rotating_light: New General Enquiry Sales Lead'
    : ':handshake: New General Enquiry Partner Lead';

  const message =
`${catEmoji} NEW ${category.toUpperCase()} LEAD ${prEmoji} ${priority ? priority.toUpperCase() + ' PRIORITY' : ''}
AI Score: ${score}

${divider}
👤 CONTACT
Name: ${rowData[1]} ${rowData[2]}
Email: ${rowData[3]}
Company: ${rowData[4]}
Job Title: ${rowData[5]}
State: ${rowData[6]}

📝 MESSAGE
${rowData[8]}

🤖 WHY IT MATTERS
${rowData[18] || '—'}

${divider}
📄 DETAILS
Reason For Contact: ${rowData[7]}
Event Page: ${rowData[9]}
Form Name: ${rowData[10]}
Campaign: ${rowData[11] || '—'}
Source / Medium: ${(rowData[12] || '—')} / ${(rowData[13] || '—')}

Timestamp: ${rowData[0]}
`;

  MailApp.sendEmail(slackEmail, subject, message);
}


/* ============================================================
   EMAIL (final HTML design)
   ============================================================ */

function sendLeadEmail(rowData, category) {

  const recipients = category === 'Sales'
    ? requiredSetting_('SALES_EMAIL_RECIPIENTS')
    : requiredSetting_('PARTNER_EMAIL_RECIPIENTS');

  const subjectMap = {
    'Sales':   'New Sales Lead',
    'Partner': 'New Partner Lead',
    'Support': 'New Support Request',
    'Career':  'New Career / Job Application'
  };
  const subject = subjectMap[category] || ('New ' + category + ' Lead');

  // Plain-text fallback (clients that block HTML)
  const plainBody =
`New ${category} Lead

Name: ${rowData[1]} ${rowData[2]}
Email: ${rowData[3]}
Company: ${rowData[4]}
Job Title: ${rowData[5]}
State: ${rowData[6]}
Lead type: ${category}
${category === 'Career' ? '' : 'AI lead score: ' + rowData[16] + '\nPriority: ' + rowData[17] + '\n'}
Reason For Contact: ${rowData[7]}

Message:
${rowData[8]}

Scout — ${rowData[18]}`;

  const mailOptions = {
    to: recipients,
    name: setting_('MAIL_FROM_NAME', '66degrees Marketing'),
    subject: subject,
    body: plainBody,
    htmlBody: buildLeadEmailHtml(rowData, category)
  };

  // Send from a shared address only when one is configured
  // (it must be an alias of the account that runs the script).
  const from = setting_('MAIL_FROM', '');
  if (from) {
    mailOptions.from = from;
  }

  // Attach the inline Scout logo only when not using a hosted URL.
  // The key "scoutLogo" must match  src="cid:scoutLogo"  in scoutAvatarHtml().
  if (!SCOUT_AVATAR_URL) {
    mailOptions.inlineImages = {
      scoutLogo: Utilities.newBlob(
        Utilities.base64Decode(SCOUT_LOGO_B64), 'image/png', 'scout.png'
      )
    };
  }

  MailApp.sendEmail(mailOptions);
}


/* ============================================================
   MESSAGING HELPERS
   ============================================================ */

function leadPriorityStyle(priority) {
  const p = String(priority || '').trim().toLowerCase();
  if (p === 'high')   return { bg: '#FCEBEB', text: '#A32D2D', solid: '#E24B4A' };
  if (p === 'medium') return { bg: '#FAEEDA', text: '#854F0B', solid: '#BA7517' };
  return { bg: '#F1EFE8', text: '#444441', solid: '#5F5E5A' }; // low / other
}

function leadScoreColor(score) {
  const n = Number(score);
  if (!isNaN(n) && n >= 60) return '#0F6E56'; // green
  if (!isNaN(n) && n >= 40) return '#854F0B'; // amber
  return '#5F5E5A';                            // grey
}

function formatLeadTimestamp(ts) {
  try {
    const d = (ts instanceof Date) ? ts : new Date(ts);
    if (isNaN(d.getTime())) return String(ts || '');
    return Utilities.formatDate(
      d, Session.getScriptTimeZone(), 'd MMM yyyy, h:mm a'
    );
  } catch (e) {
    return String(ts || '');
  }
}

function escapeHtml(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Scout avatar: hosted PNG if configured, else inline (CID) badge logo
function scoutAvatarHtml() {
  if (SCOUT_AVATAR_URL) {
    return `<img src="${SCOUT_AVATAR_URL}" width="36" height="36" alt="Scout" ` +
           `style="display:block;border:0;border-radius:8px;">`;
  }
  // Inline image attached in sendLeadEmail() via inlineImages: { scoutLogo: ... }
  return `<img src="cid:scoutLogo" width="36" height="36" alt="Scout" ` +
         `style="display:block;border:0;border-radius:8px;">`;
}


/* ============================================================
   BUILD LEAD EMAIL HTML  (final design — lighter fonts)
   ============================================================ */

function buildLeadEmailHtml(rowData, category) {

  const LOGO_FONT = "'Poppins','Century Gothic','Helvetica Neue',Arial,sans-serif";
  const BODY_FONT = "'Lexend','Helvetica Neue',Helvetica,Arial,sans-serif";

  const isCareer = (category === 'Career');

  const priority = String(rowData[17] || '').trim();
  const prLower = priority.toLowerCase();
  const showPill = (prLower === 'high' || prLower === 'medium' || prLower === 'low');
  const pr = leadPriorityStyle(priority);

  const scoreRaw = rowData[16];
  const scoreCol = leadScoreColor(scoreRaw);
  const scoreTxt = (scoreRaw !== '' && scoreRaw != null) ? escapeHtml(scoreRaw) : '0';

  const fullName = escapeHtml(((rowData[1] || '') + ' ' + (rowData[2] || '')).trim());
  const initials = escapeHtml(
    (String(rowData[1] || '').charAt(0) + String(rowData[2] || '').charAt(0)).toUpperCase()
  );
  const email = escapeHtml(rowData[3]);
  const company = escapeHtml(rowData[4]);
  const jobTitle = escapeHtml(rowData[5]);
  const state = escapeHtml(rowData[6]);
  const reason = escapeHtml(rowData[7]);
  const message = escapeHtml(rowData[8]).replace(/\n/g, '<br>');
  const eventPage = escapeHtml(rowData[9] || '—');
  const formName = escapeHtml(rowData[10] || '—');
  const campName = escapeHtml(rowData[11] || '—');
  const campSrc = escapeHtml(rowData[12] || '—');
  const campMed = escapeHtml(rowData[13] || '—');
  const aiReason = escapeHtml(rowData[18] || '');
  const received = escapeHtml(formatLeadTimestamp(rowData[0]));

  const subtitle = [jobTitle, company].filter(Boolean).join(' &middot; ');

  // ---- Header (logo + optional pill) ----
  const logoAnchor =
    `<a href="${LOGO_LINK}" style="font-family:${LOGO_FONT};font-weight:400;font-size:22px;` +
    `color:#ffffff;letter-spacing:-0.5px;line-height:1;text-decoration:none;">66degrees</a>`;

  const header = showPill
    ? `<td style="background:#0A0F1F;padding:20px 24px;">
         <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
           <td width="120" valign="middle">&nbsp;</td>
           <td align="center" valign="middle">${logoAnchor}</td>
           <td width="120" align="right" valign="middle">
             <span style="display:inline-block;background:${pr.solid};color:#ffffff;font-family:${BODY_FONT};` +
             `font-size:12px;font-weight:400;padding:5px 14px;border-radius:20px;white-space:nowrap;">` +
             `${escapeHtml(priority)} priority</span>
           </td>
         </tr></table>
       </td>`
    : `<td style="background:#0A0F1F;padding:20px 24px;text-align:center;">${logoAnchor}</td>`;

  // ---- Stat strip (Career = 2 cols, others = 3 cols) ----
  const statStrip = isCareer
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
         <td width="50%" align="center" style="padding:14px 8px;border-right:1px solid #E2E4E9;">
           <div style="font-size:12px;color:#5F5E5A;margin-bottom:4px;">Lead type</div>
           <div style="font-size:15px;font-weight:400;color:#2C2C2A;">${escapeHtml(category)}</div>
         </td>
         <td width="50%" align="center" style="padding:14px 8px;">
           <div style="font-size:12px;color:#5F5E5A;margin-bottom:4px;">Form Submitted</div>
           <div style="font-size:15px;font-weight:400;color:#2C2C2A;">${received}</div>
         </td>
       </tr></table>`
    : `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
         <td width="33%" align="center" style="padding:14px 8px;border-right:1px solid #E2E4E9;">
           <div style="font-size:12px;color:#5F5E5A;margin-bottom:4px;">Lead type</div>
           <div style="font-size:15px;font-weight:400;color:#2C2C2A;">${escapeHtml(category)}</div>
         </td>
         <td width="33%" align="center" style="padding:14px 8px;border-right:1px solid #E2E4E9;">
           <div style="font-size:12px;color:#5F5E5A;margin-bottom:4px;">AI lead score</div>
           <div style="font-size:15px;font-weight:400;color:${scoreCol};">${scoreTxt} / 100</div>
         </td>
         <td width="33%" align="center" style="padding:14px 8px;">
           <div style="font-size:12px;color:#5F5E5A;margin-bottom:4px;">Form Submitted</div>
           <div style="font-size:15px;font-weight:400;color:#2C2C2A;">${received}</div>
         </td>
       </tr></table>`;

  // ---- Scout scoring card ----
  const scoutHeading = isCareer
    ? `Why this is flagged as ${escapeHtml(category)}`
    : `Why the AI lead score is ${scoreTxt}?`;

  const scoutCard =
    `<div style="margin-top:16px;background:#F3F0FF;border:1px solid #E4DBFF;border-radius:10px;padding:14px 16px;">
       <table role="presentation" cellpadding="0" cellspacing="0"><tr>
         <td width="36" valign="middle">${scoutAvatarHtml()}</td>
         <td style="padding-left:10px;" valign="middle">
           <div style="font-size:14px;font-weight:400;color:#4A3A9E;line-height:1.2;">Scout</div>
           <div style="font-size:11px;color:#8A7FC0;line-height:1.2;">AI lead scoring</div>
         </td>
       </tr></table>
       <div style="font-size:13px;font-weight:400;color:#4A3A9E;margin-top:12px;margin-bottom:4px;">${scoutHeading}</div>
       <div style="font-size:13px;color:#2C2C2A;line-height:1.55;">${aiReason}</div>
     </div>`;

  // ---- Full email ----
  return `
<style>
@import url('https://fonts.googleapis.com/css2?family=Poppins:wght@300;400;500&family=Lexend:wght@300;400;500&display=swap');
</style>
<div style="margin:0;padding:24px;background:#F1EFE8;font-family:${BODY_FONT};">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;margin:0 auto;background:#ffffff;border:1px solid #E2E4E9;border-radius:12px;overflow:hidden;">

  <tr>${header}</tr>

  <tr>
    <td style="padding:0;border-bottom:1px solid #E2E4E9;font-family:${BODY_FONT};">${statStrip}</td>
  </tr>

  <tr>
    <td style="padding:20px 24px;font-family:${BODY_FONT};">

      <table role="presentation" cellpadding="0" cellspacing="0"><tr>
        <td width="44" valign="middle">
          <div style="width:44px;height:44px;border-radius:50%;background:#E6F1FB;color:#185FA5;font-size:15px;font-weight:400;text-align:center;line-height:44px;">${initials}</div>
        </td>
        <td style="padding-left:12px;" valign="middle">
          <div style="font-size:16px;font-weight:400;color:#2C2C2A;">${fullName}</div>
          <div style="font-size:13px;color:#5F5E5A;">${subtitle}</div>
        </td>
      </tr></table>

      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:16px;font-size:14px;">
        <tr>
          <td width="120" style="color:#5F5E5A;padding:7px 0;">Email</td>
          <td style="padding:7px 0;color:#185FA5;">${email}</td>
        </tr>
        <tr>
          <td style="color:#5F5E5A;padding:7px 0;">State</td>
          <td style="padding:7px 0;color:#2C2C2A;">${state}</td>
        </tr>
        <tr>
          <td style="color:#5F5E5A;padding:7px 0;" valign="top">Reason</td>
          <td style="padding:7px 0;color:#2C2C2A;">${reason}</td>
        </tr>
      </table>

      <div style="margin-top:16px;background:#F7F8FA;border-left:3px solid #185FA5;padding:14px 16px;">
        <div style="font-size:12px;color:#5F5E5A;margin-bottom:6px;">Message</div>
        <div style="font-size:14px;color:#2C2C2A;line-height:1.6;">${message}</div>
      </div>

      ${scoutCard}

    </td>
  </tr>

  <tr>
    <td style="padding:4px 24px 22px 24px;font-family:${BODY_FONT};">
      <div style="font-size:12px;font-weight:400;letter-spacing:1px;color:#8A93A0;margin-bottom:12px;">SOURCE &amp; TRACKING</div>
      <div style="background:#F7F8FA;border:1px solid #E9ECF1;border-radius:10px;padding:14px 16px;margin-bottom:12px;">
        <div style="font-size:11px;font-weight:400;letter-spacing:0.8px;color:#8A93A0;margin-bottom:5px;">EVENT PAGE</div>
        <div style="font-size:15px;font-weight:400;color:#2C2C2A;">${eventPage}</div>
      </div>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
        <td width="25%" valign="top" style="padding-right:6px;">
          <div style="background:#F7F8FA;border:1px solid #E9ECF1;border-radius:10px;padding:14px 10px;text-align:center;">
            <div style="font-size:11px;font-weight:400;letter-spacing:0.6px;color:#8A93A0;margin-bottom:5px;">FORM</div>
            <div style="font-size:14px;font-weight:400;color:#2C2C2A;">${formName}</div>
          </div>
        </td>
        <td width="25%" valign="top" style="padding-left:3px;padding-right:3px;">
          <div style="background:#F7F8FA;border:1px solid #E9ECF1;border-radius:10px;padding:14px 10px;text-align:center;">
            <div style="font-size:11px;font-weight:400;letter-spacing:0.6px;color:#8A93A0;margin-bottom:5px;">CAMPAIGN</div>
            <div style="font-size:14px;font-weight:400;color:#2C2C2A;">${campName}</div>
          </div>
        </td>
        <td width="25%" valign="top" style="padding-left:3px;padding-right:3px;">
          <div style="background:#F7F8FA;border:1px solid #E9ECF1;border-radius:10px;padding:14px 10px;text-align:center;">
            <div style="font-size:11px;font-weight:400;letter-spacing:0.6px;color:#8A93A0;margin-bottom:5px;">SOURCE</div>
            <div style="font-size:14px;font-weight:400;color:#2C2C2A;">${campSrc}</div>
          </div>
        </td>
        <td width="25%" valign="top" style="padding-left:6px;">
          <div style="background:#F7F8FA;border:1px solid #E9ECF1;border-radius:10px;padding:14px 10px;text-align:center;">
            <div style="font-size:11px;font-weight:400;letter-spacing:0.6px;color:#8A93A0;margin-bottom:5px;">MEDIUM</div>
            <div style="font-size:14px;font-weight:400;color:#2C2C2A;">${campMed}</div>
          </div>
        </td>
      </tr></table>
    </td>
  </tr>

  <tr>
    <td style="background:#B4C0C9;padding:14px 24px;text-align:center;font-size:12px;color:#1F2933;line-height:1.6;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
      &copy; 66degrees. All rights reserved.
    </td>
  </tr>

</table>
</div>`;
}


/* ============================================================
   MONTH ROUTING
   ============================================================ */

function moveLeadToMonthTab() {

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const rawSheet = ss.getSheetByName('Raw Website Leads');
  const data = rawSheet.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {

    const timestamp = data[i][0];
    if (!timestamp) continue;

    const leadDate = new Date(timestamp);

    // Skip Jan-May 2026
    if (leadDate < new Date('2026-06-01')) continue;

    const monthName = Utilities.formatDate(
      leadDate, Session.getScriptTimeZone(), 'MMMM yyyy'
    );

    let monthSheet = ss.getSheetByName(monthName);

    if (!monthSheet) {
      monthSheet = ss.insertSheet(monthName);
      const headers = rawSheet
        .getRange(1, 1, 1, rawSheet.getLastColumn())
        .getValues();
      monthSheet.getRange(1, 1, 1, headers[0].length).setValues(headers);
    }

    const sourceTimestamp = String(data[i][0]).trim();
    const sourceEmail = String(data[i][3] || '').trim().toLowerCase();
    const sourceMessage = String(data[i][8] || '').trim().toLowerCase();

    const monthData = monthSheet.getDataRange().getValues();

    let exists = false;

    for (let j = 1; j < monthData.length; j++) {
      const monthTimestamp = String(monthData[j][0]).trim();
      const monthEmail = String(monthData[j][3] || '').trim().toLowerCase();
      const monthMessage = String(monthData[j][8] || '').trim().toLowerCase();

      if (
        sourceTimestamp === monthTimestamp &&
        sourceEmail === monthEmail &&
        sourceMessage === monthMessage
      ) {
        exists = true;
        break;
      }
    }

    if (!exists) {
      monthSheet.appendRow(data[i]);
      const newRow = monthSheet.getLastRow();
      applyRowColor(monthSheet, newRow, String(data[i][15]).trim());
      rawSheet.getRange(i + 1, 21).setValue('TRUE');
      Logger.log('Copied row ' + (i + 1));
    } else {
      Logger.log('Duplicate skipped row ' + (i + 1));
    }
  }

  Logger.log('Month routing completed');
}


function applyRowColor(sheet, rowNumber, category) {
  let color;
  if (category === 'Sales' || category === 'Partner') {
    color = '#D9EAD3';
  } else {
    color = '#FFF2CC';
  }
  sheet
    .getRange(rowNumber, 1, 1, sheet.getLastColumn())
    .setBackground(color);
}


/* ============================================================
   MAIN
   ============================================================ */

function main() {

  const lock = LockService.getScriptLock();

  if (!lock.tryLock(1000)) {
    Logger.log('Another execution is already running. Exiting.');
    return;
  }

  try {
    importNewLeads();
    checkDuplicates();
    processOneLeadWithGemini();
    sendGenuineLeads();
    moveLeadToMonthTab();

    Logger.log('Main process completed successfully');
    writeLog(':white_check_mark: Success', 'Trigger completed successfully');

  } catch (error) {
    Logger.log('ERROR: ' + error);
    writeLog(':x: Error', error.toString());
  } finally {
    lock.releaseLock();
  }
}


/* ============================================================
   LOG
   ============================================================ */

function writeLog(status, message) {

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const rawSheet = ss.getSheetByName('Raw Website Leads');
  const logSheet = ss.getSheetByName('Logs');
  const data = rawSheet.getDataRange().getValues();

  let genuineCount = 0;
  let nonGenuineCount = 0;

  for (let i = 1; i < data.length; i++) {
    const category = String(data[i][15] || '').trim();

    if (category === 'Sales' || category === 'Partner') {
      genuineCount++;
    } else if (
      category === 'Spam' || category === 'Career' ||
      category === 'Support' || category === 'Review Required' ||
      category === 'Duplicate' || category === 'Genuine Inquiry'
    ) {
      nonGenuineCount++;
    }
  }

  const monthName = Utilities.formatDate(
    new Date(), Session.getScriptTimeZone(), 'MMMM'
  );

  logSheet.appendRow([
    new Date(), monthName, genuineCount, nonGenuineCount, status, message
  ]);
}

