"use client";

/**
 * The comment thread, where it belongs.
 *
 * Comments used to ride along with the feed — every comment of every event on
 * the page, unbounded, rendered two at a time behind a toggle. Here they are
 * paginated, one level of replies deep, and fetched only because somebody is
 * reading them.
 *
 * One level, not a tree: a reply to a reply hangs under the same top-level
 * comment (the server re-parents it), so nothing recurses and no thread can
 * nest itself off the right edge of a phone.
 */

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useSession } from "next-auth/react";
import { Loader2, MessageCircle, Send } from "~/components/ui/icons";

import { api } from "~/trpc/react";
import { ProfileLink } from "~/components/profile/ProfileLink";
import { PersonAvatar, Stamp } from "~/components/publish/publishUi";
import { useDateFormat } from "~/hooks/useDateFormat";
import type { FeedComment, FeedCommentThread } from "~/components/publish/feedData";

function CommentBody({
  comment,
  hostId,
  onReply,
}: {
  comment: FeedComment;
  hostId: string | null;
  onReply?: () => void;
}) {
  const t = useTranslations("publish");
  const { formatDate } = useDateFormat();

  return (
    <div className="flex gap-2.5">
      <ProfileLink userId={comment.author.id} name={comment.author.name}>
        <PersonAvatar
          name={comment.author.name}
          image={comment.author.image}
          size="sm"
        />
      </ProfileLink>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-2">
          <ProfileLink
            userId={comment.author.id}
            name={comment.author.name}
            className="rounded-md"
          >
            <span className="text-[13.5px] font-semibold text-fg-primary">
              {comment.author.name ?? t("someone")}
            </span>
          </ProfileLink>
          {comment.author.id === hostId && (
            <Stamp className="rounded bg-accent-primary/10 px-1.5 py-0.5 text-[9px] tracking-[0.14em] text-accent-primary">
              {t("host")}
            </Stamp>
          )}
          <Stamp className="text-[9.5px] tracking-[0.12em]">
            {formatDate(new Date(comment.createdAt), "withYear")}
          </Stamp>
        </div>
        <p className="whitespace-pre-line text-sm leading-relaxed text-fg-secondary">
          {comment.text}
        </p>
        {onReply && (
          <button
            type="button"
            onClick={onReply}
            className="kairos-stamp mt-1 text-[9.5px] tracking-[0.12em] text-accent-primary transition-colors hover:text-accent-hover"
          >
            {t("reply")}
          </button>
        )}
      </div>
    </div>
  );
}

function CommentComposer({
  eventId,
  parentId,
  placeholder,
  autoFocus,
  onPosted,
}: {
  eventId: number;
  parentId?: number;
  placeholder: string;
  autoFocus?: boolean;
  onPosted?: () => void;
}) {
  const t = useTranslations("publish");
  const utils = api.useUtils();
  const [text, setText] = useState("");

  const addComment = api.event.addComment.useMutation({
    onSuccess: () => {
      setText("");
      void utils.event.getById.invalidate({ eventId });
      void utils.event.getComments.invalidate({ eventId });
      onPosted?.();
    },
  });

  const submit = () => {
    const body = text.trim();
    if (!body) return;
    addComment.mutate({ eventId, text: body, parentId });
  };

  return (
    <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 dark:border-white/10 dark:bg-white/5">
      <input
        type="text"
        value={text}
        autoFocus={autoFocus}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            submit();
          }
        }}
        maxLength={500}
        placeholder={placeholder}
        disabled={addComment.isPending}
        className="min-w-0 flex-1 bg-transparent text-sm text-fg-primary placeholder:text-fg-tertiary focus:outline-none"
      />
      <button
        type="button"
        onClick={submit}
        disabled={addComment.isPending || !text.trim()}
        aria-label={t("post")}
        className="text-accent-primary transition-opacity disabled:opacity-30"
      >
        {addComment.isPending ? (
          <Loader2 className="animate-spin" size={16} />
        ) : (
          <Send size={16} />
        )}
      </button>
    </div>
  );
}

function Thread({
  thread,
  eventId,
  hostId,
}: {
  thread: FeedCommentThread;
  eventId: number;
  hostId: string | null;
}) {
  const t = useTranslations("publish");
  const { data: session } = useSession();
  const [replying, setReplying] = useState(false);

  return (
    <li className="flex flex-col gap-2.5">
      <CommentBody
        comment={thread}
        hostId={hostId}
        onReply={session ? () => setReplying((open) => !open) : undefined}
      />

      {thread.replies.length > 0 && (
        <ul className="ml-8 flex flex-col gap-2.5 border-l border-slate-200 pl-3 dark:border-white/10">
          {thread.replies.map((reply) => (
            <li key={reply.id}>
              <CommentBody comment={reply} hostId={hostId} />
            </li>
          ))}
        </ul>
      )}

      {thread.replyCount > thread.replies.length && (
        <p className="ml-8 pl-3 text-xs text-fg-tertiary">
          {t("moreReplies", { count: thread.replyCount - thread.replies.length })}
        </p>
      )}

      {replying && (
        <div className="ml-8 pl-3">
          <CommentComposer
            eventId={eventId}
            parentId={thread.id}
            placeholder={t("replyTo", { name: thread.author.name ?? t("someone") })}
            autoFocus
            onPosted={() => setReplying(false)}
          />
        </div>
      )}
    </li>
  );
}

export function EventDiscussion({
  eventId,
  hostId,
  commentCount,
  initial,
}: {
  eventId: number;
  hostId: string | null;
  commentCount: number;
  initial: { items: FeedCommentThread[]; nextCursor: Date | null };
}) {
  const t = useTranslations("publish");
  const { data: session } = useSession();

  /* The first page arrives with the event, so this only runs when somebody
     asks for more. */
  const [cursor, setCursor] = useState<Date | null>(null);
  const { data: extra, isFetching } = api.event.getComments.useQuery(
    { eventId, cursor },
    { enabled: cursor !== null },
  );

  const threads = [...initial.items, ...(extra?.items ?? [])];
  const nextCursor = extra ? extra.nextCursor : initial.nextCursor;

  return (
    <section id="discussion" className="scroll-mt-6">
      <h2 className="mb-3 flex items-center gap-2 text-[15px] font-semibold text-fg-primary">
        <MessageCircle size={16} className="text-accent-primary" />
        {t("discussion")}
        <span className="kairos-mono text-[12px] text-fg-quaternary">
          {commentCount}
        </span>
      </h2>

      {session ? (
        <CommentComposer
          eventId={eventId}
          placeholder={t("askTheHost")}
        />
      ) : (
        <p className="rounded-xl border border-dashed border-slate-300 px-3 py-2.5 text-sm text-fg-tertiary dark:border-white/15">
          {t("signInToComment")}
        </p>
      )}

      {threads.length === 0 ? (
        <p className="mt-4 text-sm text-fg-tertiary">{t("noCommentsYet")}</p>
      ) : (
        <ul className="mt-4 flex flex-col gap-4">
          {threads.map((thread) => (
            <Thread
              key={thread.id}
              thread={thread}
              eventId={eventId}
              hostId={hostId}
            />
          ))}
        </ul>
      )}

      {nextCursor && (
        <button
          type="button"
          onClick={() => setCursor(nextCursor)}
          disabled={isFetching}
          className="mt-4 text-sm font-semibold text-accent-primary transition-colors hover:text-accent-hover disabled:opacity-50"
        >
          {isFetching ? t("loadingMoreEvents") : t("loadMoreComments")}
        </button>
      )}
    </section>
  );
}
