# Forest Fire Detection & Response — Mobile UI Design Specification

## 1. Purpose

Design the **React Native / Expo mobile app** for forest officers and field staff working in Tadoba-Andhari Tiger Reserve. The interface takes visual inspiration from the supplied ride-booking screenshots: a map-dominant canvas, floating map controls, rounded bottom sheets, compact information cards, and one clear primary action.

Adapt the layout for forest operations. Do not copy ride-booking branding, fares, driver cards, or ride-booking interactions.

**Primary requirement:** The app must remain useful without mobile internet. Offline maps, locally stored node coordinates, locally saved reports, and locally triggered alarms are core features—not later visual additions.

This file describes visual design and screen behavior. `flow.md` defines the broader system workflow and backend behavior.

---

## 2. Design principles

1. **Map first:** The Tadoba map is the main visual surface on the Home and Map screens.
2. **Alert first:** A newly received fire alert must take priority over ordinary navigation and cards.
3. **Offline is visible:** Always make connectivity, data freshness, and sync state understandable.
4. **One main action per screen:** Use a strong primary action such as `Report fire`, `Acknowledge alert`, or `Open incident`.
5. **Large field-friendly controls:** Use touch targets of at least 48 dp where practical, with clear labels and enough spacing for outdoor use.
6. **High contrast:** Forest lighting conditions vary. Avoid low-contrast text over map tiles or photographs.
7. **No misleading status:** An old node status must be labelled stale or unknown, never presented as live.
8. **Fast to scan:** Show incident status, time, location, and source before secondary metadata.
9. **Accessible alarm controls:** An acknowledgement must not silently imply that the fire is resolved.
10. **Progressive detail:** Keep the map uncluttered; place deeper information in bottom sheets and detail screens.

---

## 3. Visual direction

### Reference-derived layout

- Full-screen map behind the interface.
- Floating round menu/back/location buttons.
- Small map status chips.
- Rounded white/off-white bottom sheets that overlap the lower part of the map.
- Compact cards with an icon, title, subtitle, status, and one obvious action.
- A bold, high-visibility lime accent for primary actions, inspired by the supplied screenshots.
- A darkened map overlay when a critical alert demands attention.

### Forest-response identity

Use a restrained forest palette rather than a generic transport-app look.

| Token | Suggested value | Usage |
|---|---|---|
| `forest-900` | `#12352A` | Main brand, dark headers |
| `forest-700` | `#245642` | Secondary actions, map labels |
| `forest-100` | `#EAF2E8` | Soft background surfaces |
| `accent-lime` | `#C7F000` | Main CTA, selected state |
| `alert-red` | `#D92D20` | Fire alert and critical states |
| `warning-amber` | `#F4B740` | Potential alert / caution |
| `info-blue` | `#2879D0` | GPS/current position |
| `success-green` | `#16834A` | Verified healthy/complete state |
| `neutral-950` | `#18211D` | Main text |
| `neutral-700` | `#4B5751` | Secondary text |
| `neutral-300` | `#D5DDD7` | Borders/dividers |
| `surface` | `#FFFFFF` | Cards and sheets |
| `canvas` | `#F4F6F2` | Screen background |

Treat these as design tokens, not hard-coded values scattered throughout the app. Support a dark/low-light theme later if field testing shows it is useful.

### Typography

- Use **Inter** if it is already included in the project; otherwise use a consistent platform sans-serif.
- Screen title: 22–26 sp, semibold/bold.
- Section title: 16–18 sp, semibold.
- Body: 14–16 sp.
- Secondary metadata: 12–14 sp.
- Critical alert title: 24–30 sp, bold.
- Avoid long all-caps labels.
- Do not encode status through color alone; pair color with text and an icon.

### Shape and spacing

