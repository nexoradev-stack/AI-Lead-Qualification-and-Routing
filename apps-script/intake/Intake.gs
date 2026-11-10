/* ============================================================
   INTAKE WEB APP — Webflow forms -> Google Sheets
   Deploy as a web app (Execute as: me, Who has access: Anyone).
   Webflow posts each form submission here (see webflow/lead-form.js).

   Routing by form:
     formName contains "ebook"           -> "eBooks" tab
     contact form (or message / reason)  -> "Contact" tab  (read by the lead pipeline)
     anything else (events, webinars)    -> "Forms" tab

   Script property:
     INTAKE_SPREADSHEET_ID   the spreadsheet that holds the three tabs
   ============================================================ */

function doPost(e) {
  try {
    const SHEET_ID = PropertiesService.getScriptProperties()
      .getProperty('INTAKE_SPREADSHEET_ID');
    if (!SHEET_ID) {
      throw new Error('Script property INTAKE_SPREADSHEET_ID is not set.');
    }

    const ss = SpreadsheetApp.openById(SHEET_ID);
    const data = (e && e.parameter) || {};

    const firstName = data.first_name || "";
    const lastName = data.last_name || "";
    const email = data.email || "";
    const company = data.company || "";

    const dietaryRestrictions =
      data.dietary_restrictions ||
      data.dietaryRestrictions ||
      data["Dietary restrictions"] ||
      data["dietary restrictions"] ||
      "";

    const eventPage = data.event_page || "";
    const formName = (data.formName || "").toLowerCase();

    const jobTitle = data.job_title || "";
    const state = data.state || "";
    const reason = data.reason_for_contact || "";
    const message = data.message || "";

    const utmCampaignName = data.utmCampaignName || "";
    const utmCampaignSource = data.utmCampaignSource || "";
    const utmCampaignMedium = data.utmCampaignMedium || "";

    Logger.log("Incoming form: " + formName + " (" + eventPage + ")");

    const isEbook = formName.includes("ebook");
    const isContact = formName.includes("contact") || message || reason;

    if (isEbook) {

      ss.getSheetByName("eBooks").appendRow([
        new Date(), email, formName, eventPage,
        utmCampaignName, utmCampaignSource, utmCampaignMedium
      ]);

    } else if (isContact) {

      ss.getSheetByName("Contact").appendRow([
        new Date(), firstName, lastName, email, company, jobTitle, state,
        reason, message, eventPage, formName,
        utmCampaignName, utmCampaignSource, utmCampaignMedium
      ]);

    } else {

      ss.getSheetByName("Forms").appendRow([
        new Date(), firstName, lastName, email, company, eventPage, formName,
        utmCampaignName, utmCampaignSource, utmCampaignMedium,
        "", dietaryRestrictions
      ]);
    }

    return ContentService
      .createTextOutput("Success")
      .setMimeType(ContentService.MimeType.TEXT);

  } catch (error) {
    Logger.log("ERROR: " + error);
    return ContentService
      .createTextOutput("Error")
      .setMimeType(ContentService.MimeType.TEXT);
  }
}

function doGet() {
  return ContentService.createTextOutput("Integration LIVE ✅");
}
