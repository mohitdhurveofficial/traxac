# The Android app

eWayVo ships as one application. The Android app is a native shell around the
same built web app, so every screen, form and fix lands on both at once —
there is no second UI to keep in sync.

## What differs from the web

Only two things, and both are handled in `apps/web/src/lib/platform.ts`.

**How the session is carried.** On the web it is an httpOnly cookie that no
script can read — the strongest option a browser offers. The shell cannot use
one: its page is served from `https://localhost` inside the WebView, so a
cookie for the API is third-party and gets dropped. The API already accepts
`Authorization: Bearer`, so the app carries the same session as a token, kept
in Capacitor Preferences rather than WebView localStorage.

**Where the API lives.** The web build is served by the API itself, so a
relative `/api` is correct. The app has no server of its own and must be told
an absolute URL at build time. If `VITE_API_BASE` is missing in a native
build the app throws immediately rather than silently calling localhost on the
handset and showing "cannot reach the server" on every screen.

## Building it

You need **Android Studio** with the Android SDK, and a JDK — Android Studio
bundles one.

```bash
# From the repository root.
cd apps/web

# Point the app at your deployed API. This is baked in at build time.
VITE_API_BASE=https://your-api-host/api pnpm build

# Copy the built web app into the native shell.
npx cap sync android

# Open it in Android Studio.
npx cap open android
```

Then in Android Studio: **Build → Build Bundle(s) / APK(s) → Build APK(s)**.
The debug APK lands in `apps/web/android/app/build/outputs/apk/debug/`.

Shortcuts exist for the first two steps:

```bash
pnpm --filter @ewayvo/web mobile:sync   # build + sync
pnpm --filter @ewayvo/web mobile:open   # open Android Studio
```

## After changing the web app

The shell holds a **copy** of the built web app, so a code change is not
picked up until you re-sync:

```bash
pnpm --filter @ewayvo/web mobile:sync
```

Forgetting this is the most common confusion — the app keeps showing the old
build and nothing looks wrong.

## Before it can talk to your API

The app's origin is not your API's origin, so the API must allow it:

```
CORS_ORIGINS=https://localhost,https://your-web-host
```

`https://localhost` is the WebView's origin on Android (set by
`androidScheme: "https"` in `capacitor.config.ts`). Without it every request
from the app fails CORS while the web app carries on working — which makes it
look like an app bug rather than a server setting.

## Releasing to the Play Store

Not done yet, and it needs decisions rather than code:

1. **A signing key.** Generate an upload keystore and keep it somewhere it
   cannot be lost — losing it means you cannot update the app again. It must
   never be committed; `*.keystore` and `*.jks` are already ignored.
2. **A release build** — `Build → Generate Signed Bundle / APK`, choosing
   Android App Bundle.
3. **A Play Console account** (one-off fee), plus a privacy policy, store
   listing and screenshots.
4. **Data safety disclosure.** The app handles GST credentials and invoice
   data; the form asks what you collect and why.

## Configuration reference

| Setting                       | Where                 | Purpose                                                      |
| ----------------------------- | --------------------- | ------------------------------------------------------------ |
| `appId`                       | `capacitor.config.ts` | `in.ewayvo.app` — permanent once published                   |
| `appName`                     | `capacitor.config.ts` | Shown under the icon                                         |
| `VITE_API_BASE`               | build environment     | Absolute API URL, required for native                        |
| `CORS_ORIGINS`                | API environment       | Must include `https://localhost`                             |
| `webContentsDebuggingEnabled` | `capacitor.config.ts` | `false` — a release build must not ship a debuggable WebView |

## Status

**IMPLEMENTED — NOT BUILT.** The Android project is generated and the web
assets sync into it. No APK has been produced from this repository, because
the machine it was set up on has no Java runtime. The first real build has to
happen in Android Studio, and nothing here should be described as a working
app until an APK has actually run on a device.