- Screen horizontal inset: 16 dp.
- Standard gap: 8 dp.
- Card gap: 10–12 dp.
- Card radius: 18–24 dp.
- Bottom-sheet top radius: 26–32 dp.
- Buttons: 14–18 dp corner radius.
- Floating round controls: 44–52 dp.
- Minimum practical touch target: 48 × 48 dp.
- Use subtle borders and restrained shadows; avoid excessive glass effects and gradients.

---

## 4. Navigation structure

Use Expo Router or the navigation structure already present in the project. Do not introduce a second navigation system.

Suggested bottom navigation for normal app use:

1. **Home** — overview and map preview.
2. **Map** — full Tadoba offline map and all configured nodes.
3. **Alerts** — current and previous alerts.
4. **Reports** — reports created by the user and assigned incidents.
5. **Profile** — account, permissions, offline data, and settings.

Use icons with text labels. Keep bottom navigation hidden or visually secondary on the full-screen critical-alert experience. A critical alert must not be hidden behind the normal navigation.

Suggested route names:

- `/` or `/home`
- `/map`
- `/alerts`
- `/reports`
- `/report/new`
- `/incidents/[id]`
- `/profile`
- `/offline-data`
- `/alert/active` (or an equivalent full-screen modal/overlay)

---

## 5. Screen specifications

## Screen A — Home / field overview

### Layout

**Top area**
- Small header with app mark/name: `Tadoba Forest Watch`.
- Right-side offline/connection badge.
- Profile/avatar button if needed.
- Avoid a tall marketing header; preserve screen space for the map.

**Main map preview**
- Approximately 45–60% of available screen height on a typical phone.
- Show the cached Tadoba map.
- Show the user's GPS position if permission and a valid fix are available.
- Show node markers with a compact legend.
- Floating buttons: `Locate me`, `Layers`, and a menu/settings control if needed.
- Small chip such as `Offline map ready` or `Map data: updated 09 Oct`.
- Tap the map to open the full Map screen.

**Bottom sheet**
- Rounded top corners, white surface.
- Heading: `Field overview`.
- Summary chips/cards:
  - `Active alerts`
  - `Nodes offline`
  - `Pending reports`
- Each count must come from local data and show its freshness/source. Do not imply a count is current if the device is disconnected.
- Primary action: `Report fire`.
- Secondary action: `View alerts`.
- Optional `Assigned to me` list for staff roles.

### Interactions

- `Report fire` opens the report form.
- `View alerts` opens the alert list.
- Map tap opens the full map.
- If offline, show a concise banner: `Offline · Showing saved data`.
- If no map is downloaded, show an explicit download/setup state rather than an empty map.

---

## Screen B — Full offline Tadoba map

This is a core screen and should visually follow the first reference image: map as the background, floating controls, and a bottom information panel.

### Map content

- Cached map tiles for the approved Tadoba coverage area.
- Forest boundary and relevant compartments/zones, if authoritative GIS data is available.
- Known roads/tracks and operational landmarks, where permitted.
- Every configured node with a unique ID and coordinate.
- Current GPS position, heading if available, and GPS accuracy.
- Incident markers for locally known incidents.
- Cluster markers at low zoom levels to avoid covering the map with overlapping pins.

**Important:** Do not invent node coordinates or forest boundaries. Use supplied field data or clearly labelled mock data during development. Include a data-source and last-updated timestamp.

### Node marker states

Use distinct icon + label combinations:

- **Healthy / recently heard from:** green dot + `Online`.
- **Potential fire:** red/orange flame marker + `Potential alert`.
- **Fire verified:** strong red marker + `Verified fire`.
- **Offline/stale:** grey marker + `Offline` or `Last seen 2 h ago`.
- **Unknown:** outlined neutral marker + `Status unknown`.

Online/stale thresholds must be configured from the communication system; do not choose a threshold and present it as a real operational standard.

### Floating controls

- Top-left: menu/back.
- Top-center or top row: offline state and map freshness.
- Top-right: layer selector.
- Bottom-right: `Locate me`.
- Optional map legend button.
- Controls should have opaque surfaces so they remain visible on light and dark map tiles.

