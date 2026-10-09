"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

import { Mail } from "~/components/ui/icons";
import { cn } from "~/lib/utils";
import { api, type RouterOutputs } from "~/trpc/react";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type InviteeLookup = RouterOutputs["organization"]["lookupInvitee"];

/**
 * Who the address being typed belongs to, as far as this inviter may know.
 *
 * Asked only for a complete address, after the typing settles: a lookup per
 * keystroke would spend the daily lookup budget on "a", "an", "ana@"… and the
 * server matches exact addresses only, so partial ones could never answer.
 *
 * The server decides what may be shown — see `organization.lookupInvitee`. This
 * hook never infers anything from a `new` answer: that answer is the same for
 * "no account" and "an account you may not see", on purpose.
 */
export function useInviteeLookup(organizationId: number, email: string) {
  const address = email.trim().toLowerCase();
  const [settled, setSettled] = useState("");

  useEffect(() => {
    const id = setTimeout(() => setSettled(address), 450);
    return () => clearTimeout(id);
  }, [address]);

  const ready = EMAIL_PATTERN.test(settled) && settled === address;
  const query = api.organization.lookupInvitee.useQuery(
    { organizationId, email: settled },
    {
      enabled: ready,
      retry: false,
      staleTime: 60_000,
      refetchOnWindowFocus: false,
    },
  );

  return {
    result: ready ? query.data : undefined,
    loading: ready && query.isFetching,
    /** Whether sending would only bounce off the server's duplicate checks. */
    blocked: ready && (query.data?.status === "member" || query.data?.status === "pending"),
  };
}

function Face({ name, image }: { name: string | null; image: string | null }) {
  if (image) {
    // eslint-disable-next-line @next/next/no-img-element -- avatars come from several hosts
    return <img src={image} alt="" className="h-9 w-9 flex-none rounded-full object-cover" />;
  }
  return (
    <span className="border-tui-ink/16 bg-tui-pane font-display text-tui-ink2 flex h-9 w-9 flex-none items-center justify-center rounded-full border text-[16px]">
      {(name ?? "?").trim().charAt(0).toUpperCase() || "?"}
    </span>
  );
}

/**
 * The row under the invite field: the person, or what will happen instead.
 *
 * `new` tells the inviter a sign-up email is coming. It also covers people who
 * hid themselves from lookups, so for them "not registered" is a white lie.
 */
export function InviteePreview({
  email,
  lookup,
  loading,
}: {
  email: string;
  lookup: InviteeLookup | undefined;
  loading: boolean;
}) {
  const t = useTranslations("team.invitee");
  if (!lookup && !loading) return null;

  const person = lookup?.person ?? null;
  const name = person?.name ?? email.trim();

  const line = (() => {
    switch (lookup?.status) {
      case "member":
        return { title: name, sub: t("member"), tone: "text-tui-ink3" };
      case "pending":
        return { title: email.trim(), sub: t("pending"), tone: "text-tui-ink3" };
      case "person":
        return { title: name, sub: t("person"), tone: "text-tui-ink2" };
      case "new":
        return { title: email.trim(), sub: t("new"), tone: "text-tui-ink2" };
      default:
        return null;
    }
  })();

  return (
    <div
      aria-live="polite"
      className={cn(
        "border-tui-ink/10 flex min-h-[54px] items-center gap-3 rounded-lg border px-3 py-2.5 transition-opacity",
        loading && "opacity-60",
      )}
    >
      {person ? (
        <Face name={person.name} image={person.image} />
      ) : (
        <span className="bg-tui-ink/[0.05] text-tui-ink3 flex h-9 w-9 flex-none items-center justify-center rounded-full">
          <Mail size={15} aria-hidden />
        </span>
      )}
      {line ? (
        <span className="flex min-w-0 flex-col">
          <span className="text-tui-ink truncate text-[14px] font-medium">{line.title}</span>
          {person && line.title !== email.trim() ? (
            <span className="text-tui-ink3 truncate text-[12.5px]">{email.trim()}</span>
          ) : null}
          <span className={cn("text-[12.5px] leading-[1.45]", line.tone)}>{line.sub}</span>
        </span>
      ) : (
        <span className="text-tui-ink3 text-[12.5px]">{t("checking")}</span>
      )}
    </div>
  );
}
