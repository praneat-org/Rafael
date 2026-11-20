import { useRef } from 'react';

/** One dropdown instead of a button per format. Native <details> menu of buttons: a <select>
 *  fires change on ArrowDown, so keyboard users could not get past the first format. */
export function DownloadMenu<F extends string>({
  label,
  formats,
  disabled,
  onPick,
}: {
  label: string;
  formats: Record<F, string>;
  disabled?: boolean;
  onPick: (f: F) => void;
}) {
  const ref = useRef<HTMLDetailsElement>(null);
  const close = () => {
    if (ref.current) ref.current.open = false;
  };
  return (
    <details
      ref={ref}
      className="dl"
      onKeyDown={(e) => e.key === 'Escape' && close()}
      onBlur={(e) => !e.currentTarget.contains(e.relatedTarget) && close()}
      onToggle={(e) => disabled && e.currentTarget.open && close()}
    >
      <summary aria-disabled={disabled || undefined}>⬇ {label}</summary>
      <div className="dl-menu">
        {(Object.entries(formats) as [F, string][]).map(([f, text]) => (
          <button
            key={f}
            type="button"
            onClick={() => {
              close();
              onPick(f);
            }}
          >
            {text}
          </button>
        ))}
      </div>
    </details>
  );
}
