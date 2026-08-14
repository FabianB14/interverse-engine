# Packaging a game for Android (TWA)

Interverse games are PWAs, so the Android app is a **Trusted Web Activity** —
a thin native wrapper that opens the SAME deployed game full-screen. There is
no separate Android codebase: iPhone/browser players keep the exact same game,
and every web deploy updates the Android app automatically on next launch.

Hushfall is wired up first (`games/hushfall/android/twa-manifest.json` +
`.github/workflows/android-hushfall.yml`).

## Build an APK to sideload (no setup)

1. GitHub → Actions → **Hushfall Android app** → Run workflow.
2. Download the `hushfall-android` artifact: `app-release-signed.apk`
   installs on any Android phone (enable "install unknown apps").

Without signing secrets the workflow signs with a throwaway test key —
fine for testing, not accepted by the Play Store, and the browser bar
shows until assetlinks is set up (step below).

## Release signing (required for the Play Store)

1. Make a keystore ONCE, locally, and keep it safe forever (Play uploads
   must always use the same key):

   ```sh
   keytool -genkeypair -v -keystore hushfall-release.keystore -alias hushfall \
     -keyalg RSA -keysize 2048 -validity 10000
   ```

2. Add repo secrets (Settings → Secrets and variables → Actions):
   - `ANDROID_KEYSTORE_BASE64` — `base64 -w0 hushfall-release.keystore`
   - `ANDROID_KEYSTORE_PASSWORD`
   - `ANDROID_KEY_PASSWORD`

3. Re-run the workflow. It now produces a Play-ready
   `app-release-bundle.aab` and prints the key's **SHA-256 fingerprint**.

## Digital Asset Links (hides the browser bar)

Android only grants the app full-screen "this is really your site" trust if
the site vouches for the app's signing key:

1. Copy the SHA-256 fingerprint from the workflow output.
2. Paste it into `site/.well-known/assetlinks.json` (replacing the
   placeholder), commit, and deploy the site (push `main`).
3. Reinstall the app — the URL bar is gone.

## Play Store

1. [Play Console](https://play.google.com/console) → create app
   (Hushfall, Game, free).
2. Upload `app-release-bundle.aab` to a closed test track first.
3. Store listing assets: `games/hushfall/public/icon-512.png` works for
   the icon; grab screenshots from any phone.
4. Content rating questionnaire: no chat by default (proximity voice is
   an off-by-default, device-local opt-in), no purchases, no ads.

## Adding another game later

Copy `games/hushfall/android/twa-manifest.json` into the other game's
folder, change `packageId`, `startUrl`, `iconUrl` + names, duplicate the
workflow with the new paths, and add a second entry to
`site/.well-known/assetlinks.json` (it is a JSON array — one entry per app).
