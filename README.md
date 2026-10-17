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

The current `feature/fa1-screens` branch implements the FA1 frontend prototype using fictional mock data. It is a runnable slice of the planned team application, not the complete application.

Implemented FA1 screens cover security signal sources, monitored event configuration, normalized alert browsing, and alert details. A reusable temporary layout provides the AlertChain Agent header and sidebar.

Investigation, incident dashboard, and Ask-the-Agent views remain planned work. Live AWS ingestion, AI investigations, and backend integration are also planned.

## Technology

- Current frontend: React 19, plain CSS, Vite 8, and ESLint 10
- Planned backend: FastAPI
- Planned cloud services: Amazon GuardDuty, AWS CloudTrail,
  Amazon EventBridge, AWS Lambda, Amazon API Gateway,
  Amazon DynamoDB, Amazon Bedrock, and Amazon CloudWatch

## Setup and Run Instructions

Install Git, Node.js, and npm. The tooling locked in `package-lock.json` supports Node.js **`^20.19.0 || ^22.13.0 || >=24`**: Node 20.19+ within the 20.x line, Node 22.13+ within the 22.x line, or Node 24+. The Node 22 minimum comes from ESLint; Vite alone accepts 22.12+.

```sh
git clone https://github.com/AlertChain-Capstone/alertchain-agent.git
cd alertchain-agent
git switch feature/fa1-screens
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

## Current Limitations and Planned Work

- Data is fictional. Connection tests, configuration, recovery, and save-failure actions are simulated; source scenarios do not alter the alert fixtures or generate live events.
- State is held locally in React and resets on refresh. There is no server-side persistence or authentication; “SOC Analyst” is a prototype label.
- Dashboard, investigation, and incident handoffs await FA2/FA3 integration. Investigate and Open incident controls are intentionally disabled with explanations; no investigation runs.
- The temporary FA1 layout can later be replaced by the team's shared layout. The full team application and planned backend architecture are not complete.
- Backend services, live AWS ingestion, AI reasoning/correlation, and evidence-based incident reports are planned work, not implemented features of this prototype.
- Copy JSON depends on browser clipboard support and permission. If copying fails, the JSON remains available for manual copying.

## Project Resources

- Source code: https://github.com/AlertChain-Capstone/alertchain-agent
- Jira: https://alertchain-agent.atlassian.net
- Requirements, use cases, domain model, and wireframes:
  maintained in the team's shared Visual Paradigm project.
