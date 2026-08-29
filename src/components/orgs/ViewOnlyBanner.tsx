"use client";

import { Eye } from "~/components/ui/icons";

/**
 * Banner displayed at the top of pages when the current user has a view-only
 * (mentor) role in the active organization.
 */
export function ViewOnlyBanner({ show }: { show: boolean }) {
  if (!show) return null;

  return (
    <div className="w-full px-4 py-2 flex items-center justify-center gap-2 text-sm font-medium"
      style={{
        backgroundColor: 'rgba(var(--warning), 0.15)',
        color: 'rgb(var(--warning))',
        borderBottom: '1px solid rgba(var(--warning), 0.25)',
      }}
    >
      <Eye size={16} />
      <span>View-only mode — your role does not allow editing in this workspace</span>
    </div>
  );
}
