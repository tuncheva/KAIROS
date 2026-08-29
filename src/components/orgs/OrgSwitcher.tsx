"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
import { ChevronDown, Plus, Copy, Check } from "~/components/ui/icons";
import { useTranslations } from "next-intl";
import { api } from "~/trpc/react";
import { useToast } from "~/components/providers/ToastProvider";
import { useSwitchOrganization } from "~/hooks/useSwitchOrganization";

export function OrgSwitcher() {
  const tOrg = useTranslations("org");
  const toast = useToast();

  const utils = api.useUtils();
  const activeQuery = api.organization.getActive.useQuery();
  const orgsQuery = api.organization.listMine.useQuery();

  const [open, setOpen] = useState(false);
  const [showAddOrg, setShowAddOrg] = useState(false);
  const [newOrgName, setNewOrgName] = useState("");
  const [generatedCode, setGeneratedCode] = useState("");
  const [copiedCode, setCopiedCode] = useState(false);

  const activeOrgId = activeQuery.data?.organization?.id ?? null;
  const activeName = activeQuery.data?.organization?.name ?? null;

  const items = orgsQuery.data ?? [];

  const createOrganization = api.organization.create.useMutation({
    onSuccess: (data) => {
      setGeneratedCode(data.accessCode);
      void utils.organization.listMine.invalidate();
      void utils.organization.getActive.invalidate();
    },
    onError: (error) => {
      toast.error(error.message);
    },
  });

  const setActive = useSwitchOrganization({
    onSwitched: () => setOpen(false),
    onError: (message) => toast.error(message),
  });

  const handlePick = useCallback(
    (organizationId: number) => {
      if (setActive.isPending) return;
      setActive.mutate({ organizationId });
    },
    [setActive],
  );

  const handleCreateOrg = () => {
    if (!newOrgName.trim()) {
      toast.info("Please enter an organization name");
      return;
    }
    createOrganization.mutate({ name: newOrgName });
  };

  const handleCopyCode = async () => {
    try {
      await navigator.clipboard.writeText(generatedCode);
      setCopiedCode(true);
      toast.success("Access code copied");
      setTimeout(() => setCopiedCode(false), 2000);
    } catch {
      const textArea = document.createElement("textarea");
      textArea.value = generatedCode;
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand("copy");
      document.body.removeChild(textArea);
      setCopiedCode(true);
      toast.success("Access code copied");
      setTimeout(() => setCopiedCode(false), 2000);
    }
  };

  const handleCloseAddOrg = () => {
    setShowAddOrg(false);
    setNewOrgName("");
    setGeneratedCode("");
    setCopiedCode(false);
  };

  if (!items.length && !showAddOrg) return null;

  return (
    <div className="relative hidden sm:block">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="h-10 inline-flex items-center gap-2 rounded-xl bg-bg-surface shadow-sm px-3 text-sm text-fg-secondary hover:text-fg-primary hover:bg-bg-elevated hover:shadow-md transition-colors"
        aria-expanded={open}
        aria-haspopup="menu"
      >
        <span className="max-w-[180px] truncate">
          {activeName ?? tOrg("yourOrgs")}
        </span>
        <ChevronDown size={16} className="text-fg-tertiary" />
      </button>

      {open ? (
        <div
          role="menu"
          className="absolute right-0 mt-2 w-72 overflow-hidden rounded-2xl bg-bg-surface shadow-lg"
        >
          <div className="px-3 py-2 text-xs font-medium text-fg-tertiary">
            {tOrg("switchOrg")}
          </div>

          <div className="max-h-72 overflow-auto">
            {items.map((org) => {
              const isActive = activeOrgId === org.id;
              return (
                <button
                  key={org.id}
                  type="button"
                  role="menuitem"
                  onClick={() => handlePick(org.id)}
                  className={`w-full px-3 py-2 text-left flex items-center justify-between gap-3 transition-colors ${
                    isActive
                      ? "bg-accent-primary/10 text-fg-primary"
                      : "hover:bg-bg-elevated text-fg-secondary"
                  }`}
                >
                  <div className="min-w-0">
                    <div className="text-sm font-medium truncate">{org.name}</div>
                    <div className="text-xs text-fg-tertiary">
                      {isActive ? tOrg("active") : tOrg("setActive")}
                    </div>
                  </div>
                  {isActive ? (
                    <Check size={14} className="shrink-0 text-accent-primary" />
                  ) : null}
                </button>
              );
            })}
          </div>

          {/* Add Organization Section */}
          {showAddOrg ? (
            <div className="p-3 bg-bg-elevated/50">
              {!generatedCode ? (
                <div className="space-y-3">
                  <input
                    type="text"
                    value={newOrgName}
                    onChange={(e) => setNewOrgName(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleCreateOrg()}
                    placeholder="Organization name..."
                    className="w-full px-3 py-2 text-sm bg-bg-surface rounded-lg focus:outline-none focus:ring-2 focus:ring-accent-primary/30 text-fg-primary placeholder:text-fg-tertiary"
                    autoFocus
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={handleCloseAddOrg}
                      className="flex-1 px-3 py-2 text-sm text-fg-tertiary hover:text-fg-primary hover:bg-bg-surface rounded-lg transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleCreateOrg}
                      disabled={createOrganization.isPending}
                      className="flex-1 px-3 py-2 text-sm bg-accent-primary text-white rounded-lg hover:bg-accent-hover transition-colors disabled:opacity-50"
                    >
                      {createOrganization.isPending ? "Creating..." : "Create"}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="text-center">
                    <p className="text-xs text-fg-tertiary mb-1">Access Code</p>
                    <p className="text-lg font-bold text-accent-primary font-mono tracking-wider">
                      {generatedCode}
                    </p>
                  </div>
                  <button
                    onClick={handleCopyCode}
                    className="w-full flex items-center justify-center gap-2 px-3 py-2 text-sm bg-accent-primary/15 text-accent-primary rounded-lg hover:bg-accent-primary/25 transition-colors"
                  >
                    {copiedCode ? <Check size={14} /> : <Copy size={14} />}
                    {copiedCode ? "Copied!" : "Copy Code"}
                  </button>
                  <button
                    onClick={handleCloseAddOrg}
                    className="w-full px-3 py-2 text-sm text-fg-tertiary hover:text-fg-primary hover:bg-bg-surface rounded-lg transition-colors"
                  >
                    Done
                  </button>
                </div>
              )}
            </div>
          ) : (
            <button
              onClick={() => setShowAddOrg(true)}
              className="w-full px-3 py-2.5 text-left flex items-center gap-2 text-sm text-accent-primary hover:bg-bg-elevated transition-colors"
            >
              <Plus size={16} />
              Add Organization
            </button>
          )}

          <div className="px-3 py-2">
            <Link
              href="/orgs"
              className="text-sm text-fg-tertiary hover:text-fg-primary transition-colors"
              onClick={() => setOpen(false)}
            >
              {tOrg("viewAll")}
            </Link>
          </div>
        </div>
      ) : null}
    </div>
  );
}
