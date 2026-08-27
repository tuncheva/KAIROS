"use client";

/**
 * The fields an event grew when it stopped being a title and a town.
 *
 * Shared by the create and edit forms rather than written twice, because the
 * two used to drift: the edit form could not change half of what the create
 * form asked for, and the create form asked for one thing — "Tag Collaborators"
 * — that it never sent anywhere.
 *
 * Everything here is optional. `region` remains the only location an event is
 * required to have, so an organiser who only knows the town can still publish,
 * and every row written before these columns existed still reads correctly.
 */

import { useState } from "react";
import { useTranslations } from "next-intl";
import {
  Building2,
  Check,
  Clock,
  Map,
  Palette,
  Plus,
  Tag,
  Users,
  X,
} from "lucide-react";

import { api } from "~/trpc/react";
import {
  COVER_THEMES,
  TOPICS,
  coverClass,
  type CoverTheme,
  type EventTopic,
} from "~/components/publish/feedData";
import { PersonAvatar } from "~/components/publish/publishUi";

export interface EventDetailValues {
  endTime: string;
  endDate: string;
  venue: string;
  address: string;
  capacity: string;
  topic: EventTopic | null;
  coverTheme: CoverTheme | null;
  coHostIds: string[];
}

export const EMPTY_DETAILS: EventDetailValues = {
  endTime: "",
  endDate: "",
  venue: "",
  address: "",
  capacity: "",
  topic: null,
  coverTheme: null,
  coHostIds: [],
};

/**
 * Turn the form's strings into what the router takes.
 *
 * The end time is expressed relative to the start date unless a different end
 * date was given, which is what makes "19:00 – 02:00" mean the same night
 * rather than a fourteen-hour typo.
 */
export function toEventDetailInput(
  values: EventDetailValues,
  startDate: string,
): {
  endsAt: Date | null;
  venue: string | null;
  address: string | null;
  capacity: number | null;
  topic: EventTopic | null;
  coverTheme: CoverTheme | null;
  coHostIds: string[];
} {
  const endDay = values.endDate || startDate;
  const endsAt =
    values.endTime && endDay ? new Date(`${endDay}T${values.endTime}`) : null;

  const capacity = values.capacity.trim() ? Number(values.capacity) : null;

  return {
    endsAt: endsAt && !Number.isNaN(endsAt.getTime()) ? endsAt : null,
    venue: values.venue.trim() || null,
    address: values.address.trim() || null,
    capacity:
      capacity !== null && Number.isInteger(capacity) && capacity > 0
        ? capacity
        : null,
    topic: values.topic,
    coverTheme: values.coverTheme,
    coHostIds: values.coHostIds,
  };
}

const FIELD =
  "w-full bg-transparent border-none focus:ring-0 text-sm dark:placeholder-gray-500 placeholder-slate-400 dark:text-gray-200 text-slate-800";
const SHELL =
  "flex items-center gap-2.5 dark:bg-white/5 bg-slate-50 rounded-xl p-3 border dark:border-accent-primary/20 border-slate-200 focus-within:border-accent-primary focus-within:ring-1 focus-within:ring-accent-primary/40 transition-all";
const LABEL =
  "block text-[10px] font-bold dark:text-gray-500 text-slate-500 uppercase tracking-[0.15em] mb-1.5";

