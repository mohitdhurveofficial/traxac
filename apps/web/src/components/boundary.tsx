import { Component, type ErrorInfo, type ReactNode } from "react";

/**
 * Last line of defence against a white screen.
 *
 * A thrown render is a bug on our side, so the copy says so and offers the one
 * action that reliably works — reload. The technical detail goes to the
 * console for whoever is debugging, never onto the page.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, { crashed: boolean }> {
  override state = { crashed: false };

  static getDerivedStateFromError(): { crashed: boolean } {
    return { crashed: true };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("Unhandled render error", error, info.componentStack);
  }

  override render(): ReactNode {
    if (!this.state.crashed) return this.props.children;
    return (
      <div className="grid min-h-dvh place-items-center px-6 text-center">
        <div className="max-w-sm">
          <p className="text-base font-medium">This screen ran into a problem</p>
          <p className="mt-1 text-sm text-muted">
            Nothing you saved has been lost. Reloading usually clears it.
          </p>
          <button
            type="button"
            className="btn-primary mt-4"
            onClick={() => window.location.reload()}
          >
            Reload Ewayvo
          </button>
        </div>
      </div>
    );
  }
}
