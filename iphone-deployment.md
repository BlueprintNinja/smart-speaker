# Sky — iPhone Deployment Guide

Install Sky as a native iOS app on your iPhone using Xcode developer tools.
No App Store required — free Apple ID is sufficient.

---

## Prerequisites

- Mac with **Xcode** installed (free from the App Store)
- iPhone with a USB cable
- Windows PC running the Sky stack (`docker compose up -d`)
- iPhone and Windows PC on the **same WiFi network**

---

## Step 1 — Find Your Windows PC's IP Address

On the **Windows machine**, open PowerShell:

```powershell
ipconfig
```

Look for **IPv4 Address** under your WiFi adapter — something like `192.168.1.45`.

---

## Step 2 — Set the Server URL (on this Mac)

Open `capacitor.config.json` in the project root and replace `YOUR-PC-IP` with the IP you found:

```json
"server": {
  "url": "https://192.168.1.45"
}
```

Then rebuild and sync the iOS project:

```bash
cd /path/to/smart-speaker
npm run ios:sync
```

---

## Step 3 — Open Xcode

```bash
npm run ios:open
```

This opens `ios/App/App.xcworkspace` in Xcode.

---

## Step 4 — Configure Signing in Xcode

1. In the left panel, click **App** (the blue Xcode project icon at the top)
2. Select the **App** target (not `CapApp-SPM`)
3. Click the **Signing & Capabilities** tab
4. Check **Automatically manage signing**
5. Under **Team**, click the dropdown → **Add an Account...**
   - Sign in with your Apple ID (any Apple ID works — no paid developer account needed)
6. Once signed in, select your **Personal Team** from the dropdown
7. The Bundle Identifier is `com.raysberryfarm.sky` — Xcode may append your account ID automatically, that's fine

---

## Step 5 — Connect Your iPhone

1. Plug your iPhone into the Mac with a USB cable
2. On the iPhone: tap **Trust** when the *"Trust This Computer?"* prompt appears
3. Enter your iPhone passcode if prompted
4. In Xcode, click the device picker at the top (next to the **▶** Run button) and select your iPhone

---

## Step 6 — Build and Install

Press **▶ (Run)**. Xcode will:

- Compile the Swift/Capacitor wrapper (~1–2 minutes on first build)
- Sign and install Sky on your iPhone
- Launch the app automatically

If Xcode shows a *"Could not launch"* error on first run, that's normal — see Step 7.

---

## Step 7 — Trust the Developer Profile on iPhone

iOS blocks sideloaded apps until you manually trust the developer certificate:

1. On iPhone: **Settings → General → VPN & Device Management**
2. Under **Developer App**, tap your Apple ID email address
3. Tap **Trust "[your Apple ID]"**
4. Tap **Trust** in the confirmation dialog
5. Go back and open the **Sky** app — it will now launch normally

> You only need to do this once. Re-installs from the same Apple ID don't require re-trusting.

---

## How the App Works

Sky runs as a native WKWebView that loads directly from `https://YOUR-PC-IP`. This means:

- **Always up to date** — no rebuild needed when the web app changes
- **Full feature parity** — all tabs, voice, briefing, dashboard, vision camera
- **Requires farm WiFi** — iPhone must be on the same network as the Windows machine
- **Mic & camera permissions** — iOS will prompt on first use; tap **Allow**

---

## Updating the App

### Web app changes (most updates)
No action needed — the iOS app loads live from the server. Just restart the backend:

```powershell
# On Windows
docker compose up -d --build backend frontend
```

### Native config changes (rare — only if `capacitor.config.json` changes)
```bash
# On Mac
npm run ios:sync
npm run ios:open
# Then press ▶ in Xcode to reinstall
```

---

## Useful Scripts

| Command | What it does |
|---|---|
| `npm run ios:sync` | Rebuilds web assets and syncs to the Xcode project |
| `npm run ios:open` | Opens the Xcode project |
| `npm run ios:build` | Sync + open in one step |

---

## Troubleshooting

**"Untrusted Developer" when opening app**
→ Follow Step 7 above.

**App loads but shows connection error**
→ Make sure Windows PC is running (`docker compose up -d`) and both devices are on the same WiFi.

**Microphone not working**
→ Settings → Privacy & Security → Microphone → enable **Sky**.

**Camera button opens wrong camera**
→ 📷 opens the rear camera. 🖼️ opens the photo library / file picker.

**Xcode "No account" error**
→ Xcode → Settings → Accounts → **+** → add your Apple ID.

**"Provisioning profile" expired** (after ~7 days on free account)
→ Connect iPhone, open Xcode, press ▶ again to renew. Free developer certificates expire every 7 days and must be re-signed.

> **Tip:** A paid Apple Developer account ($99/year) extends the certificate to 1 year and removes the 7-day re-signing requirement.

---

## HA Companion App (Optional — for GPS Presence & Push Notifications)

If you install the **Home Assistant Companion App** alongside Sky:

- `input_boolean.ray_on_farm` can be triggered automatically when your iPhone enters the farm GPS zone
- Sky can push notifications to your iPhone via `notify.mobile_app_*`

The Companion App and Sky are separate — both can coexist on your iPhone.
