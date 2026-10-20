# AlertChain Agent

Sheridan College — Honours Bachelor of Computer Science
Cloud Computing Capstone Project

## Overview

AlertChain Agent helps small AWS teams review security alerts, investigate related activity, and understand potential attack chains.

The planned system collects Amazon GuardDuty findings and selected AWS CloudTrail events, normalizes them, and uses an AI investigation agent to produce evidence-based incident reports.

## Team

- Jacob Makil — Alert Ingestion & Cloud Integration
- Harneet Kaur — Agentic Reasoning & Correlation Engine
- Mattias Kerner — Application, Dashboard & Ask-the-Agent

## Inception UI Prototype

The repository includes the FA1, FA2, and FA3 frontend prototypes using fictional mock data. The shared React Router shell starts on the FA3 Dashboard and connects all three functional areas.

Implemented FA1 screens cover security signal sources, monitored event configuration, normalized alert browsing, and alert details. The shared layout provides the AlertChain Agent header and sidebar.

The FA2 investigation prototype (Investigation View, Reasoning Trace, Attack Chain) is integrated through the sidebar and alert-detail **Investigate** button. **Open incident** now opens the matching FA3 report. FA3 includes the dashboard, incident list, report, Ask the Agent, and stored-evidence viewer. Live AWS ingestion, AI investigations, and backend integration remain planned work.

## Technology

- Current frontend: React 19, React Router 7, plain CSS, Vite 8, and ESLint 10
- Planned backend: FastAPI
- Planned cloud services: Amazon GuardDuty, AWS CloudTrail,
  Amazon EventBridge, AWS Lambda, Amazon API Gateway,
  Amazon DynamoDB, Amazon Bedrock, and Amazon CloudWatch

## Setup and Run Instructions

Install Git, Node.js, and npm. The tooling locked in `package-lock.json` supports Node.js **`^20.19.0 || ^22.13.0 || >=24`**: Node 20.19+ within the 20.x line, Node 22.13+ within the 22.x line, or Node 24+. The Node 22 minimum comes from ESLint; Vite alone accepts 22.12+.

```sh
git clone https://github.com/AlertChain-Capstone/alertchain-agent.git
cd alertchain-agent
npm ci
npm run dev
```

Open the local address printed by Vite. `http://localhost:5173` is the usual default; Vite may choose another port if it is occupied.

This frontend prototype requires **no AWS credentials, backend server, or environment variables**. No `.env` file is needed.

The scripts in `package.json` are:

| Command | Purpose |
| --- | --- |
| `npm run dev` | Run the Vite development server. |
| `npm run lint` | Run `eslint .`. |
| `npm run build` | Run `vite build`, generating the frontend bundle in `dist/`. |
| `npm run preview` | Run `vite preview` to serve a previously built bundle locally. Run `npm run build` first, then open the address printed by preview. |
| `npm test` | Verify incident ordering, fixture compatibility, and answer/citation boundaries. |
| `npm run test:e2e` | Run Playwright browser tests; starts Vite on port 5178 automatically. |
| `npm run test:optional` | Build isolated copies with each FA folder missing to check the shell's placeholder support. |

For browser tests, install Chromium once with `npx playwright install chromium`. Alternatively, use installed Microsoft Edge: in PowerShell run `$env:PW_CHANNEL = 'msedge'` before `npm run test:e2e`. The application itself does not need Playwright.

## Shared App Shell — M6

The start page is **Dashboard**. The sidebar has three sections: **Dashboard & Incidents** (FA3), **Alerts & Sources** (FA1), and **Investigations** (FA2).

React Router uses hash URLs so deep links also work on a static host without server rewrite rules. Refresh, Back, and Forward use the URL to select the screen.

| Area | Routes (append after `#`) |
| --- | --- |
| FA1 | `/sources`, `/alerts`, `/alerts/:id` |
| FA2 | `/investigations`, `/investigations/:id`, `/incidents/:id/chain` |
| FA3 | `/`, `/incidents`, `/incidents/:id`, `/incidents/:id/ask` |

Each `src/faX/routes.jsx` exports a default object with `Component` and a `routes` array of `{ path, view }` entries. The shell discovers these modules through Vite's glob imports. `src/shared/areas.js` supplies the sidebar and fallback route ownership. If a functional area's folder or route module is missing, its links show an integration placeholder while the other available areas still load. Dependencies of an available module, such as shared mock files, must still be present.

