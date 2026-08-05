import { useEffect, useRef } from "react";

/**
 * A modal panel.
 *
 * Native `<dialog>` rather than a hand-rolled overlay: Escape, focus trapping and
 * inerting the page behind come with it, and none of them are worth reimplementing.
 *
 * Used for the things you do occasionally and deliberately — exchanging sites, choosing
 * recipes — which do not earn permanent space in the balance panel beside the numbers
 * you read constantly.
 */
export function Sheet({
  title, hint, children, foot, onClose,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
  foot: React.ReactNode;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => ref.current?.showModal(), []);

  return (
    <dialog className="sheet" ref={ref} onClose={onClose}>
      <header className="sheet__head">
        <h2 className="sheet__title">{title}</h2>
        {hint && <p className="hint">{hint}</p>}
      </header>
      <div className="sheet__body">{children}</div>
      <footer className="sheet__foot">{foot}</footer>
    </dialog>
  );
}
