"use client";

/** In-app dialogs (UI_CONVENTIONS §2.6): the ONLY confirm/prompt mechanism.
 * Native window.confirm/window.prompt render browser chrome that ignores the
 * app's light/dark tokens — never use them. This provider mounts once in the
 * Shell and exposes useDialog():
 *   const ok = await dialog.confirm({ title, body, confirmLabel?, tone? })
 *   const text = await dialog.ask({ title, body?, placeholder?, multiline? })
 * Both are promise-based so call sites read like the natives they replace;
 * everything is styled from the same CSS variables as the rest of the app. */
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";

type ConfirmOpts = { title: string; body?: string; confirmLabel?: string; tone?: "accent" | "danger" };
type AskOpts = { title: string; body?: string; placeholder?: string; multiline?: boolean; confirmLabel?: string };
type Pending =
  | { kind: "confirm"; opts: ConfirmOpts; resolve: (ok: boolean) => void }
  | { kind: "ask"; opts: AskOpts; resolve: (text: string | null) => void };

const DialogContext = createContext<{
  confirm: (opts: ConfirmOpts) => Promise<boolean>;
  ask: (opts: AskOpts) => Promise<string | null>;
} | null>(null);

export function useDialog() {
  const ctx = useContext(DialogContext);
  if (!ctx) throw new Error("useDialog must be used inside <DialogProvider> (mounted in Shell)");
  return ctx;
}

export function DialogProvider({ children }: { children: React.ReactNode }) {
  const [pending, setPending] = useState<Pending | null>(null);
  const [text, setText] = useState("");
  const inputRef = useRef<HTMLTextAreaElement | HTMLInputElement | null>(null);

  const confirm = useCallback(
    (opts: ConfirmOpts) =>
      new Promise<boolean>((resolve) => {
        setText("");
        setPending({ kind: "confirm", opts, resolve });
      }),
    [],
  );
  const ask = useCallback(
    (opts: AskOpts) =>
      new Promise<string | null>((resolve) => {
        setText("");
        setPending({ kind: "ask", opts, resolve });
      }),
    [],
  );

  const close = useCallback(
    (ok: boolean) => {
      if (!pending) return;
      if (pending.kind === "confirm") pending.resolve(ok);
      else pending.resolve(ok ? text.trim() : null);
      setPending(null);
    },
    [pending, text],
  );

  // keyboard: Escape cancels, focus lands on the input when asking
  useEffect(() => {
    if (!pending) return;
    inputRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pending, close]);

  const tone = pending?.kind === "confirm" && pending.opts.tone === "danger" ? "var(--bad)" : "var(--accent)";

  return (
    <DialogContext.Provider value={{ confirm, ask }}>
      {children}
      {pending && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center p-4"
          style={{ background: "color-mix(in srgb, var(--foreground) 35%, transparent)" }}
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) close(false);
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label={pending.opts.title}
            className="w-full max-w-md rounded-xl border p-5 shadow-xl"
            style={{ borderColor: "var(--border)", background: "var(--card)", color: "var(--foreground)" }}
          >
            <h3 className="text-base font-semibold">{pending.opts.title}</h3>
            {pending.opts.body && (
              <p className="mt-2 whitespace-pre-wrap text-sm leading-6" style={{ color: "var(--muted)" }}>
                {pending.opts.body}
              </p>
            )}
            {pending.kind === "ask" &&
              (pending.opts.multiline ? (
                <textarea
                  ref={(el) => {
                    inputRef.current = el;
                  }}
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder={pending.opts.placeholder}
                  rows={4}
                  className="mt-3 w-full rounded-lg border bg-transparent px-3 py-2 text-sm leading-6"
                  style={{ borderColor: "var(--border)" }}
                />
              ) : (
                <input
                  ref={(el) => {
                    inputRef.current = el;
                  }}
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder={pending.opts.placeholder}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") close(true);
                  }}
                  className="mt-3 w-full rounded-lg border bg-transparent px-3 py-2 text-sm"
                  style={{ borderColor: "var(--border)" }}
                />
              ))}
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => close(false)}
                className="rounded-lg border px-3 py-1.5 text-sm"
                style={{ borderColor: "var(--border)", color: "var(--muted)" }}
              >
                Cancel
              </button>
              <button
                onClick={() => close(true)}
                disabled={pending.kind === "ask" && text.trim().length === 0}
                className="rounded-lg px-4 py-1.5 text-sm font-medium text-white disabled:opacity-40"
                style={{ background: tone }}
              >
                {pending.opts.confirmLabel ?? "Confirm"}
              </button>
            </div>
          </div>
        </div>
      )}
    </DialogContext.Provider>
  );
}