The existing alert badge and FA1/FA2 base styles live in `src/shared/`; FA1 retains compatibility imports. This removes FA2's dependency on the optional FA1 component folder without changing its screen styling.

Each area's root component stays mounted. FA1's filters/configuration, FA2's investigation/close-out state, and FA3's list filters and per-incident question/answer survive switching areas. Temporary screen demos reset when that screen is left. A full refresh restores the fixtures. Unknown routes or identifiers show an unavailable page instead of substituting another record.

## Current FA1 Features

- **Security sources:** healthy GuardDuty and CloudTrail cards, simulated connection tests, source-filtered alert navigation, and demo scenarios for missing configuration, denied permissions/stale ingestion, and unreachable AWS. Configuration and Retry actions briefly show loading, then recover each source independently.
- **Monitored CloudTrail events:** edit supported events, validate event names, suggest `StopLogging` for `StopLoging`, and prevent saving an empty selection. Cancel discards the draft. A failed-save demo retains the draft and previous configuration; Retry saves successfully.
- **Normalized alerts:** search by ID, event, or principal; combine severity, source, status, and time filters; sort newest first; and paginate six records per page. Separate empty states cover no filter matches and no alerts ingested.
- **Alert details:** keyboard-accessible alert IDs open normalized fields, severity/status badges, incident references, and full UTC timestamps. Raw JSON is formatted and can be copied with success/error feedback. Missing raw events and unavailable alerts have dedicated states.
- **Navigation and layout:** Sources, Alerts, and detail navigation preserve monitored selections and list state. Back to alerts restores the prior filters, page, and alert-button focus. The layout adapts to narrow screens and contains wide tables and JSON in scrollable areas.

## FA1 Demo Guide

Fixtures live in `src/mock/fa1.json`: ten alerts, including `ALT-007` with `rawEvent: null`. Filtering uses the fixed reference **`2026-10-17T16:00:00Z`**, never the real current date. Eight fixture alerts fall within the default **Last 24 hours**; choose **All time** to include all ten.

For each Alerts example below, first click **Alerts**, choose **Alerts demo scenario → Sample alerts**, then **Clear filters**. This clears search, sets Severity/Source/Status to All, and restores **Time range → Last 24 hours**. Both `ALT-002` and `ALT-007` are within that window. **Editor** below means **Sources → Edit monitored events**. Cancel any open editor before navigating elsewhere.

| # | Screen or state | Steps to display it |
| --- | --- | --- |
| 1 | Healthy security signal sources | **Sources → Demo scenario → Healthy**. Both cards show Connected. |
| 2 | Edit monitored CloudTrail events | Open **Editor**. Toggle events; Save changes updates the table/count, while Cancel discards the draft. |
| 3 | Normalized alerts list | Open **Alerts** using the baseline above. Use Previous/Next to browse six records per page. |
| 4 | Alert details with raw JSON | In Alerts, search `ALT-002`, then click **ALT-002**. Use **Copy JSON** or **Back to alerts**. |
| 5 | Source permission denied / stale data | **Sources → Demo scenario → Permission denied / stale data**. The stale successful-ingestion timestamp is shown. **Retry** recovers that source. |
| 6 | Invalid monitored event name | Open **Editor**, enter `StopLoging` under **Add a supported event by name**, then click **Add**. The error suggests `StopLogging`. |
| 7 | No alerts match the filters | In Alerts, search `nothing-matches`. The empty-state **Clear filters** button restores matches. |
| 8 | Raw event unavailable | In Alerts, search `ALT-007`, then click **ALT-007**. Normalized details remain visible; Copy JSON is disabled. |
| 9 | Source not configured | **Sources → Demo scenario → Not configured**. Click **Configure (simulated)** to recover each source. |
| 10 | AWS unreachable | **Sources → Demo scenario → AWS unreachable**. Click **Retry** to recover each source. |
| 11 | No monitored events selected | Open **Editor** and uncheck every event in **Select events to monitor**. Save changes is disabled. |
| 12 | Monitored event save failed | Open **Editor**, leave at least one event selected with no validation error, enable **Demo: simulate a failed save**, and click **Save changes**. After about 0.8 seconds, the error appears. **Retry** succeeds; **Cancel** preserves the previous configuration. |
| 13 | Alert no longer available | Open `ALT-002` as in row 4. Set **Alert details demo scenario → Alert no longer available**. **Back to alerts** works; choosing **Selected alert available** reverses the simulation without changing fixtures. |
| 14 | No alerts available | **Alerts → Alerts demo scenario → No alerts available**. This explains that nothing has been ingested, independently of filters. **View security sources** opens Sources. Return to Alerts and choose **Sample alerts** to restore fixtures and the previous filters/page. |

