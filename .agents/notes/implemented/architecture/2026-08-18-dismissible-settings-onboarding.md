# Agent Note: Dismissible settings onboarding

Status: implemented

English | [中文](2026-08-18-dismissible-settings-onboarding.zh.md)

## Problem

The settings onboarding coordinator exposed only `complete()`, which transferred ownership to the next registered step, and `openSection(id)`. A feature could skip its own setup but could not let the user close the entire first-run sequence. Treating a modal close as `complete()` merely opened the next provider step, while keeping the close inert left the user inside a blocking dialog with no complete exit path.

The coordinator owns which step is active, so a registrant cannot correctly suppress steps it does not own. Feature-local workarounds would either encode knowledge of other steps or leave the coordinator believing onboarding was still active.

## Decision

`SettingsOnboardingOwnerProps` includes `dismiss()`. The settings shell implements it by suppressing every remaining step for the current empty-session onboarding pass. `complete()` retains its narrower meaning and advances only the current step; `openSection(id)` still opens one settings section.

The dismissed state is component-local viewing state, like the coordinator's completed-step set. It resets when the empty-session onboarding condition ends, so a later genuinely new empty-session pass may offer onboarding again. Registrants continue to own their visible modal, copy, readiness, and durable feature-specific completion facts.

## Alternatives considered

**Treat close as `complete()`.** Rejected because it advances into the next step instead of honoring the user's request to leave onboarding.

**Let one registrant complete every known step.** Rejected because a feature neither owns nor has visibility into the full onboarding ledger.

**Persist a product-wide dismissed flag.** Rejected because the requested behavior is dismissal of the current pass, while durable feature completion remains registrant-owned. A global durable flag would also prevent later onboarding after the session lifecycle genuinely resets.

## Consequences

Every onboarding feature can now provide a close button or configure-later action with one generic owner callback. The shell remains free of feature copy and business rules, and `complete()` remains safe for flows that intentionally continue to the next provider option.

Dismissal does not declare any provider configured and does not write settings. It lasts until the current empty-session onboarding condition ends or the shell unmounts.
