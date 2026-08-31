"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { api } from "~/trpc/react";
import { useToast } from "~/components/providers/ToastProvider";

/**
 * What someone with no organizations is offered.
 *
 * Both surfaces that can be reached with an empty org list — the `/orgs`
 * dashboard and the workspace switcher — used to render a single sentence
 * ("You are not part of any organization yet.") and stop. It is a true
 * statement and a dead end: the two things that fix it, creating an org and
 * redeeming a code, both lived somewhere the user had no reason to look.
 *
 * So the empty state carries the actions rather than describing the problem.
 * `JoinWithCodeForm` is exported separately because the onboarding modal needs
 * the same input — one code field, not two that drift apart.
 */

/**
 * The code redemption input.
 *
 * `organization.join` is rate limited per user and per IP because it reports
 * whether a guess was right; the button is disabled while a guess is in flight
 * so a double-click does not spend two of those attempts.
 */
export function JoinWithCodeForm({ onJoined }: { onJoined?: () => void }) {
  const tOrg = useTranslations("org");
  const toast = useToast();
  const router = useRouter();
  const utils = api.useUtils();
  const [code, setCode] = useState("");

  const join = api.organization.join.useMutation({
    onSuccess: async () => {
      toast.success(tOrg("joinedWithCode"));
      setCode("");
      await utils.organization.listMine.invalidate();
      await utils.organization.getActive.invalidate();
      await utils.user.getProfile.invalidate();
      onJoined?.();
      router.push("/projects");
    },
    onError: (error) => {
      toast.error(error.message);
    },
  });

  const trimmed = code.trim();

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!trimmed || join.isPending) return;
        join.mutate({ code: trimmed });
      }}
      className="flex flex-col sm:flex-row gap-2"
    >
      <label className="sr-only" htmlFor="org-join-code">
        {tOrg("accessCode")}
      </label>
      <input
        id="org-join-code"
        value={code}
        onChange={(e) => setCode(e.target.value)}
        /* Codes are stored and compared upper-case; showing them that way means
           the field looks like what the sender pasted. */
        className="flex-1 min-w-0 px-3 py-2 rounded-xl bg-bg-secondary border border-border-light text-sm text-fg-primary uppercase tracking-wider placeholder:normal-case placeholder:tracking-normal placeholder:text-fg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary"
        placeholder={tOrg("joinCodePlaceholder")}
        autoComplete="off"
        spellCheck={false}
      />
      <button
        type="submit"
        disabled={!trimmed || join.isPending}
        className="px-4 py-2 rounded-xl bg-accent-primary text-white text-sm font-semibold hover:bg-accent-primary/90 transition disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary focus-visible:ring-offset-2 focus-visible:ring-offset-bg-primary"
      >
        {join.isPending ? tOrg("joining") : tOrg("joinWithCodeCta")}
      </button>
    </form>
  );
}

/** The create half: a name, and the code the org is reached by afterwards. */
function CreateOrgForm() {
  const tOrg = useTranslations("org");
  const toast = useToast();
  const utils = api.useUtils();
  const [name, setName] = useState("");

  const create = api.organization.create.useMutation({
    onSuccess: async (data) => {
      toast.success(tOrg("createdOrg", { name: data.name }));
      setName("");
      await utils.organization.listMine.invalidate();
      await utils.organization.getActive.invalidate();
      await utils.user.getProfile.invalidate();
    },
    onError: (error) => {
      toast.error(error.message);
    },
  });

  const trimmed = name.trim();

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!trimmed || create.isPending) return;
        create.mutate({ name: trimmed });
      }}
      className="flex flex-col sm:flex-row gap-2"
    >
      <label className="sr-only" htmlFor="org-create-name">
        {tOrg("createNameLabel")}
      </label>
      <input
        id="org-create-name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        className="flex-1 min-w-0 px-3 py-2 rounded-xl bg-bg-secondary border border-border-light text-sm text-fg-primary placeholder:text-fg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary"
        placeholder={tOrg("createNamePlaceholder")}
        autoComplete="organization"
      />
      <button
        type="submit"
        disabled={!trimmed || create.isPending}
        className="px-4 py-2 rounded-xl border border-border-light text-sm font-semibold text-fg-primary hover:bg-bg-secondary transition disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary focus-visible:ring-offset-2 focus-visible:ring-offset-bg-primary"
      >
        {create.isPending ? tOrg("creating") : tOrg("createOrgCta")}
      </button>
    </form>
  );
}

/**
 * `compact` is the switcher's dropdown, where there is room for the code field
 * but not for two labelled sections.
 */
export function OrgEmptyState({ compact = false }: { compact?: boolean }) {
  const tOrg = useTranslations("org");

  if (compact) {
    return (
      <div className="p-3 space-y-2">
        <p className="text-sm text-fg-secondary">{tOrg("noOrgs")}</p>
        <JoinWithCodeForm />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="space-y-1">
        <h2 className="text-lg font-bold text-fg-primary">{tOrg("emptyTitle")}</h2>
        <p className="text-sm text-fg-secondary">{tOrg("emptyBody")}</p>
      </div>

      <div className="space-y-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-fg-secondary">
          {tOrg("joinWithCodeCta")}
        </h3>
        <JoinWithCodeForm />
      </div>

      <div className="space-y-2 pt-1 border-t border-border-light">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-fg-secondary pt-4">
          {tOrg("createOrgCta")}
        </h3>
        <CreateOrgForm />
      </div>
    </div>
  );
}
