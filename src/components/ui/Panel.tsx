/**
 * The card shell, in one place.
 *
 * `publish/publishUi` grew its own `Panel` and `TitledPanel` because no shared
 * one existed; the notes, projects and dashboard panes each hand-rolled the
 * same three classes instead. This is that shell promoted out of `publish/`, so
 * a card is one radius, one hairline and one surface wherever it is drawn.
 *
 * Cards and panels sit on the `lg` radius step and the 16px padding step — see
 * `docs/theme.md` for the rest of the scale.
 */

export function Panel({
  children,
  className = "",
  padded = true,
}: {
  children: React.ReactNode;
  className?: string;
  padded?: boolean;
}) {
  return (
    <div
      className={`border-border-medium bg-bg-elevated rounded-lg border ${
        padded ? "p-pad-card" : ""
      } ${className}`}
    >
      {children}
    </div>
  );
}

/** A panel with its own titled header row. */
export function TitledPanel({
  title,
  aside,
  children,
  className = "",
}: {
  title: string;
  aside?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Panel padded={false} className={`overflow-hidden ${className}`}>
      <div className="border-border-light flex items-center justify-between gap-2 border-b px-3.5 py-3">
        <h2 className="text-fg-primary text-[13px] font-semibold">{title}</h2>
        {aside}
      </div>
      {children}
    </Panel>
  );
}
