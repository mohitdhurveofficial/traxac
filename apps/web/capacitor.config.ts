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
  },
  server: {
    // https rather than capacitor:// so the WebView treats the app as a
    // secure context — required for crypto APIs and sensible cookie handling.
    androidScheme: "https",
  },
};

export default config;