Source scenarios apply to both cards; recoveries operate independently. Switching scenarios cancels pending recoveries. Changing alert filters resets pagination to page one. Changing demo scenarios does not reset saved monitored selections or alert filters. A source card's **View recent events** action selects that source and resets the other alert filters. The failed-save switch resets when the editor closes, and the unavailable-alert simulation resets when details are reopened.

## FA2 Investigation Prototype

FA2 (Agentic Reasoning & Correlation, owner: Harneet Kaur) lives in `src/fa2/` with fixtures in `src/mock/fa2.json`. It reads the FA1 alert fixtures read-only.

Open it with **Investigations** in the sidebar (or `http://localhost:5173/#/investigations`); **Alerts & Sources** goes back to FA1. From an FA1 alert's details, **Investigate** starts or opens that alert's investigation (with the same threshold and already-running/closed rules), and **Open incident** opens the FA3 incident report. FA2's **Open incident report** link connects the investigation to FA3, and the report links back to the investigation and attack chain.

The agent is simulated: new investigations add one reasoning step about every second and finish with a verdict, confidence score and recommended next steps. No AWS, Bedrock or backend calls are made.

### FA2 Features

- **Start an Alert Investigation:** start from any FA1 alert; low-severity alerts ask for confirmation; an alert with a running investigation opens it instead of starting another; a closed alert shows its result and offers Re-investigate.
- **Investigation View:** progress, gathered evidence, verdict with confidence, and a **Recommended next steps** checklist with quick actions (copy CLI command or message, open filtered trace). Steps can be ticked or marked skipped with a reason.
- **Resolve Alert with Next Steps:** close out as **True positive – escalate**, **Benign** or **False positive**. Benign/False positive need a reason; escalating with unticked steps asks for confirmation; the note is optional. The saved resolution records name, time, note and next-step status.
- **Reasoning Trace:** numbered steps with decision, reason, tool, query, raw result and evidence links; failed steps, too-large results, very long traces and evidence links to events that no longer exist have their own states.
- **Attack-Chain Graph:** events as nodes in time order with technique and "why it is linked"; single-event, branching, still-running, too-large and unmapped-technique states.

### FA2 Demo Guide

Each row maps to a use case extension in the shared Visual Paradigm project and a screen in the FA2 Figma wireframes. Start on **Investigations** (`#/investigations`). **Close-out scenario** is the selector under the close-out buttons on the Overview tab.