### Bottom sheet — selected node

When a node marker is tapped, show a compact rounded sheet containing:

- Node name/ID.
- Node type: camera, sensor, gateway, or other configured type.
- Status and last received timestamp.
- Battery/signal details only when provided by the device.
- Coordinates and location accuracy if relevant.
- Latest alert or observation, if present.
- Actions: `View node`, `View related alert`.
- Never display a fake live camera preview if no image is available.

When no node is selected, show a collapsed sheet with `Tadoba nodes`, node count, active alerts, and a search/filter affordance.

### Filters and layers

- All nodes.
- Potential fire alerts.
- Verified incidents.
- Offline/stale nodes.
- Forest zones/compartments.
- Operational paths/landmarks where data is available.

Include a search by node ID/name. Filtering must operate on locally stored data while offline.

---

## Screen C — Active fire alert (critical full-screen state)

This is the highest-priority screen. Use a clear red alert surface or red header with a dimmed map behind it. Do not rely on animation alone.

### Layout

1. Large flame/siren icon.
2. High-contrast heading: `POTENTIAL FIRE ALERT` or `VERIFIED FIRE`, according to actual status.
3. Alert received time and source.
4. Location/coordinates and GPS/map action.
5. Distance and direction from the user's current position only when calculated from valid coordinates.
6. Node ID and evidence status.
7. Large buttons:
   - `Acknowledge alert`
   - `View location`
8. A clear note such as `Automated detection — verification required` when not yet confirmed.

### Behavior

- An alert received through a supported local communication channel must be persisted locally before or as part of triggering the user interface.
- Trigger vibration and a configured alarm sound using a native-supported mechanism.
- Make the alert visible even if the user is currently on another app screen.
- If the operating system permits the app to present the alert while backgrounded, use the appropriate Android notification/foreground mechanism. Test locked-screen behavior on the target device.
- `Acknowledge alert` records that the user saw it; it does not resolve or verify the fire.
- Provide a clearly accessible way to silence the sound while retaining the alert and acknowledgement state.
- Avoid endless uncontrolled alarm loops. Use a defined repeat policy, explicit stop/silence action, and respect platform restrictions.
- A locally received alert must still be shown if the phone has no internet.
- If the alert is received by the server but no message reaches the disconnected phone, the app cannot know about it. The UI must not imply otherwise.

### Alarm limitations

A normal JavaScript timer is not sufficient for reliable background alarms. Implement and test native Android notification/audio/vibration behavior, app lifecycle handling, battery restrictions, notification permissions, and sound-channel settings. Exact behavior depends on Android version and device configuration. Do not claim guaranteed delivery in every locked-screen or force-stopped state.

---

## Screen D — Alerts list

### Layout

- Header: `Alerts`.
- Summary row for unresolved, verified, and acknowledged alerts.
- Filter chips: `All`, `Potential`, `Verified`, `Acknowledged`, `Closed`.
- Alert cards with:
  - Status icon and text.
  - Node/incident ID.
  - Location label or coordinates.
  - Received/observed time.
  - Source: sensor, camera model, staff report, or other source.
  - Freshness/sync badge if relevant.

### Card interaction

- Tap a card to open Incident Details.
- Use a visible border/icon for high-priority alerts.
- Do not show the same alert repeatedly as a new alert after every synchronization.
- Merge or link related observations where backend rules determine they belong to the same incident.
- Sort by a documented combination of status and time, not arbitrary list order.

### Empty and offline states

- No alerts: `No saved alerts` plus last-sync information.
- Offline: `Showing alerts saved on this device`.
- Never phrase the empty state as `No fire in Tadoba`.

---

## Screen E — Report fire

Follow the reference's bottom-sheet/card style, but make field data entry fast.

### Form fields

1. **Location**
   - Current coordinates if a valid GPS fix is available.
   - Accuracy indicator.
   - `Choose on map` alternative.
   - Manual description as a fallback.
