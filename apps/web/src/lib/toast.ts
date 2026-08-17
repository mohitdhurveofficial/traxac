import { useEffect, useState } from "react";
import { describeError } from "./errors.js";

export interface ToastMessage {
  id: number;
  tone: "info" | "error";
  title: string;
  detail?: string;
}

/**
 * One notification surface for the whole app.
 *
 * A module-level store rather than context, so non-React code — the React
 * Query mutation cache — can raise a message without a provider in scope.
 */
let nextId = 1;
let toasts: ToastMessage[] = [];
const listeners = new Set<(value: ToastMessage[]) => void>();

function emit(): void {
  for (const listener of listeners) listener(toasts);
}

function push(toast: Omit<ToastMessage, "id">): void {
  const id = nextId++;
  toasts = [...toasts, { ...toast, id }];
  emit();
  setTimeout(() => dismissToast(id), toast.tone === "error" ? 7000 : 3000);
}

export function dismissToast(id: number): void {
  toasts = toasts.filter((toast) => toast.id !== id);
  emit();
}

/** Confirmation of something the user just did. */
export function notify(title: string, detail?: string): void {
  push(detail === undefined ? { tone: "info", title } : { tone: "info", title, detail });
}

/**
 * Reports a failed action.
 *
 * Returns false when the error is deliberately not shown — an aborted request,
 * or a validation failure that belongs on the fields themselves.
 */
export function notifyError(error: unknown): boolean {
  const described = describeError(error);
  if (!described) return false;
  push({
    tone: "error",
    title: described.title,
    ...(described.detail ? { detail: described.detail } : {}),
  });
  return true;
}

export function useToasts(): ToastMessage[] {
  const [value, setValue] = useState(toasts);
  useEffect(() => {
    listeners.add(setValue);
    setValue(toasts);
    return () => {
      listeners.delete(setValue);
    };
  }, []);
  return value;
}
