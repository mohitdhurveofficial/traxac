import { Capacitor } from "@capacitor/core";
import { Preferences } from "@capacitor/preferences";

/**
 * Where the app is running, and how it proves who it is.
 *
 * On the web the session is an httpOnly cookie: the browser sends it, and no
 * JavaScript can read it, which is the strongest option available there.
 *
 * Inside the native shell that is not possible. The page is served from
 * `capacitor://localhost` or `https://localhost`, so every call to the API is
 * cross-site; the cookie is third-party and the WebView will not send it. The
 * API was built for this and also accepts `Authorization: Bearer`, so the app
 * keeps the session token instead.
 *
 * That token is a real credential, so it lives in Capacitor Preferences —
 * backed by the Android Keystore-protected shared preferences rather than
 * WebView localStorage, which is wiped by a "clear site data" and readable by
 * any script that gets injected.
 */

const TOKEN_KEY = "ewayvo.session";

/** True inside the Android or iOS shell; false in a normal browser. */
export function isNativeApp(): boolean {
  return Capacitor.isNativePlatform();
}

/** "android" | "ios" | "web". */
export function platformName(): string {
  return Capacitor.getPlatform();
}

/**
 * The API to talk to.
 *
 * The web build is served by the API itself, so a relative path is correct and
 * keeps the session first-party. The native build has no server of its own and
 * must be told an absolute URL at build time.
 */
export function apiBaseUrl(): string {
  const configured = import.meta.env["VITE_API_BASE"] as string | undefined;
  if (configured) return configured.replace(/\/+$/, "");
  if (isNativeApp()) {
    // Failing loudly beats silently calling localhost on the handset, which
    // produces a confusing "cannot reach the server" for every screen.
    throw new Error(
      "VITE_API_BASE must be set when building the mobile app — the app has no server of its own.",
    );
  }
  return "/api";
}

/* --------------------------- session token ---------------------------- */

/** Cached so every request does not hit native storage. */
let cachedToken: string | null = null;
let loaded = false;

export async function loadSessionToken(): Promise<string | null> {
  if (loaded) return cachedToken;
  if (!isNativeApp()) {
    loaded = true;
    return null;
  }
  const { value } = await Preferences.get({ key: TOKEN_KEY });
  cachedToken = value ?? null;
  loaded = true;
  return cachedToken;
}

export function sessionToken(): string | null {
  return cachedToken;
}

export async function storeSessionToken(token: string): Promise<void> {
  cachedToken = token;
  loaded = true;
  if (isNativeApp()) await Preferences.set({ key: TOKEN_KEY, value: token });
}

export async function clearSessionToken(): Promise<void> {
  cachedToken = null;
  loaded = true;
  if (isNativeApp()) await Preferences.remove({ key: TOKEN_KEY });
}
