# Agent Note: Recover the owned Electron Host without closing the application

Status: implemented

English | [中文](2026-08-20-recover-owned-electron-host.zh.md)

## Problem

The Electron main process treated every unexpected exit of its owned `dsh web` child as an application-fatal event. It synchronously displayed an error box and then called `app.quit()`, so acknowledging the error closed every window even when a fresh local Host could start against the same state. Output retained during readiness was discarded afterward, which also left a post-readiness crash without bounded diagnostics.

## Decision

The Electron shell keeps the existing window alive when the active Host exits. It replaces the unavailable loopback page with a script-free local recovery state and uses a rolling-window restart policy: at most two automatic attempts in one minute, delayed by 300 milliseconds and one second. A successful replacement becomes the only active owned Host and the window loads its newly validated loopback origin.

When the automatic budget is exhausted, the native dialog offers explicit actions to restart the Host, copy diagnostics, or quit. A manual restart failure returns to the same decision instead of exiting or looping automatically. The process wrapper retains a 16 KiB combined stdout and stderr tail for its full lifetime, removes credential-shaped headers, assignments, bearer values, and URL parameters before forwarding or retaining output, and never sends the diagnostics into the Host renderer.

Normal application shutdown remains separate from crash recovery. It cancels further recovery, asks the current owned child to stop, waits for process quiescence, and only then completes the Electron quit.

## Alternatives considered

**Keep the error box followed by an unconditional quit.** Rejected because a local child failure does not imply that the Electron application or its durable state is unusable, and the acknowledgement button falsely appeared to offer recovery while it only delayed the forced exit.

**Restart forever with a fixed delay.** Rejected because a deterministic startup failure would create an unbounded child-process loop and hide the condition from the user. The rolling budget recovers transient failures while preserving an explicit terminal decision.

**Render raw child output in the Web application.** Rejected because the unavailable Host cannot own its own failure UI and raw output can contain credentials. The Electron owner retains a bounded, redacted tail and exposes it only through an explicit native copy action.

## Consequences

A transient Host crash no longer destroys the desktop session or forces the user to reopen the application. Repeated crashes remain bounded, observable, and user-controlled, while ordinary quit continues to prevent an orphaned Host.

The recovery page is intentionally minimal and local; it cannot offer normal DSH features until a replacement Host is ready. Redaction covers common credential shapes rather than arbitrary secrets, so application logging must still avoid writing sensitive values in the first place.
