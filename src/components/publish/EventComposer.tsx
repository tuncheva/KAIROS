"use client";

/**
 * The composer at the head of the feed.
 *
 * It is deliberately not a form. The old one was a two-row textarea that did
 * nothing except open the real dialog on focus, so the typing you did there was
 * thrown away. Here the one field that matters — the title — is real, the chips
 * name the three things the dialog will ask for next, and whichever chip you
 * press is the field the dialog opens focused on with your title already in it.
 */

import { useState } from "react";
import { useSession } from "next-auth/react";
import { useTranslations } from "next-intl";
import { CalendarDays, ImagePlus, MapPin, Users } from "~/components/ui/icons";

import { MetaChip, PersonAvatar, Stamp } from "./publishUi";
import type { ComposerField } from "~/components/events/CreateEventForm";

export function EventComposer({
  onOpen,
}: {
  /** Hands the dialog a title to start from and the field to focus. */
  onOpen: (draft: { title: string; focus: ComposerField }) => void;
}) {
  const t = useTranslations("publish");
  const { data: session } = useSession();
  const [title, setTitle] = useState("");

  if (!session) return null;

  const open = (focus: ComposerField) => {
    onOpen({ title: title.trim(), focus });
    setTitle("");
  };

  return (
    <div
      className="dash-rise rounded-xl border border-slate-200 bg-white p-4 dark:border-white/10 dark:bg-[#0e0e14]"
      style={{ animationDelay: "80ms" }}
    >
      <div className="flex items-center gap-3">
        <PersonAvatar name={session.user?.name} image={session.user?.image} />
        <input
          type="text"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              open("title");
            }
          }}
          maxLength={256}
          placeholder={t("composerPlaceholder")}
          aria-label={t("eventTitle")}
          className="h-10 min-w-0 flex-1 rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm text-fg-primary placeholder:text-fg-tertiary focus:border-accent-primary focus:outline-none focus:ring-1 focus:ring-accent-primary/40 dark:border-white/10 dark:bg-white/5"
        />
      </div>

      <div className="mt-3.5 flex flex-wrap items-center gap-2">
        <MetaChip
          icon={<CalendarDays size={13} className="text-accent-primary" />}
          onClick={() => open("date")}
          dashed
        >
          {t("dateTime")}
        </MetaChip>
        <MetaChip
          icon={<MapPin size={13} className="text-accent-primary" />}
          onClick={() => open("location")}
          dashed
        >
          {t("addLocation")}
        </MetaChip>
        <MetaChip
          icon={<ImagePlus size={13} className="text-accent-primary" />}
          onClick={() => open("image")}
          dashed
        >
          {t("coverImage")}
        </MetaChip>

        <span className="flex-1" />

        {/* Audience is not a per-event setting in this schema — every event is
            public. The stamp says so rather than offering a picker that would
            silently do nothing. */}
        <span className="hidden items-center gap-1.5 sm:flex">
          <Users size={12} className="text-fg-quaternary" />
          <Stamp className="tracking-[0.14em]">{t("audiencePublic")}</Stamp>
        </span>

        <button
          type="button"
          onClick={() => open("title")}
          className="h-8 rounded-lg bg-accent-primary px-4 text-xs font-semibold text-white transition-colors hover:bg-accent-hover"
        >
          {t("continue")}
        </button>
      </div>
    </div>
  );
}