2. **What do you see?**
   - Smoke.
   - Visible flames.
   - Burning vegetation.
   - Uncertain / other.
3. **Photo evidence**
   - Optional camera/gallery attachment.
   - Preview and remove action.
4. **Time observed**
   - Default to current device time.
   - Allow correction if the event was observed earlier.
5. **Additional notes**
   - Optional short text.

### Primary action

`Review report` → review screen → `Save report`.

If online, submit to the server and show the returned reference/status. If offline, save it locally and show `Saved on this device · Pending sync`.

Do not show `Report submitted` as if the server received it when it has only been stored locally.

### Error states

- GPS unavailable.
- Permission denied.
- Photo capture failed.
- Storage unavailable.
- Upload failed.
- Report queued offline.
- Server rejected invalid data.

Errors must preserve entered information where possible.

---

## Screen F — Incident details

### Layout

- Header with incident ID and status.
- Map preview with marker.
- Location, coordinates, and accuracy where available.
- Status/source/time information.
- Evidence card with image preview or `No image evidence available`.
- Automated detection result clearly separated from human verification.
- Timeline of observations and actions.
- Assigned team and notes, if the role has access.
- Large, role-appropriate action buttons.

### Role-based actions

Possible actions, depending on permissions:

- Acknowledge alert.
- Add observation.
- Add photo evidence.
- Mark arrival / update response progress.
- Assign team.
- Verify or dismiss alert.
- Mark contained or close incident.

The backend must enforce authorization. Hiding a button in the app is not a security control.

---

## Screen G — Reports / assigned incidents

- Segmented tabs: `My reports` and `Assigned`, where supported.
- Compact cards with status, location, and time.
- Clear distinction between local sync state and incident lifecycle:
  - `Pending sync`
  - `Synced`
  - `Sync failed`
- Filter by status.
- Tap to open report/incident details.
- Preserve locally saved drafts after navigation away from the form.

---

## Screen H — Offline data and map management

A dedicated screen is required because the map must work without internet.

### Display

- Coverage pack: `Tadoba-Andhari`.
- Downloaded map size and version.
- Last successful map update.
- Number of locally stored nodes.
- Number of locally stored incidents.
- Pending report/evidence count.
- Storage usage and available device storage, where supported.

### Actions

- `Download/update Tadoba map` while connected.
- `Check data version`.
- `Retry pending sync`.
- `Clear temporary cache` with a confirmation.
- Do not allow a user to accidentally delete the only copy of unsynced reports.

### Offline data bundle

Package or cache these items before field deployment:

- Map tiles for the approved operating area and required zoom levels.
- Forest boundary and operational GIS overlays from authorized data.
- Node IDs and coordinates.
- Last known node metadata/status and timestamps.
- Incident records the user is permitted to access.
- Essential app configuration and reference lists.

Map tiles, node records, and incident records are separate data sets and need separate version/freshness indicators. Downloading map tiles does not download live node status.

Use a map library that supports the selected offline tile workflow and review the tile provider's terms. Do not bulk-download public map tiles unless the provider explicitly permits it. For a real deployment, use an approved offline tile package or an authorized tile source.

---

## Screen I — Profile and settings

- User name and role.
- Sign-in status.
- Notification permission and sound/vibration settings.
- Location permission status.
- Offline data link.
- Sync status and last successful sync.
- App version.
- Sign out.

Do not let the user accidentally disable all critical alert behavior without a clear warning and an appropriate policy for the deployment. Respect Android permission controls and the user's system settings.

---

## 6. Reusable components

Build reusable components rather than creating a new visual pattern for every screen.

Suggested component names:

- `AppHeader`
- `ConnectionStatusChip`
- `OfflineStatusBanner`
- `MapControlButton`
- `NodeMarker`
- `NodeStatusBadge`
- `IncidentStatusBadge`
- `IncidentCard`
- `NodeSummaryCard`
- `BottomSheet`
- `PrimaryButton`
- `SecondaryButton`
- `EmptyState`
- `ErrorState`
- `LoadingState`
- `SyncQueueBanner`
- `AlertOverlay`
- `EvidencePreview`
- `TimelineItem`
- `PermissionPrompt`
- `MapLegend`

