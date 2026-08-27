export default function Loading() {
  return (
    <div className="min-h-dvh flex items-center justify-center bg-bg-primary">
      <div className="flex flex-col items-center gap-4">
        <div className="w-8 h-8 border-2 border-accent-primary/30 border-t-accent-primary rounded-full animate-spin" />
        <p className="text-sm text-fg-tertiary">Loading...</p>
      </div>
    </div>
  );
}
