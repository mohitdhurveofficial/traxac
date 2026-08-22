import { App } from "@capacitor/app";
import { Network } from "@capacitor/network";
import { SplashScreen } from "@capacitor/splash-screen";
import { StatusBar, Style } from "@capacitor/status-bar";
import { onlineManager } from "@tanstack/react-query";
import { isNativeApp } from "./platform.js";

/**
 * Everything the app needs that a browser tab does not.
 *
 * Deliberately small. Each piece here exists because the WebView behaves
 * differently from a browser in a way a user would notice, not because a
 * plugin was available.
 */

/** Undo handlers, so a hot reload does not stack listeners. */
const teardown: Array<() => void> = [];

export async function initialiseNativeShell(): Promise<void> {
  if (!isNativeApp()) return;

  // Enables the WebView-only CSS: no rubber-band scroll, no long-press
  // callout, no grey tap flash. Set on the element rather than detected in
  // CSS because there is no media query for "inside an app".
  document.documentElement.classList.add("native");

  await configureStatusBar();
  configureBackButton();
  await configureNetwork();
}

/**
 * Dismiss the launch screen.
 *
 * Held open by configuration until the first render, so a returning user goes
 * straight from the splash to their dashboard instead of seeing the sign-in
 * screen flash while the stored session is read.
 */
export async function hideSplash(): Promise<void> {
  if (!isNativeApp()) return;
  try {
    await SplashScreen.hide();
  } catch {
    // Already hidden, or unavailable. Never block the app on this.
  }
}

export function disposeNativeShell(): void {
  while (teardown.length) teardown.pop()?.();
}

/**
 * The status bar is part of our layout, not the system's.
 *
 * `viewport-fit=cover` already paints under it, so it must not also draw its
 * own background — that would leave a coloured band above a white header.
 * Dark text, because every screen in the app is light.
 */
async function configureStatusBar(): Promise<void> {
  try {
    await StatusBar.setStyle({ style: Style.Light });
    await StatusBar.setOverlaysWebView({ overlay: true });
  } catch {
    // Not fatal, and not present on every platform. A wrong status bar colour
    // is not worth failing startup over.
  }
}

/**
 * Android's hardware back button.
 *
 * Untouched, it closes the app from any screen — which loses a half-written
 * invoice and is the single most jarring thing about a WebView app. It should
 * do what the browser back button does, and only exit from the top level,
 * which is also what the Play Store review guidelines expect.
 */
function configureBackButton(): void {
  void App.addListener("backButton", ({ canGoBack }) => {
    // A modal or drawer is the nearest thing to "back" when one is open.
    const dismissible = document.querySelector<HTMLElement>("[data-dismiss-on-back]");
    if (dismissible) {
      dismissible.click();
      return;
    }
    if (canGoBack && window.history.length > 1) {
      window.history.back();
      return;
    }
    void App.exitApp();
  }).then((handle) => teardown.push(() => void handle.remove()));
}

/**
 * Feed real connectivity into React Query.
 *
 * The browser's `navigator.onLine` is unreliable inside a WebView — it can
 * report online while the handset has no usable connection. Capacitor asks
 * the platform instead, which is what the offline banner and the paused-
 * mutation behaviour depend on being right.
 */
async function configureNetwork(): Promise<void> {
  try {
    const status = await Network.getStatus();
    onlineManager.setOnline(status.connected);
    const handle = await Network.addListener("networkStatusChange", (next) => {
      onlineManager.setOnline(next.connected);
    });
    teardown.push(() => void handle.remove());
  } catch {
    // Fall back to the browser signal React Query uses by default.
  }
}