Each component should support accessibility labels, loading/disabled states where relevant, and consistent spacing. Avoid creating a generic component with dozens of unrelated boolean props; split it when its responsibilities differ.

---

## 7. Required UI states

Every data-driven screen should account for the following states:

| State | Expected UI behavior |
|---|---|
| Loading | Show a compact skeleton or progress indicator without blocking unrelated navigation. |
| Loaded | Show current locally available data and its freshness. |
| Empty | Explain that no matching saved items exist; do not imply the forest is fire-free. |
| Offline | Show cached data and a persistent offline indicator. |
| Stale data | Show last-updated time and stale/unknown status. |
| Permission denied | Explain the missing permission and offer a settings route or manual fallback. |
| GPS unavailable | Show that the position is unavailable; do not invent coordinates. |
| Sync pending | Label records as local/pending sync. |
| Sync failed | Preserve data and offer a safe retry. |
| No map package | Explain that the map must be downloaded while connected. |
| Critical alert | Bring alert information forward and use the supported local alarm mechanism. |
| Unauthorized | Hide unavailable actions and show a clear permission message if needed. |

---

## 8. Offline-first implementation rules

These are mandatory design constraints:

1. The UI must render from a local data store when disconnected.
2. Map tiles must be available locally for the intended Tadoba coverage and zoom levels.
3. Node coordinates and node IDs must be stored locally; never fetch them exclusively on screen open.
4. Show a timestamp/source for node status. A cached `online` status becomes stale as time passes.
5. Reports and field updates must be stored in a durable local queue before showing them as saved.
6. Synchronization must be retry-safe and avoid duplicate server records.
7. Handle conflicts if a record changed on the server while the phone was offline.
8. Separate `local sync status` from `incident status`.
9. The local alert receiver must be able to pass an event to the native alert mechanism without requiring a web request.
10. Keep a visible indication when the device has not synchronized for a long time.
11. Do not assume a GPS location is accurate just because GPS returned coordinates.
12. Do not assume a sensor is offline merely because the phone has no internet; node communication status and phone connectivity are different states.

---

## 9. React Native / Expo implementation guidance

- Use the existing project structure and package versions where possible.
- Use TypeScript and typed models for `Node`, `Incident`, `Observation`, `Evidence`, and `SyncQueueItem`.
- Use Expo Router if it is already part of the project.
- Use a persistent local database for node/incident/report records and a durable file cache for evidence. Choose the specific database after confirming current dependencies and Expo compatibility.
- Use a map implementation that supports offline tiles on the actual target Android devices. Validate Expo compatibility before selecting it.
- Store photos in local file storage until safely uploaded; database rows should hold metadata and file references, not large image blobs.
- Keep business logic out of screen components.
- Put API, local storage, sync, GPS, and alert handling behind dedicated service modules.
- Use mock repositories during the first UI-only stage; make the distinction from real data obvious in development builds.
- Test on a physical Android phone early. Emulator-only tests cannot validate field GPS, real vibration, speaker output, radio/Bluetooth hardware, or device battery restrictions.

### Suggested module boundaries

```text
src/
  app/                    # Routes and screen composition
  components/             # Reusable visual components
  features/
    home/
    map/
    nodes/
    alerts/
    incidents/
    reports/
    offline-data/
    profile/
  services/
    api/
    database/
    map/
    location/
    notifications/
    alarm/
    sync/
    radio/                 # Later hardware integration
  types/
  theme/
  utils/
```

Adapt these paths to the existing repository rather than moving files unnecessarily.

---

## 10. Alarm and communication design boundary

The UI design must not pretend the phone can receive a distant alert without a communication path.

A workable no-internet deployment needs an actual local alert path, for example:

