# Changelog

All notable changes to this project. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/).

## [1.0.0] — 2026-11-10

First public release of the lead qualification and routing system.

### Added

- **Intake web app** (`apps-script/intake/Intake.gs`): receives Webflow form posts and files them into the **Contact**, **eBooks** or **Forms** tab.
- **Lead pipeline** (`apps-script/pipeline/Code.gs`): `main()` imports new leads, removes duplicates, filters test and gibberish submissions, classifies each lead with **Gemini 2.5 Flash on Vertex AI**, routes Sales and Partner leads, files leads into month tabs from June 2026 and logs every run.
- **Routing:** Salesforce (Sales only) through the Account Engagement form handler; Slack (Sales and Partner) through the channel's email address; HTML email to the sales team (Sales) or marketing (Partner).
- **Lead email design** with a priority pill, score strip, contact card, message, source and tracking chips, and the **Scout** AI lead scoring card.
- **Scout** name and badge logo for the AI scoring card, embedded as an inline image.
- **Setup helpers** (`Setup.gs`): `checkSetup()`, `installMainTrigger()` (every 5 minutes by default, configurable) and `removeMainTrigger()`.
- **Webflow custom code** (`webflow/lead-form.js`): fills `event_page`, `formName` and first-touch UTM fields, and posts each submission to the intake web app.
- **Phase 2 email validation** with the Debounce real-time API: blocks invalid, spam-trap and disposable addresses, optional blocking of free providers and catch-all domains, and fails open after 4 seconds.
- 24 tests that run the real Apps Script files against fake Google services, a CI workflow on Node 20 and 22, and a secrets check.
- README, ARCHITECTURE and sample email and Slack images built from made-up leads.

### Changed (compared with the internal version)

- Every private value moved out of code into Script properties: spreadsheet IDs, Vertex AI project, form-handler URL, Slack address, recipient lists and sender.
- The AI scoring card is now called **Scout** with a new logo; the old inline logo was cut short and showed as a broken image in some mail clients.
- The intake app no longer writes whole form submissions to the execution log and no longer returns error details to the caller.

[1.0.0]: https://github.com/nexoradev-stack/AI-Lead-Qualification-and-Routing/releases/tag/v1.0.0