| # | Screen or state | Steps to display it |
| --- | --- | --- |
| 0 | Handoff from FA1 | **Alerts & Sources → Alerts**, click **ALT-002**, then **Investigate** (opens INV-001) or **Open incident INC-001**. **ALT-004** shows the below-threshold dialog; **ALT-003** starts a new run. |
| 1 | Investigation View – verdict and next steps | Open **INV-001**. Tick steps, use a quick action, or click **Open filtered trace**. |
| 2 | Reasoning Trace | In INV-001 click **Reasoning Trace**; expand any step. |
| 3 | Attack Chain Graph | In INV-001 click **Attack Chain**; select a node; **View in reasoning trace** jumps to its step. |
| 4 | Below threshold (Start 4a) | Click **Investigate** on `ALT-004` (Low). Choose **Investigate anyway** or **Cancel**. |
| 5 | Already running (Start 3a) | Click **Investigate** on `ALT-006`. INV-003 opens and keeps running. |
| 6 | Already investigated, closed (Start 3b) | Click **Investigate** on `ALT-009`. **Re-investigate** starts a new run. |
| 7 | Investigation started – trace running (Trace 2a) | Click **Investigate** on `ALT-001`, then open **Reasoning Trace** while it runs. |
| 8 | Attack chain still running (Graph 2c) | Start a run as in row 7 and open **Attack Chain** while it runs. |
| 9 | Paused – Bedrock unavailable (Start 6a) | Set **Investigation demo scenario → Amazon Bedrock unavailable**, then **Investigate** `ALT-003`. Click **Retry**. |
| 10 | CloudTrail query failed (Start 7a) | Set the scenario to **CloudTrail query denied**, then **Investigate** `ALT-001` or `ALT-003`. Click **View failed step**. |
| 11 | Failed step / large result / missing event (Trace 3a, 5a, 7a) | In INV-001 Reasoning Trace expand step 7 (failed), step 3 (too large) and step 2 → **Open Last StopLogging…** (no longer available). |
| 12 | Very long trace (Trace 2b) | Reasoning Trace → **Trace demo scenario → Very long trace**. Click **Show all 24 steps**. |
| 13 | Single event (Graph 2a) | Open **INV-002** → **Attack Chain**. |
| 14 | Branching / too large / missing technique (Graph 2b, 2d, 3a) | Attack Chain → **Chain demo scenario → Branching chain** (select `CreateUser`) or **Large chain**. |
| 15 | Needs human review (Resolve 2a) | Open **INV-002**. |
| 16 | Next step skipped (Resolve 4a) | In INV-001 click **Can't do this step** on step 1, enter a reason, **Mark skipped**. |
| 17 | Close as Benign / False positive (Resolve 5a) | In INV-001 click **Benign** or **False positive**; the close button stays disabled until a reason is entered. |
| 18 | Not all next steps ticked (Resolve 5b) | In INV-001 leave a step unticked and click **True positive – escalate**. |
| 19 | Submit without note (Resolve 6a) | Tick every step, click **True positive – escalate**, leave the note empty: **Submit without note**. |
| 20 | Already resolved by someone else (Resolve 7a) | Set **Close-out scenario → Another analyst resolves it first**, then close out INV-001. |
| 21 | Resolution could not be saved (Resolve 7b) | Set **Close-out scenario → Save fails once**, close out INV-001, then click **Retry** in the banner. |

State is held in React and resets when the page is refreshed. Switching between FA1 and FA2 in the sidebar keeps each area's state.

## FA3 Dashboard & Ask-the-Agent Prototype — M16

Owner: Mattias Kerner. Screens live in `src/fa3/`, and all FA3 incident records, stored evidence, source snapshots, and canned answers live in `src/mock/fa3.json`. The feature branch is `feature/fa3-screens`.

- **Dashboard:** incident counts, incidents needing attention, source-health snapshot, and navigation to all areas.
- **Incident list:** combined ID/title search, severity and status filters, highest-severity/newest-first ordering, and four records per page. Filters and page survive report review.
- **Incident report:** selected incident identity, status, findings, recorded timeline, evidence, attack-chain explanation, and uncertainty. Generating, unavailable, failed-load, and human-review states remain distinct.
- **Ask the Agent:** incident-specific suggested questions, text input, pending state, canned responses, and citations. Whitespace questions are rejected. Unsupported questions produce a limitation, and candidate answers with invalid citations are withheld. A timeout preserves the question and offers Retry.
- **Evidence inspection:** select a citation to open an accessible dialog with source, event time, principal, raw JSON, and a link to the normalized FA1 alert. Escape/Close returns focus to the citation. Missing or foreign evidence is never substituted; temporary errors can be retried, and large previews can be read in bounded segments.

`INC-001` and `INC-002` correspond to the existing `INV-001` and `INV-002`. FA3 preserves the repo's `ALT-*` identifiers, timestamps, principals, and raw events, which differ from older VP illustration data. `INC-001`'s title describes the demonstration scenario; the report explicitly distinguishes the candidate chain from proof that the same key or actor caused every event. Its first two events share an IP but have different principals/keys, and its GuardDuty event has another principal/IP.

Four additional records named `INC-DEMO-*` demonstrate pagination, closed incidents, and generating/limited reports. They are labelled as FA3-only fixtures and do not pretend to have shared FA2 investigations. Source-health and report data are fixed snapshots: an FA1 recovery simulation or FA2 close-out does not rewrite FA3's fixtures.

