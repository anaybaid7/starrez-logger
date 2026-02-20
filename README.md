# starrez-logger
Small start to the LegacyAPI Plugin+Automation project, here with Campus Housing Waterloo DServices

```
starrez-logger/
├── manifest.json
├── content.js
├── icon16.png
├── icon48.png
└── icon128.png
```

---
# 🔧 StarRez Logging Automation Tool (FDA Helper)
**Maintained By:** Anay Baid  
**Last Updated:** January 2026

---

## Table of Contents

1. [Overview](#1-overview)
2. [Technical Architecture & Security](#2-technical-architecture--security)
3. [Deployment & Installation](#3-deployment--installation)
4. [User Guide: Logging Packages](#4-user-guide-logging-packages)
5. [User Guide: Printing Package Labels](#5-user-guide-printing-package-labels)
6. [User Guide: Logging Lockouts](#6-user-guide-logging-lockouts)
7. [Troubleshooting & FAQs](#7-troubleshooting--faqs)

---

## 1. Overview

The StarRez Logging Automation Tool is a client-side browser extension that streamlines Front Desk logging workflows within StarRez. By automatically reading and formatting student data already visible on screen, the tool eliminates manual transcription and ensures every log entry and package label follows exact Departmental format.

The tool injects action buttons directly into the StarRez interface. Staff do not need to switch windows, type student information, or navigate away from the current profile.

### Key Operational Metrics

- Reduces average log creation time from ~20 seconds (manual entry) to under 1 second (single click).
- Eliminates transcription errors including transposed Student IDs, incorrect room codes, and miscopied key codes.
- Ensures consistent formatting across all six residences: **UWP, CLV, MKV, V1, REV, MHR**.

---

## 2. Technical Architecture & Security

> **Note for IST and Management:** This section provides a complete technical overview for compliance review. The source code is fully open and auditable at the project repository.

### How It Works

The tool is a **Chrome Extension** built to the MV3 (Manifest Version 3) standard — Chrome's current and most secure extension architecture. It activates only when a staff member navigates to the StarRez web interface. No manual activation or setup is required after installation.

### Security Profile

| Property | Detail |
|---|---|
| **Data access** | Reads text already rendered on screen — identical to what the logged-in staff member sees |
| **Network requests** | None. All processing is entirely client-side. No data is transmitted anywhere |
| **Data storage** | Usage counts only (e.g. how many times each FDA used each button). No student data is ever written |
| **Scope** | Activates exclusively on `uwaterloo.starrezhousing.com` — no other websites |
| **Record modification** | Does not modify any StarRez records. Reads, formats, and copies to clipboard only |

### Permissions Requested

| Permission | Why |
|---|---|
| `clipboardWrite` | To copy the formatted log string to clipboard on button click |
| `storage` | To persist per-FDA usage counts locally in the browser |
| `host: uwaterloo.starrezhousing.com` | Scoped exclusively to the StarRez domain |

The extension does **not** request access to tabs, browsing history, network traffic, or any other website. No icons are bundled — Chrome displays a default puzzle-piece icon in the toolbar, which has no effect on functionality.

### Project Structure

The extension is split into distinct modules, each with a single responsibility:

```
starrez-logger/
├── manifest.json
└── src/
    ├── index.js                  # Entry point
    ├── core/
    │   ├── config.js             # All constants and timing values
    │   ├── logger.js             # Debug logging
    │   ├── state.js              # Shared state management
    │   └── format.js             # Pure text formatting (no DOM access)
    ├── adapter/
    │   └── extractors.js         # All StarRez DOM reading (isolated boundary)
    ├── workflows/
    │   └── registry.js           # Workflow definitions (package, lockout, label)
    ├── telemetry/
    │   └── storage.js            # Per-FDA usage tracking
    ├── ui/
    │   ├── styles.js             # All visual styling
    │   ├── toast.js              # Clipboard confirmation notification
    │   └── buttons.js            # Button creation and click handling
    └── runtime/
        ├── init.js               # Button injection and page detection
        └── observer.js           # SPA navigation detection
```

---

## 3. Deployment & Installation

> **Important:** This extension is not intended for self-installation by general student staff. Installation must be performed by Anay Baid or an authorised IST representative on designated desk workstations.

### Administrator Installation Process

#### Step 1: Download the Extension Files

Obtain the latest version of the extension folder from the project repository. The folder should contain `manifest.json` and all `src/` subdirectories. No icon files are required.

#### Step 2: Open Chrome Extensions

On the desk workstation, open Google Chrome. In the address bar, navigate to:

```
chrome://extensions
```

#### Step 3: Enable Developer Mode

In the top-right corner of the Extensions page, toggle **Developer Mode** to the **on** position. This enables loading unpacked extensions.

#### Step 4: Load the Extension

Select **Load unpacked**. In the file browser that opens, navigate to and select the root extension folder (the folder containing `manifest.json`). Select **Select Folder**.

The extension will appear in the extensions list as **StarRez Package Logger**. A default puzzle-piece icon will display in the Chrome toolbar — this is expected and does not affect functionality.

#### Step 5: Verify Installation

Navigate to any student profile in StarRez. Confirm that the following buttons appear:

- **Copy Log** — next to the Issue button in the Parcels section
- **Print Label** — near the Entry Actions menu
- **Copy Lockout** — at the top of the active profile panel

If the buttons do not appear immediately, refresh the page (F5) once and allow 2–3 seconds for the extension to initialise.

#### Updating the Extension

When a new version is released, replace the folder contents with the updated files, then navigate to `chrome://extensions` and select the **Refresh** icon on the StarRez Package Logger card.

---

## 4. User Guide: Logging Packages

The tool automatically detects when a student profile with active parcels is open and injects a **Copy Log** button next to the standard Issue button.

### Step 1: Open the Student Profile

Search for and open the resident's profile in StarRez as you normally would.

### Step 2: Locate the Button

Navigate to the **Parcels** section of the profile. A blue **Copy Log** button will appear immediately to the right of the standard **Issue** button.

If the student has multiple parcels, an additional purple **Copy [N] pkgs** button will appear next to the parcel count, allowing you to log all parcels in one click.

### Step 3: Click to Copy

Click the **Copy Log** button. The button will briefly turn green and display **✓ Copied**. A confirmation notification will appear in the bottom-right corner of the screen showing the exact text that was copied.

### Step 4: Paste Into the Log

Switch to the Spreadsheet or Log and press **Ctrl + V** to paste.

### Output Format

```
A.B (20990921) UWP-BECK-204a 1 pkg @ 2:30 pm - J.D
```

| Field | Source |
|---|---|
| `A.B` | Student initials derived from the breadcrumb name |
| `20990921` | Student Number read from the active profile panel |
| `UWP-BECK-204a` | Room/bedspace code read from the Rez 360 section |
| `1 pkg` | Package count — adjusts automatically to `2 pkgs`, `3 pkgs`, etc. |
| `2:30 pm` | System time at the moment of click |
| `J.D` | Initials of the staff member currently logged into StarRez |

---

## 5. User Guide: Printing Package Labels

Use this feature to generate a standardised label for packages being logged, held, or returned.

### Step 1: Open the Student Profile

Navigate to the resident's main profile page in StarRez.

### Step 2: Locate the Button

Look to the top-right area of the profile, near the **Entry Actions** menu. A sky-blue **Print Label** button will appear directly to the left of it.

### Step 3: Click to Copy

Click the **Print Label** button. The button will briefly turn green and display **✓ Copied**. A confirmation notification will appear in the bottom-right corner showing the label contents.

### Step 4: Paste Into the Label Template

Press **Ctrl + V** to paste into your label printer software or Word template.

### Output Format

```
1/23/2026 2:30p.m.
20990921
Anay Baid
UWP-BECK-204a
FDA: J.D
```

| Field | Source |
|---|---|
| Date and time | System date and time at moment of click |
| Student number | Read from the active profile panel |
| Full name | Derived from the breadcrumb, formatted as First Last |
| Room code | Read from the Rez 360 section |
| FDA initials | Initials of the staff member logged into StarRez |

---

## 6. User Guide: Logging Lockouts

The tool uses strict ID-based filtering to ensure only the key codes assigned to the current student are captured, even when viewing a busy loaner key report.

### Step 1: Open the Student Profile

Search for and open the resident's profile in StarRez. Ensure you are viewing the correct student before clicking.

### Step 2: Locate the Button

An orange **Copy Lockout** button appears at the top of the active profile panel on any student profile page. You do not need to navigate to a specific tab or section — the button is always visible when you are on a student profile.

### Step 3: Click to Copy

Click the **Copy Lockout** button. The tool will cross-reference visible key codes against the current Student ID to ensure only the correct keys are captured.

- **If keys are found:** the button turns green, displays **✓ Copied**, and a confirmation notification appears.
- **If no keys are assigned:** a notification will appear stating *"No loaner keys found for this student."* This is a safety check — do not proceed with a lockout log if no keys are detected.

### Step 4: Complete and Paste

Switch to the Lockout Log and press **Ctrl + V** to paste. Fill in the reason in the `[Fill in Reason]` placeholder before saving.

### Output Format

```
A.B (12345678) BH-204a KC: 26AA21; [Fill in Reason] - J.D
```

| Field | Source |
|---|---|
| `A.B` | Student initials |
| `12345678` | Student Number |
| `BH-204a` | Room/bedspace code |
| `KC: 26AA21` | Loaner key code(s) — multiple codes comma-separated if applicable |
| `[Fill in Reason]` | Placeholder — must be completed manually before saving |
| `J.D` | Staff member initials |

> **Note on the Safety Filter:** The tool looks for key codes listed in direct proximity to the current Student ID on screen. If the Loaner Keys page shows multiple students (report mode), the tool narrows results to only the current student's row. This prevents accidentally logging another resident's key code.

---

## 7. Troubleshooting & FAQs

**The buttons did not appear after opening a profile.**

StarRez is a Single Page Application (SPA) — content loads dynamically without a full page reload. The tool detects these changes automatically and injects buttons within 0.3–0.5 seconds of the profile loading. If the buttons do not appear, wait 2–3 seconds, then refresh the page once (F5).

---

**I switched to a different student but the buttons still show the previous student's data.**

The tool monitors navigation changes and replaces buttons automatically when a new profile is detected. If the buttons appear stale, refresh the page (F5) to force a clean reload.

---

**The Copy Lockout button is visible but clicking it says "No loaner keys found."**

This is expected behaviour. The tool searches for loaner key codes assigned to the current Student ID visible on screen. If the student has no active loaner keys — for example, they use a fob only, or their keys have already been returned — the tool will not generate a log entry. This prevents a blank or incorrect key code from being logged. Proceed with a manual entry if required.

---

**The Copy Log button appeared but clicking it shows an error.**

This typically means the student data had not fully loaded before the button was clicked. Wait 1–2 seconds for the profile to finish loading and try again. If the issue persists, refresh the page (F5).

---

**The buttons disappeared mid-session without refreshing.**

StarRez occasionally re-renders sections of the profile panel during navigation, which can remove injected elements. The tool's MutationObserver detects these changes and re-injects buttons within 0.5 seconds automatically. If buttons do not reappear, refresh the page.

---

**There is a puzzle-piece icon in the Chrome toolbar instead of a coloured icon.**

This is expected. The extension does not include custom icons — Chrome displays its default puzzle-piece icon instead. This has no effect on functionality.

---

**Will this tool affect StarRez or modify any records?**

No. The tool is read-only. It reads text already displayed on screen, formats it, and copies it to your clipboard — equivalent to manually highlighting and copying text yourself. It does not submit forms, modify records, or interact with the StarRez backend in any way.

---

**Is student data being saved or sent anywhere?**

No student data is stored or transmitted. The only data saved locally is a count of how many times each staff member has used each button (e.g. "J. Smith — Package Log: 42, Lockout: 7"). This count is stored in the browser on the local workstation only and is never sent anywhere.

---

**I have a feature request or found a bug.**

Please email Anay Baid with a screenshot or description of the issue. For urgent desk issues, a page refresh (F5) resolves most transient problems while a fix is being reviewed.

---

*Related pages: Mail Processing · Daily Tasks · Lockout Procedure · Submitting an IST Ticket*
