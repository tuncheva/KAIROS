import type { ReactNode } from "react";
import Link from "next/link";
import type { LegalSection } from "~/components/marketing/LegalPage";

/**
 * The privacy policy, as prose in the repo rather than in the i18n message files.
 *
 * Two deliberate choices:
 *
 * 1. English only. Legal text has one authoritative wording; machine-translating it
 *    into the other four locales would produce four documents nobody has reviewed
 *    and that we could not stand behind. The `staticPages` keys are untouched — the
 *    only translated string on the page is the "back to home" link.
 *
 * 2. Every claim below is drawn from what the code actually does — the Drizzle
 *    schemas under `src/server/db/schemas`, the providers declared in `src/env.js`,
 *    the export route, the account-deletion flow. Anything that needs a human
 *    decision instead of a code reading is wrapped in <Todo>, which renders
 *    *visibly* on the page. An unreviewed policy has to look unreviewed; this makes
 *    it impossible to ship the remaining gaps by accident.
 */

/** A gap that needs a human answer before this page can be published. */
function Todo({ children }: { children: ReactNode }) {
    return (
        <span className="mx-0.5 inline-block rounded-[3px] border border-amber-400/30 bg-amber-400/[0.12] px-1.5 py-0.5 font-mono text-[11px] uppercase tracking-[0.1em] text-amber-200/90">
            To do — legal review: {children}
        </span>
    );
}

function Bullets({ items }: { items: ReactNode[] }) {
    return (
        <ul className="flex flex-col gap-2.5 text-[17px] leading-[1.65]">
            {items.map((item, i) => (
                <li key={i} className="flex gap-3">
                    <span aria-hidden className="mt-[13px] h-px w-3 shrink-0 bg-white/25" />
                    <span>{item}</span>
                </li>
            ))}
        </ul>
    );
}

const settingsLink = (
    <Link href="/settings" className="k-nav text-fg-primary">
        your settings
    </Link>
);