### FA3 Demo Guide

Open **Demo scenarios** on the relevant screen to expose its selector. Unless stated otherwise, start from `#/incidents/INC-001`. This guide supports a later team rehearsal; it does not mean M17 has been completed.

| # | Screen or state | Steps to display it |
| --- | --- | --- |
| 1 | Dashboard | Open `#/`. **View all incidents** opens the list; **Needs human review** applies that status filter. |
| 2 | Incident list, filters, pagination | Open `#/incidents`. Select Severity **High** and Status **Open**. Clear filters, then **Next** to see the remaining records. |
| 3 | No matching incidents | Set Severity to **Critical**, or search `nothing-matches`. **Clear filters** restores the sample list. |
| 4 | Empty portfolio / load failure | **Incident list demo scenario → No incidents available** or **Incident load failed**. Empty Refresh keeps the empty fixture; error Retry recovers while keeping filters. |
| 5 | Report and evidence | Open `INC-001`; inspect a timeline evidence item. **View investigation** opens `INV-001`; **Open attack-chain graph** opens FA2's matching graph. |
| 6 | Report generating | **Incident report demo scenario → Report generating**, or open `INC-DEMO-003`. **Refresh report** retains generating state; it never invents a completed report. |
| 7 | Failed report / unavailable incident | Choose **Report load failed**, then **Retry report**. Choose **Incident unavailable**, or navigate to an unknown incident ID, to see the unavailable state. |
| 8 | Human review / no chain | Open `INC-002`, or use **Needs human review** / **No supported attack chain** in the report selector. |
| 9 | Cited answer | **Ask the Agent → What shows that logging was disabled? → Ask question**. Pending appears briefly, then an answer with **View citation E2**. |
| 10 | Empty / out-of-scope / unsupported question | Submit whitespace; ask `Disable logging now`; or ask an unscripted question. Each produces an explanation without invented citations. |
| 11 | Agent timeout and retry | **Answer demo scenario → Agent timeout**, submit a suggested question, then **Retry answer**. The same question receives its canned answer. |
| 12 | Insufficient evidence / invalid candidate | Choose **Insufficient evidence** or **Candidate has invalid citations**, then submit a suggested question. No supported answer is presented. |
| 13 | Partial answer | On `INC-001`, choose **What disabled logging, and was data copied?** with the normal scenario. The logging claim is cited and the exfiltration question remains explicitly unanswered. |
| 14 | Incident becomes unavailable | **Answer demo scenario → Incident becomes unavailable**. A route back to the list appears and no answer is produced. |
| 15 | Evidence states | After obtaining a normal answer, set **Evidence demo scenario** to missing, temporary error, foreign citation, or segmented preview, then select **View citation E2**. Error Retry succeeds; the preview's Next/Previous controls preserve the evidence ID. |
| 16 | Return paths and isolation | Close evidence, return to the report, then reopen Ask. The question and answer remain. Switch to `INC-002`: it has its own question/answer context. |

Only the suggested questions (ignoring case, surrounding whitespace, and trailing punctuation) have canned factual answers. This is a UI prototype, not an AI question-answering service. No AWS, Bedrock, or backend calls are made.

## Current Limitations and Planned Work

- Data is fictional. Connection tests, configuration, recovery, and save-failure actions are simulated; source scenarios do not alter the alert fixtures or generate live events.
- State is held locally in React and resets on refresh. There is no server-side persistence or authentication; “SOC Analyst” is a prototype label.
- `src/shared/AppLayout.jsx` and React Router provide the team shell. The previous FA1-only `#/` entry now opens Dashboard; use `#/sources` for FA1.
- Backend services, live AWS ingestion, AI reasoning/correlation, and generated incident reports remain planned work. Displayed reports and answers are static fixture content.
- Copy JSON depends on browser clipboard support and permission. If copying fails, the JSON remains available for manual copying.

## Project Resources

- Source code: https://github.com/AlertChain-Capstone/alertchain-agent
- Jira: https://alertchain-agent.atlassian.net
- Requirements, use cases, domain model, and wireframes:
  maintained in the team's shared Visual Paradigm project.