**Sensor/camera system → local gateway/radio → receiver connected to phone → native Android alert service → visible alert + vibration + sound.**

The exact receiver and protocol depend on the hardware. LoRa can carry compact alert messages and coordinates, not normal camera images or video. A phone generally needs a compatible gateway/receiver to access LoRa data; it cannot receive LoRa directly unless suitable hardware is connected.

If an alert is created on a remote server while the phone is disconnected and no local radio path reaches the phone, the phone cannot alert about it until the data arrives. State this limitation honestly in the UI and system design.

For a native alarm implementation, define and test:

- Supported Android versions.
- Notification permission behavior.
- Notification channel importance and sound.
- Vibration pattern and user settings.
- Foreground/background behavior.
- Locked-screen behavior.
- Battery optimization restrictions.
- Alarm stop/silence and acknowledgement semantics.
- Deduplication and repeated-alert policy.
- Behavior when the app is force-stopped or the device is rebooted.

Do not claim that ordinary Expo JavaScript code alone guarantees a loud alarm in every background state. A development build or native Android integration may be required depending on the selected libraries and Expo SDK.

---

## 11. Accessibility and field usability

- Use clear labels in addition to icons.
- Maintain strong text contrast.
- Avoid tiny controls over map tiles.
- Provide status text alongside color.
- Use haptic feedback for normal interactions only where useful; reserve stronger patterns for critical alerts.
- Ensure the alert's essential details can be read without relying on sound.
- Support large text settings where practical.
- Do not require precise touch gestures to acknowledge an alert.
- Keep the main action within easy reach.
- Prevent accidental destructive actions through confirmation.
- Consider multilingual labels if the department requires them; confirm required languages before adding translations.

---

## 12. Design implementation order

### Pass 1 — UI with mock data

1. Theme tokens and reusable components.
2. Home screen with map placeholder or development map.
3. Full map screen and node marker states.
4. Node bottom sheet.
5. Alerts list.
6. Active alert overlay.
7. Report form and review state.
8. Incident details and timeline.
9. Reports/assigned list.
10. Offline data and profile screens.

### Pass 2 — Offline data

1. Integrate offline map package.
2. Load the real authorized Tadoba boundary and node dataset.
3. Persist nodes and cached incidents locally.
4. Show stale/unknown state correctly.
5. Persist reports and evidence.
6. Add the sync queue and retry handling.

### Pass 3 — Real alert path

1. Confirm radio/gateway/receiver hardware.
2. Define a compact alert payload and protocol.
3. Implement the receiver integration.
4. Deliver events to the native alert mechanism.
5. Test vibration and sound on physical devices, including locked-screen and background cases.
6. Test duplicate, delayed, malformed, and repeated alert messages.

### Pass 4 — Backend and dashboard

1. Connect authentication and the shared backend.
2. Synchronize reports and incident updates.
3. Connect the control-room dashboard to the same incident records.
4. Add audit history and role-based status transitions.
5. Test offline-to-online synchronization end to end.

---

## 13. Definition of design completion

The mobile UI design is ready for integration when:

- [ ] All primary screens follow the same spacing, typography, color, and component system.
- [ ] The map is the primary focus on Home and Map.
- [ ] All configured nodes can be represented and filtered.
- [ ] Node states distinguish healthy, potential alert, verified fire, stale/offline, and unknown.
- [ ] A critical alert is visually unmistakable.
- [ ] Acknowledging an alert is not confused with resolving the incident.
- [ ] Offline, stale, pending-sync, and sync-failed states are designed.
- [ ] Reports can be saved locally without internet.
- [ ] No empty state claims that the forest is safe.
- [ ] No mock location, node, or fire is presented as real data.
- [ ] The UI can be tested on a physical Android device.
- [ ] Background alarm limitations and radio dependencies are documented.

**First milestone:** finish the UI using mock data, while preserving the offline-first architecture in the component and service boundaries. Then integrate real map data, local storage, and the hardware alert path one at a time.
