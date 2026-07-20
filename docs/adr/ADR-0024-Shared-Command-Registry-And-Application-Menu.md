# ADR-0024: Shared Command Registry and Application Menu

## Status

Accepted 2026-07-20 on issue
[#533](https://github.com/qwts/photos/issues/533). This decision governs the
command infrastructure shared by #399, #504, #510, #531, #532, and #534. The
living exposure inventory and initial menu hierarchy are maintained in the
[Application Menu Exposure Policy](../Application-Menu-Exposure-Policy.md).

## Context

Overlook currently has no native application menu and no command registry.
Global keys are an inline renderer `keydown` handler; toolbar buttons, context
menus, reducer actions, and service calls each own their labels, state, and
execution independently. That works while surfaces are few, but it cannot
support native menus, shortcut discovery, configurable Quick Actions, or
consistent destructive language without drift.

The process boundary matters. Electron owns native menus in the main process,
while selection, route, modal, and focus context live primarily in the
renderer. Copying handlers into main would fork behavior. Trusting a renderer
enablement snapshot would let stale state bypass lock, target, or destructive
checks. The registry must share identity and policy without pretending one
process owns all runtime context.

ADR-0020 anticipated this point: when an application menu lands, main becomes
a catalog consumer through the same ICU catalogs. ADR-0023 separately requires
one destructive-action descriptor registry and main-process authorization for
irreversible operations. This decision composes with both contracts.

## Decision

### 1. One typed registry defines every command

We will maintain one process-neutral registry under `src/shared/commands/`.
Every application command has a stable namespaced ID and one descriptor for
its localized label, allowed surfaces, target kind, shortcut policy, state
requirements, and destructive descriptor when applicable.

Descriptors are declarative. They contain no React components, Electron
objects, mutable state, or service closures. Main and renderer adapters supply
context and execution. Buttons may remain components, but they invoke a
registered command ID instead of duplicating command policy.

OS-owned operations such as Cut, Copy, Paste, Hide, Minimize, and Quit remain
Electron roles. They are projected beside application commands but are not
reimplemented in the registry.

### 2. Surfaces are projections, not owners

The native application menu, keyboard dispatcher, shortcut-help overlay,
context menus, toolbars, and Quick Actions project the same descriptors. A
surface may show a subset, but it may not rename, rebind, or independently
implement a command.

Eligibility is explicit per surface. A command is not added to the native menu
merely because it exists. The living policy applies platform convention,
stable meaning, deterministic targeting, stale-state safety, and
cross-surface parity before granting native-menu eligibility.

### 3. Context resolution is deterministic and revalidated

Commands target one of application, focused window, route, focused item, or
intentional selection. The focused window owns navigation and checked state.
Focused-item commands prefer an explicit lightbox/focus target; selection
commands require a non-empty intentional selection. Ambiguous targets disable
the command with a reason and never fall back silently.

Menu enablement is presentational. The executing adapter resolves context
again immediately before mutation and rechecks lock, library availability,
active work, modal state, target existence, and service authorization. Main
retains final authority for process-owned, privileged, and destructive work.
ADR-0023 ceremonies and acknowledgments remain mandatory regardless of entry
surface.

### 4. Main and renderer exchange typed state and invocation messages

The renderer publishes a bounded command-context snapshot for the focused
window: route, modal/focus class, target cardinality, and checked/availability
facts. It contains IDs and booleans, not filenames, search text, photo
metadata, secrets, or protected-domain contents.

Main uses that snapshot to render native state and sends a command ID plus
window identity when invoked. The receiving adapter re-resolves the target and
either executes, routes to the owning process, or returns a typed unavailable
result. A readiness handshake queues only idempotent route commands for a new
or restoring window; mutation commands are never queued across readiness or
unlock boundaries.

### 5. Native hierarchy follows each platform

macOS uses conventional Overlook, File, Edit, View, Photo, Window, and Help
menus. Windows and Linux place app-level commands under File, Tools, and Help.
Command identity and behavior stay constant; placement and OS roles may vary.

Application menu labels use ADR-0020's ICU catalogs in main. Shortcut display
and native accelerators are generated from registry bindings. Non-US layout,
editable-field precedence, modal precedence, and conflict tests are required
before assigning an application accelerator.

### 6. Lock, privacy, and telemetry fail closed

While locked, menus expose only commands explicitly declared lock-safe, such
as About, Help, Settings/Privacy entry, library-registry switching, unlock,
and Quit. Checked labels, disabled reasons, and context snapshots must not
reveal library names, photo counts, selection contents, protected-album state,
or recent activity.

Command telemetry is absent by default. A descriptor may opt into a reviewed
event name, but payloads never include target names, paths, search text,
library metadata, or command-context snapshots. Diagnostic clearing and every
destructive command remain governed by their stricter ADRs.

### 7. Extension points are named and bounded

Future plugins may request documented slots using registered command IDs.
They may not submit arbitrary menu templates, shadow core IDs or shortcuts,
contribute OS roles, or extend lock/profile/destructive-authorization
sections. Unknown or over-budget slots are rejected deterministically. Core
menus remain useful when every extension is absent or disabled.

## Consequences

- **Easier:** labels, shortcuts, enablement, accessibility names, and handlers
  can be tested once and projected consistently; the native menu does not fork
  renderer behavior; shortcut help becomes generated evidence rather than a
  second list.
- **Safer:** stale native state cannot authorize a command, locked menus do not
  leak content, and destructive ceremonies remain below every surface.
- **Harder:** the registry and typed bridge must exist before #531, #504, or
  #532 can finish; focused-window snapshots require lifecycle discipline; OS
  roles and application commands need separate adapters.
- **Deferred:** persisted edit/variant commands (#510 and #493), plugin loading,
  and user-remappable shortcuts. Their future implementations must extend this
  registry rather than introduce parallel command systems.
- **Revisit when:** the app gains multiple independent content windows, a
  plugin runtime, user shortcut editing, or a non-Electron shell. The stable
  command IDs and process-neutral descriptors must survive those changes even
  if adapters and placement do not.
