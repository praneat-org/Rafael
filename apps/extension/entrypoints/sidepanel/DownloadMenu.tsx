/** One native dropdown instead of a button per format: pick a format = download it. */
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
  return (
    <select
      className="dl"
      aria-label={label}
      value=""
      disabled={disabled}
      onChange={(e) => {
        const f = e.target.value as F; // controlled value="": React resets it, same format can be picked again
        if (f) onPick(f);
      }}
    >
      <option value="" disabled hidden>
        ⬇ {label}
      </option>
      {(Object.entries(formats) as [F, string][]).map(([f, text]) => (
        <option key={f} value={f}>
          {text}
        </option>
      ))}
    </select>
  );
}
