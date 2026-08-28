# Technical Specification Document

## Testate: Git for your test database (PT. Perkasa Pilar Utama)

**Version:** 1.0.0  
**Date:** 2026-08-28  
**Author:** Tech Lead  
**Status:** Draft for review  
**Phase:** 1  

---

## Table of Contents

1. [Overview](01-overview.md)
2. [System Architecture](02-system-architecture.md)
3. [Repository Structure](03-repository-structure.md)
4. [Tech Stack](04-tech-stack.md)
5. [Module Definitions](05-module-definitions.md)
6. [Data Model](06-data-model.md)
7. [Security](07-security.md)
8. [Non-Functional Requirements](08-non-functional-requirements.md)
9. [Authentication and Authorization](09-authentication.md)
10. [Integration Points](10-integration-points.md)
11. [Environment Configuration](11-environment-configuration.md)
12. [Engine Port](12-engine-port.md)
13. [Checkout and Restore](13-checkout-and-restore.md)
14. [Schema Fingerprint](14-schema-fingerprint.md)
15. [Snapshot Store](15-snapshot-store.md)
16. [Jobs Runtime](16-jobs-runtime.md)
17. [Sealed Values](17-sealed-values.md)
18. [Outbound Address Policy](18-outbound-address-policy.md)
19. [Import Pipeline](19-import-pipeline.md)
20. [Diff Engine](20-diff-engine.md)
21. [Wide-Event Logging](21-wide-event-logging.md)
22. [Base Path and Boot](22-base-path-and-boot.md)
23. [Agent Access](23-agent-access.md)
24. [Table Editing, Policies, and Fixtures](24-table-editing.md)

Documents 12 to 24 are ad-hoc specifications: each is the single source of truth for its concern. Other documents and task cards cite them and do not restate them.

---

## Companion Documents

| Document | Purpose |
| --- | --- |
| [../PRD.md](../PRD.md) | Product source of truth: problem, solution, roles, glossary, user stories, decisions |
| [../adr/](../adr/) | Architecture decision records with alternatives (0001: the `DbEngine` interface) |
| [../GLOSSARY.md](../GLOSSARY.md) | Domain terms |
| [../CODING_STANDARD.md](../CODING_STANDARD.md) | Enforced coding rules (seed today; full standard after the scaffold) |
| [../CODE_REVIEW_CHECKLIST.md](../CODE_REVIEW_CHECKLIST.md) | PR review checklist |
| [../api-specs/](../api-specs/) | Endpoint-level API specification |
| [../TASK_BREAKDOWN.md](../TASK_BREAKDOWN.md) | Sprint plan with owners |
| [../DEPLOYMENT_PLAN.md](../DEPLOYMENT_PLAN.md) | Image, compose, nginx, upgrade, backup and restore runbook |
| [../KEY_ROTATION.md](../KEY_ROTATION.md) | Operator procedure for the active key list |
| [../AGENT_ACCESS.md](../AGENT_ACCESS.md) | Connecting an AI agent through MCP |
| [../TROUBLESHOOTING_GUIDE.md](../TROUBLESHOOTING_GUIDE.md) | Known issue runbook |
| [../ONBOARDING_GUIDE.md](../ONBOARDING_GUIDE.md) | New developer setup |
| [../README.md](../../README.md) | Project front page |