/** The co-host picker, over people you already share a workspace with. */
function CoHostPicker({
  selected,
  onChange,
  disabled,
}: {
  selected: string[];
  onChange: (ids: string[]) => void;
  disabled?: boolean;
}) {
  const t = useTranslations("publish");
  const [open, setOpen] = useState(false);
  const { data: suggestions } = api.chat.getParticipantSuggestions.useQuery(
    undefined,
    { enabled: open },
  );

  /* The suggestions come back in three buckets — workspace members, people you
     have talked to, and project collaborators. Co-hosting does not care which
     bucket somebody arrived in, so they are flattened and de-duplicated. */
  const people = (() => {
    if (!suggestions || Array.isArray(suggestions)) return [];
    const seen = new Set<string>();
    return [
      ...suggestions.organizationMembers,
      ...suggestions.projectSuggestions.flatMap((project) => project.members),
      ...suggestions.recentContacts,
    ].filter((person) => {
      if (seen.has(person.id)) return false;
      seen.add(person.id);
      return true;
    });
  })();
  const chosen = people.filter((person) => selected.includes(person.id));

  const toggle = (id: string) => {
    onChange(
      selected.includes(id)
        ? selected.filter((value) => value !== id)
        : [...selected, id],
    );
  };

  return (
    <div>
      <label className={LABEL}>
        <Users className="mr-1 inline text-accent-primary" size={10} />
        {t("tagCollaborators")}
      </label>

      <div className="flex flex-wrap items-center gap-2">
        {chosen.map((person) => (
          <span
            key={person.id}
            className="flex items-center gap-1.5 rounded-full bg-accent-primary/10 py-1 pl-1 pr-2 text-xs text-accent-primary"
          >
            <PersonAvatar name={person.name} image={person.image} size="sm" />
            <span className="max-w-[120px] truncate">{person.name}</span>
            <button
              type="button"
              onClick={() => toggle(person.id)}
              aria-label={t("removeCoHost")}
              disabled={disabled}
              className="rounded-full p-0.5 transition-colors hover:bg-accent-primary/20"
            >
              <X size={11} />
            </button>
          </span>
        ))}

        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          disabled={disabled}
          aria-expanded={open}
          className="flex h-9 w-9 items-center justify-center rounded-full border-2 border-dashed border-slate-300 text-slate-400 transition-all hover:border-accent-primary hover:text-accent-primary dark:border-gray-700 dark:text-gray-500"
        >
          <Plus size={18} />
        </button>

        {chosen.length === 0 && !open && (
          <span className="text-xs font-medium text-slate-400 dark:text-gray-500">
            {t("addGuestHosts")}
          </span>
        )}
      </div>

      {open && (
        <div className="mt-2 max-h-44 overflow-y-auto rounded-xl border border-slate-200 dark:border-white/10">
          {people.length === 0 ? (
            <p className="p-3 text-xs text-fg-tertiary">{t("noCoHostOptions")}</p>
          ) : (
            <ul>
              {people.map((person) => {
                const active = selected.includes(person.id);
                return (
                  <li key={person.id}>
                    <button
                      type="button"
                      onClick={() => toggle(person.id)}
                      className="flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors hover:bg-slate-50 dark:hover:bg-white/5"
                    >
                      <PersonAvatar
                        name={person.name}
                        image={person.image}
                        size="sm"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] text-fg-primary">
                          {person.name}
                        </span>
                        <span className="block truncate text-[11px] text-fg-tertiary">
                          {person.email}
                        </span>
                      </span>
                      {active && (
                        <Check size={14} className="text-accent-primary" />
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

export function EventDetailFields({
  values,
  onChange,
  disabled,
  showCoHosts = true,
}: {
  values: EventDetailValues;
  onChange: (values: EventDetailValues) => void;
  disabled?: boolean;
  /** Co-hosts are the creator's to set; a co-host editing cannot change them. */
  showCoHosts?: boolean;
}) {
  const t = useTranslations("publish");
  const set = <K extends keyof EventDetailValues>(
    key: K,
    value: EventDetailValues[K],
  ) => onChange({ ...values, [key]: value });

  return (
    <div className="space-y-3">
      {/* When it ends. Blank keeps the old behaviour: an event that is over the
          moment it starts. */}
      <div>
        <label className={LABEL}>
          <Clock className="mr-1 inline text-accent-primary" size={10} />
          {t("endsAt")}
        </label>
        <div className="grid grid-cols-2 gap-3">
          <div className={SHELL}>
            <Clock size={16} className="shrink-0 text-accent-primary" />
            <input
              type="time"
              value={values.endTime}
              onChange={(event) => set("endTime", event.target.value)}
              disabled={disabled}
              aria-label={t("endTime")}
              className={`${FIELD} dark:[color-scheme:dark]`}
            />
          </div>
          <div className={SHELL}>
            <input
              type="date"
              value={values.endDate}
              onChange={(event) => set("endDate", event.target.value)}
              disabled={disabled}
              aria-label={t("endDate")}
              placeholder={t("sameDay")}
              className={`${FIELD} dark:[color-scheme:dark]`}
            />
          </div>
        </div>
        <p className="mt-1 text-[11px] text-fg-tertiary">{t("endsAtHint")}</p>
      </div>

      {/* Where, beyond the town. */}
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className={LABEL}>
            <Building2 className="mr-1 inline text-accent-primary" size={10} />
            {t("venue")}
          </label>
          <div className={SHELL}>
            <input
              type="text"
              value={values.venue}
              onChange={(event) => set("venue", event.target.value)}
              maxLength={160}
              disabled={disabled}
              placeholder={t("venuePlaceholder")}
              className={FIELD}
            />
          </div>
        </div>
        <div>
          <label className={LABEL}>
            <Map className="mr-1 inline text-accent-primary" size={10} />
            {t("address")}
          </label>
          <div className={SHELL}>
            <input
              type="text"
              value={values.address}
              onChange={(event) => set("address", event.target.value)}
              maxLength={255}
              disabled={disabled}
              placeholder={t("addressPlaceholder")}
              className={FIELD}
            />
          </div>
        </div>
      </div>

      {/* What kind of thing it is. */}
      <div>
        <label className={LABEL}>
          <Tag className="mr-1 inline text-accent-primary" size={10} />
          {t("topic")}
        </label>
        <div className="flex flex-wrap gap-1.5">
          {TOPICS.map((candidate) => {
            const active = values.topic === candidate;
            return (
              <button
                key={candidate}
                type="button"
                onClick={() => set("topic", active ? null : candidate)}
                disabled={disabled}
                aria-pressed={active}
                className={`kairos-mono rounded-lg px-2.5 py-1.5 text-[11px] transition-colors ${
                  active
                    ? "bg-accent-primary/15 font-semibold text-accent-primary ring-1 ring-inset ring-accent-primary/30"
                    : "bg-slate-100 text-fg-secondary hover:text-fg-primary dark:bg-white/5"
                }`}
              >
                {t(`topics.${candidate}`)}
              </button>
            );
          })}
        </div>
      </div>

      {/* The wash behind it.

          Most events never get a photograph, and the alternative to a colour is
          a grey rectangle. Leaving this alone is a real choice, not an empty
          one: the view derives a wash from the event id, so the card is
          coloured either way and this only overrides which. */}
      <div>
        <label className={LABEL}>
          <Palette className="mr-1 inline text-accent-primary" size={10} />
          {t("coverTheme")}
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => set("coverTheme", null)}
            disabled={disabled}
            aria-pressed={values.coverTheme === null}
            title={t("coverAuto")}
            className={`kairos-mono h-9 rounded-lg px-3 text-[11px] transition-colors ${
              values.coverTheme === null
                ? "bg-accent-primary/15 font-semibold text-accent-primary ring-1 ring-inset ring-accent-primary/30"
                : "bg-slate-100 text-fg-secondary hover:text-fg-primary dark:bg-white/5"
            }`}
          >
            {t("coverAuto")}
          </button>

          {COVER_THEMES.map((theme) => {
            const active = values.coverTheme === theme;
            return (
              <button
                key={theme}
                type="button"
                onClick={() => set("coverTheme", active ? null : theme)}
                disabled={disabled}
                aria-pressed={active}
                aria-label={t(`covers.${theme}`)}
                title={t(`covers.${theme}`)}
                className={`kairos-cover-swatch h-9 w-12 rounded-lg transition-all ${coverClass(
                  { id: 0, coverTheme: theme },
                )} ${
                  active
                    ? "ring-2 ring-accent-primary ring-offset-2 ring-offset-bg-elevated"
                    : "opacity-80 hover:opacity-100"
                }`}
              />
            );
          })}
        </div>
      </div>

      {/* How many fit. Blank means unlimited. */}
      <div>
        <label className={LABEL}>
          <Users className="mr-1 inline text-accent-primary" size={10} />
          {t("capacityLabel")}
        </label>
        <div className={SHELL}>
          <Users size={16} className="shrink-0 text-accent-primary" />
          <input
            type="number"
            min={1}
            inputMode="numeric"
            value={values.capacity}
            onChange={(event) => set("capacity", event.target.value)}
            disabled={disabled}
            placeholder={t("capacityPlaceholder")}
            className={FIELD}
          />
        </div>
      </div>

      {showCoHosts && (
        <CoHostPicker
          selected={values.coHostIds}
          onChange={(ids) => set("coHostIds", ids)}
          disabled={disabled}
        />
      )}
    </div>
  );
}
