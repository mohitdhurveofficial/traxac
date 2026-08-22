import type { CapacitorConfig } from "@capacitor/cli";

/**
 * Native shell configuration.
 *
 * The shell loads the same built SPA the web serves — one codebase, one UI.
 * What differs is only what the shell cannot provide: it has no server of its
 * own, so `VITE_API_BASE` must point at the deployed API at build time, and
 * the session travels as a Bearer token because a cookie cannot cross the
 * capacitor:// origin. See src/lib/platform.ts.
 */
const config: CapacitorConfig = {
  appId: "in.ewayvo.app",
  appName: "eWayVo",
  webDir: "dist",
  android: {
    // Release builds must not ship a debuggable WebView.
    webContentsDebuggingEnabled: false,
    // Cleartext is never needed: the API is HTTPS in every environment that
    // matters, and allowing it would let a misconfigured build downgrade.
    allowMixedContent: false,
  },
  ios: {
    // Matches the Android application id so one identity spans both stores.
    scheme: "eWayVo",
    // The app draws its own header under the status bar; without this iOS
    // adds its own inset on top of ours and the layout shifts.
    contentInset: "never",
    limitsNavigationsToAppBoundDomains: true,
  },
  server: {
    // https rather than capacitor:// so the WebView treats the app as a
    // secure context — required for crypto APIs and sensible cookie handling.
    androidScheme: "https",
    iosScheme: "https",
  },
  plugins: {
    SplashScreen: {
      // Held only until the app has restored its session and rendered, so a
      // returning user never sees a flash of the sign-in screen.
      launchAutoHide: false,
      backgroundColor: "#1d4ed8",
      androidScaleType: "CENTER_CROP",
      showSpinner: false,
    },
    StatusBar: {
      overlaysWebView: true,
      style: "LIGHT",
    },
  },
};

export default config;