const sections: LegalSection[] = [
    {
        id: "who-we-are",
        heading: "Who we are",
        body: (
            <>
                <p>
                    Kairos is a workspace for planning work with a team and publishing the events that
                    come out of it. This policy covers the Kairos web application and the accounts,
                    organizations, and content inside it.
                </p>
                <p>
                    The data controller is{" "}
                    <Todo>
                        legal entity name, registered address, company number, and whether a data
                        protection officer has been appointed
                    </Todo>
                </p>
            </>
        ),
    },
    {
        id: "account-data",
        heading: "The data you give us to have an account",
        body: (
            <>
                <p>When you create an account we store:</p>
                <Bullets
                    items={[
                        "Your name, email address, and whether that address has been verified.",
                        "Your profile picture and bio, if you add them.",
                        "If you signed up with a password: a hash of it, never the password itself. Password reset codes are stored hashed the same way, alongside the hint you chose.",
                        "Security state that keeps the account yours — failed sign-in counts and lockout timestamps.",
                        "Your preferences: language, timezone, date format, theme, and accent colour.",
                    ]}
                />
                <p>
                    We use this to authenticate you, to show you the product in the language and shape
                    you asked for, and to protect the account against someone else trying to get into
                    it.
                </p>
            </>
        ),
    },
    {
        id: "content-data",
        heading: "The data you create in the product",
        body: (
            <>
                <p>
                    Almost everything else we hold is content you or your collaborators chose to put
                    into Kairos:
                </p>
                <Bullets
                    items={[
                        "Organizations and their members, roles, invitations, and join codes.",
                        "Projects and the people you share them with.",
                        "Tasks, their comments, and an activity log recording who changed what and when.",
                        "Notebooks, sticky notes, and the shares you create for them.",
                        "Events, along with RSVPs, comments, and likes.",
                        "Direct conversations and the messages in them.",
                        "Notifications generated for you, and files you upload.",
                    ]}
                />
                <p>
                    This content is visible to the people you share it with — collaborators on a
                    project, members of an organization, the recipient of a direct message. Who can see
                    what is decided by those memberships and shares, not by us.
                </p>
            </>
        ),
    },
    {
        id: "ai-features",
        heading: "AI features",
        body: (
            <>
                <p>
                    Kairos has assistant and agent features. When you use them we store your
                    conversations and the assistant&apos;s replies, any notes the assistant keeps about
                    your preferences so it stays useful between sessions, any schedules you asked it to
                    run, and the findings it surfaces to you.
                </p>
                <p>
                    Agents that can change your data — planning tasks, filing notes, publishing events,
                    administering an organization — write a record of every proposed change and every
                    applied change. That audit trail exists so you can see exactly what an agent did on
                    your behalf, and undo it.
                </p>
                <p>
                    To generate a reply we send the relevant part of your prompt and context to a
                    large-language-model provider. The provider Kairos uses is set by deployment
                    configuration rather than fixed in the code, so before this page is published:{" "}
                    <Todo>
                        name the provider(s) actually used in production, their processing location,
                        their retention window, and confirm in writing that they do not train on our
                        submissions
                    </Todo>
                </p>
                <p>
                    You can generate API keys and register webhooks to reach Kairos from your own tools.
                    We store those keys hashed, and we log webhook delivery attempts and their responses
                    so you can debug them.
                </p>
            </>
        ),
    },
    {
        id: "signing-in",
        heading: "Signing in with another service",
        body: (
            <p>
                If you sign in through an identity provider instead of a password, we store the
                identifiers and tokens that provider returns so we can recognise you next time and,
                where you granted it, act on your behalf. We do not receive your password for that
                service. Sessions are stored server-side and end when you sign out or when they expire.
            </p>
        ),
    },
    {
        id: "cookies",
        heading: "Cookies",
        body: (
            <>
                <p>Kairos sets a small number of cookies, all of them functional:</p>
                <Bullets
                    items={[
                        "A session cookie, which is what keeps you signed in.",
                        <>
                            An account-switcher cookie (
                            <code className="font-mono text-[15px]">kairos.accounts</code>), which
                            remembers the accounts you switch between on this device. It lasts 30 days.
                        </>,
                        "A locale cookie remembering the language you picked, and a theme cookie remembering light or dark.",
                    ]}
                />
                <p>
                    We do not set advertising cookies, and we do not run third-party analytics or
                    tracking scripts. That is why you are not being asked to accept a cookie banner. If
                    that ever changes, this section changes with it and we will ask for consent first.
                </p>
            </>
        ),
    },
    {
        id: "your-controls",
        heading: "Your privacy controls",
        body: (
            <>
                <p>In {settingsLink} you can turn these on or off at any time:</p>
                <Bullets
                    items={[
                        "Profile visibility — whether other people in the product can see your profile.",
                        "Online status — whether others can see when you are active.",
                        "Activity tracking — off by default.",
                        "Product data collection — off by default.",
                    ]}
                />
                <p>
                    The last two are off unless you switch them on. You can also manage your
                    notification preferences in the same place.
                </p>
            </>
        ),
    },
    {
        id: "processors",
        heading: "Who else processes your data",
        body: (
            <>
                <p>
                    We use a small set of service providers to run Kairos. They act on our instructions
                    and only for the purposes below:
                </p>
                <Bullets
                    items={[
                        "A managed Postgres database, hosted in the European Union, which holds everything described above.",
                        "A file-upload and storage provider, for the files and images you upload.",
                        "A transactional email provider, for account emails — verification, password resets, notifications.",
                        "A maps provider, used when an event has a location. Loading a map involves a request to that provider from your browser.",
                        "A large-language-model provider, for the AI features described above.",
                        "Our own realtime server, which delivers live updates and presence within the product.",
                    ]}
                />
                <p>
                    Fonts are served from Kairos itself rather than a third-party font CDN, so browsing
                    the product does not disclose your visit to a font provider.{" "}
                    <Todo>
                        name each provider explicitly and link its own privacy terms; confirm a data
                        processing agreement is in place with each
                    </Todo>
                </p>
            </>
        ),
    },
    {
        id: "retention",
        heading: "How long we keep it",
        body: (
            <>
                <p>
                    We keep your data for as long as your account is open. Content you create stays
                    until you or a collaborator with permission deletes it, and account data stays until
                    you close your account. There is one exception: on plans with a limited history
                    window, assistant messages older than that window are deleted, and what survives is
                    a summary of the conversation rather than the individual turns.
                </p>
                <p>
                    Closing your account deletes it and the content you created —{" "}
                    <Todo>
                        the deletion currently cascades further than this section describes: it also
                        removes organizations you created, along with the projects and tasks inside them,
                        including other members&apos; work. Fix the cascade or describe this behaviour
                        accurately and warn the account holder before publishing
                    </Todo>
                </p>
                <p>
                    <Todo>
                        agree a committed retention schedule — in particular for AI conversations,
                        activity and audit logs, webhook delivery logs, and server logs — and state each
                        period here rather than &quot;until you delete it&quot;
                    </Todo>
                </p>
            </>
        ),
    },
    {
        id: "your-rights",
        heading: "Your rights over your data",
        body: (
            <>
                <p>
                    If you are in the EU or the UK, data protection law gives you the right to access
                    your data, correct it, delete it, take it elsewhere, restrict how we use it, and
                    object to particular uses. Two of these are built into the product and you do not
                    need to ask us:
                </p>
                <Bullets
                    items={[
                        "Export — download your tasks, notes, and events from your settings. Which file formats you get depends on your plan.",
                        "Deletion — close your account and delete your data from the security section of your settings.",
                    ]}
                />
                <p>
                    <Todo>
                        the export is narrower than an access or portability request: it covers tasks,
                        notes, and events only — not your profile, direct messages, organization
                        memberships, or assistant conversations — and the richer formats are limited by
                        plan, with the free plan receiving tasks alone. A portability request cannot be
                        conditioned on payment, so either widen the export or commit here to fulfilling
                        these requests manually on request
                    </Todo>
                </p>
                <p>
                    For anything else, contact us and we will answer.{" "}
                    <Todo>
                        privacy contact address, the response deadline we commit to, and the supervisory
                        authority users may complain to
                    </Todo>
                </p>
            </>
        ),
    },
    {
        id: "legal-basis",
        heading: "Why we are allowed to process it",
        body: (
            <p>
                We process your account and content data because we need it to provide the service you
                asked for, and we process security data — sign-in attempts, lockouts, audit logs —
                because we have a legitimate interest in keeping accounts from being taken over.
                Optional features such as activity tracking run on your consent, which you can withdraw
                in {settingsLink}.{" "}
                <Todo>confirm this mapping of purposes to legal bases with counsel</Todo>
            </p>
        ),
    },
    {
        id: "transfers",
        heading: "Where your data goes",
        body: (
            <p>
                The primary database is hosted in the European Union. Some of the providers listed above
                may process data outside the EU — in particular the language-model and file-storage
                providers.{" "}
                <Todo>
                    identify which providers transfer data outside the EEA and state the safeguard
                    relied on for each
                </Todo>
            </p>
        ),
    },
    {
        id: "children",
        heading: "Children",
        body: (
            <p>
                Kairos is built for teams at work and is not intended for children.{" "}
                <Todo>
                    set and state a minimum age, and describe what happens if we learn an account
                    belongs to someone under it
                </Todo>
            </p>
        ),
    },
    {
        id: "changes",
        heading: "Changes to this policy",
        body: (
            <p>
                When this policy changes we update the date at the top of the page. For changes that
                affect how we use your data, we will tell you rather than expecting you to notice.{" "}
                <Todo>
                    decide how material changes are announced — in-product notice, email, or both — and
                    how much notice is given
                </Todo>
            </p>
        ),
    },
];

export const privacyPolicy = {
    lastUpdated: "24 August 2026",
    intro: (
        <>
            <p className="rounded-md border border-amber-400/25 bg-amber-400/[0.07] px-5 py-4 text-[17px] leading-[1.6] text-amber-100/85">
                <strong className="font-semibold">This is a working draft.</strong> Every statement
                below describes what the Kairos code actually does today, but the document has not been
                through legal review, and the highlighted items still need answers. Do not treat it as a
                published policy until those are resolved.
            </p>
            <p>
                This page explains what Kairos collects, why, who else touches it, and what you can do
                about it. We have tried to write it as a description of the system rather than as
                boilerplate — where the honest answer is &quot;we have not decided yet&quot;, it says
                so.
            </p>
        </>
    ),
    sections,
};
