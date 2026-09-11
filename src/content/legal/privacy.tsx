import Link from "next/link";
import type { ReactNode } from "react";
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
 *    the export route, the account-deletion flow, the cookies actually set. Where
 *    behaviour is surprising, the document says so rather than smoothing it over:
 *    the deletion cascade reaching organizations you created, and the export
 *    covering less than a portability request, are both stated plainly.
 *
 * Keep it that way. If a statement here and the code disagree, one of them is a
 * bug, and it is usually not the policy that should change first.
 */

const CONTACT_EMAIL = "madebykairos@gmail.com";

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

const mail = (
    <a href={`mailto:${CONTACT_EMAIL}`} className="k-nav text-fg-primary">
        {CONTACT_EMAIL}
    </a>
);

const sections: LegalSection[] = [
    {
        id: "who-we-are",
        heading: "Who we are",
        body: (
            <>
                <p>
                    Kairos is a workspace for planning work with a team and publishing the events that
                    come out of it. This policy covers the Kairos web application at
                    kairosonline.net and the accounts, organizations, and content inside it.
                </p>
                <p>
                    Kairos is built and operated by an individual developer in Bulgaria as an
                    independent project, not by a registered company. That person is the data
                    controller for everything described here and can be reached at {mail}. Because
                    Kairos is neither a public authority nor an organisation whose core activity is
                    large-scale monitoring or processing of special-category data, no data protection
                    officer is appointed; requests go to the address above and are answered by the
                    person who runs the service.
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
                    To generate a reply we send the relevant part of your prompt and the surrounding
                    context to <strong className="font-semibold text-fg-primary">NVIDIA</strong>, whose
                    hosted inference endpoints run the models behind these features. We send only what
                    the request needs — the conversation in front of you and the records it refers to —
                    never your password hash, your tokens, or content from workspaces you are not a
                    member of. Prompts are sent for inference and to keep the service running, not as
                    training data; NVIDIA&apos;s own terms for these endpoints govern what it may do
                    with them, and we do not grant any provider permission to train on your content.
                </p>
                <p>
                    We also generate embeddings — numeric representations of your text — so the
                    assistant can find relevant notes and tasks. These are stored in our own database
                    alongside the content they describe.
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
        heading: "Signing in and connecting other services",
        body: (
            <>
                <p>
                    If you sign in through an identity provider instead of a password, we store the
                    identifiers and tokens that provider returns so we can recognise you next time. We
                    do not receive your password for that service. Sessions are stored server-side and
                    end when you sign out or when they expire.
                </p>
                <p>
                    Separately, you can connect a calendar so Kairos can show your real schedule
                    alongside your work. Connecting one stores an access and refresh token for that
                    account, encrypted at rest, plus the events Kairos reads from it. The tokens are
                    scoped to your calendar and nothing else, the connection is listed in{" "}
                    {settingsLink} with the account it belongs to, and disconnecting it there deletes
                    the tokens and the imported events.
                </p>
            </>
        ),
    },
    {
        id: "cookies",
        heading: "Cookies and local storage",
        body: (
            <>
                <p>Kairos sets three cookies, all of them functional:</p>
                <Bullets
                    items={[
                        "A session cookie, which is what keeps you signed in. It ends when the session does.",
                        <>
                            <code className="font-mono text-[15px]">kairos.accounts</code> — remembers
                            the accounts you switch between on this device, so you can move between
                            them without signing in again. Server-signed, HTTP-only, and it expires
                            after 30 days.
                        </>,
                        <>
                            <code className="font-mono text-[15px]">NEXT_LOCALE</code> — the language
                            you picked, so the next page loads in it. It lasts a year.
                        </>,
                    ]}
                />
                <p>
                    A few display preferences — light or dark theme, accent colour, whether you have
                    dismissed the intro, where you like the notification panel — are kept in your
                    browser&apos;s local storage rather than in a cookie. They never leave your device.
                </p>
                <p>
                    We do not set advertising cookies, and we do not run third-party analytics or
                    tracking scripts. Fonts are served from Kairos itself rather than a font CDN, so
                    browsing the product does not disclose your visit to a font provider. That is why
                    you are not being asked to accept a cookie banner. If that ever changes, this
                    section changes with it and we will ask for your consent first.
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
                        "Profile visibility — whether other people in the product can see your profile, and who counts as “other people”: everyone, your organization, or only people you share work with.",
                        "Online status — whether others can see when you are active.",
                        "Activity tracking — off by default.",
                        "Product data collection — off by default.",
                    ]}
                />
                <p>
                    The last two are off unless you switch them on, and switching them off again stops
                    the collection from that moment. You can also manage your notification preferences
                    in the same place.
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
                    We use a small set of service providers to run Kairos. They act on our instructions,
                    under their own published data processing terms, and only for the purposes below:
                </p>
                <Bullets
                    items={[
                        <>
                            <strong className="font-semibold text-fg-primary">Supabase</strong> —
                            managed Postgres, hosted in the European Union (Ireland). This holds
                            everything described above.
                        </>,
                        <>
                            <strong className="font-semibold text-fg-primary">UploadThing</strong> —
                            storage for the files and images you upload.
                        </>,
                        <>
                            <strong className="font-semibold text-fg-primary">Resend</strong> —
                            transactional email: address verification, password resets, and the
                            notifications you asked to receive by mail.
                        </>,
                        <>
                            <strong className="font-semibold text-fg-primary">NVIDIA</strong> — hosted
                            model inference for the AI features described above.
                        </>,
                        <>
                            <strong className="font-semibold text-fg-primary">
                                Our own realtime server
                            </strong>{" "}
                            — delivers live updates and presence inside the product. It runs on our
                            infrastructure, not a third party&apos;s.
                        </>,
                    ]}
                />
                <p>
                    There is no map embedded in the product. When an event has a location, Kairos shows
                    a link that opens OpenStreetMap in a new tab — nothing is loaded from them unless
                    you click it, and then you are visiting their site under their terms.
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
                    until you or a collaborator with permission deletes it; account data, security
                    state, agent audit trails and webhook delivery logs stay until you close your
                    account, and are removed with it.
                </p>
                <p>
                    Assistant conversations are currently kept for as long as your account is open. The
                    product can age them out on plans with a limited history window — messages older
                    than the window are deleted and a summary of the thread survives in their place —
                    but no such limit applies to any account today.
                </p>
                <p>
                    Closing your account from the security section of {settingsLink} deletes it
                    immediately, and the deletion reaches further than most:
                </p>
                <Bullets
                    items={[
                        "Your profile, preferences, sessions, sign-in methods, API keys, assistant conversations, connected calendars and uploaded files are deleted.",
                        <>
                            <strong className="font-semibold text-fg-primary">
                                Any organization you created is deleted too
                            </strong>{" "}
                            — along with the projects, tasks and content inside it, including work
                            contributed by its other members. If you share an organization with people
                            who need to keep it, transfer it or hand over ownership before you close
                            your account.
                        </>,
                        "Where an item belongs to someone else, your identity is detached from it rather than the item being destroyed: tasks you created or were assigned inside someone else's project survive without you on them, and messages you sent in a direct conversation remain visible to the person you sent them to, no longer linked to an account.",
                    ]}
                />
                <p>
                    Backups taken by our database provider may retain deleted rows for a short period
                    before they roll off, in line with that provider&apos;s backup schedule. We do not
                    restore backups to recover data a user has deleted.
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
                    object to particular uses. Two of these are built into the product and need no
                    request:
                </p>
                <Bullets
                    items={[
                        "Export — download your tasks, notes and events from your settings, as CSV, Markdown, or an ICS calendar file.",
                        "Deletion — close your account and delete your data from the security section of your settings.",
                    ]}
                />
                <p>
                    The built-in export is narrower than a full access or portability request: it covers
                    tasks, notes and events, not your profile, direct messages, organization
                    memberships, or assistant conversations. So if you want everything, ask. Write to
                    {" "}
                    {mail} and we will assemble the rest by hand and send it to you in a structured,
                    machine-readable file. That is free, and it does not depend on what you pay for
                    Kairos.
                </p>
                <p>
                    We answer requests within one month of receiving them. If a request is unusually
                    complex we may extend that by up to two further months, and we will tell you inside
                    the first month if we need to. To protect your account we may first need to confirm
                    that the request comes from you.
                </p>
                <p>
                    If you think we have handled your data badly, please tell us first — it is usually
                    the fastest way to fix it. You also have the right to complain to a supervisory
                    authority. Ours is the Bulgarian Commission for Personal Data Protection (Комисия
                    за защита на личните данни), 2 Prof. Tsvetan Lazarov Blvd, Sofia 1592, cpdp.bg. If
                    you live elsewhere in the EU you may complain to the authority where you live
                    instead.
                </p>
            </>
        ),
    },
    {
        id: "legal-basis",
        heading: "Why we are allowed to process it",
        body: (
            <>
                <p>
                    Each thing we do with your data rests on one of these grounds:
                </p>
                <Bullets
                    items={[
                        "Performance of a contract — your account, your content, the collaboration features, and the AI features you choose to use. These are the service you asked for; without this data there is no product to deliver.",
                        "Legitimate interests — keeping accounts from being taken over, and keeping records of what changed and who changed it. This covers failed sign-in counts, lockouts, activity logs and agent audit trails. We keep it to the minimum that serves the purpose.",
                        "Consent — optional features that are off until you switch them on, namely activity tracking and product data collection, and any email you opt into. You can withdraw consent at any time in your settings; withdrawing it does not affect what was lawfully processed before.",
                        "Legal obligation — where we have to keep or disclose something to comply with the law.",
                    ]}
                />
            </>
        ),
    },
    {
        id: "transfers",
        heading: "Where your data goes",
        body: (
            <p>
                The database that holds your account and your content is hosted in the European Union.
                Three of the providers listed above may process data outside the European Economic Area
                in the course of their service — NVIDIA for model inference, UploadThing for file
                storage, and Resend for outgoing email. Those transfers rely on the European
                Commission&apos;s Standard Contractual Clauses as incorporated into each
                provider&apos;s data processing terms, together with the technical measures described
                here: encryption in transit throughout, and encryption at rest for credentials and
                connected-service tokens.
            </p>
        ),
    },
    {
        id: "children",
        heading: "Children",
        body: (
            <p>
                Kairos is built for teams at work and is not aimed at children. You must be at least 14
                to have an account, which is the age at which Bulgarian law lets someone consent to a
                service like this one on their own. If we learn that an account belongs to someone
                younger, we delete the account and its content without asking for anything further. If
                you believe a child has an account here, write to {mail} and we will act on it.
            </p>
        ),
    },
    {
        id: "changes",
        heading: "Changes to this policy",
        body: (
            <p>
                When this policy changes we update the date at the top of the page. If a change affects
                how we use your data — a new processor, a new purpose, a shorter or longer retention
                period — we will tell you in the product and by email at least 14 days before it takes
                effect, so you have time to read it and, if you disagree, to export your data and close
                your account. Changes that merely clarify wording take effect when published.
            </p>
        ),
    },
];

export const privacyPolicy = {
    lastUpdated: "11 September 2026",
    intro: (
        <>
            <p>
                This page explains what Kairos collects, why, who else touches it, and what you can do
                about it. It is written as a description of the system rather than as boilerplate: every
                statement below describes what the product actually does today, including the parts that
                are awkward to admit.
            </p>
            <p>
                If something here is unclear, or you want data we have not made downloadable, write to
                {" "}
                {mail} and a person will answer.
            </p>
        </>
    ),
    sections,
};
