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

## Inception Release

The Inception release focuses on a navigable UI prototype using hardcoded mock data.

Planned prototype screens cover:
- Security signal source status
- Monitored event configuration
- Normalized alert browsing and alert details
- Investigation, incident dashboard, and Ask-the-Agent views

Live AWS ingestion, AI investigations, and backend integration are planned for later releases.

## Technology

- Frontend: React
- Planned backend: FastAPI
- Planned cloud services: Amazon GuardDuty, AWS CloudTrail,
  Amazon EventBridge, AWS Lambda, Amazon API Gateway,
  Amazon DynamoDB, Amazon Bedrock, and Amazon CloudWatch

Frontend build tooling will be documented once the shared React application is configured.

## Setup and Run Instructions

The repository currently contains project documentation.
Installation and run instructions will be added and verified
when the prototype code is available.

## Project Resources

- Source code: https://github.com/AlertChain-Capstone/alertchain-agent
- Jira: https://alertchain-agent.atlassian.net
- Requirements, use cases, domain model, and wireframes:
  maintained in the team's shared Visual Paradigm project.
