"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslations } from "next-intl";
import { useSession } from "next-auth/react";
import { useModalBehavior } from "~/components/ui/Modal";
import { modalExitMs } from "~/components/ui/modalExit";
import { KairosMark } from "~/components/layout/KairosMark";
import {
  X,
  ChevronDown,
  LayoutDashboard,
  Briefcase,
  BookText,
  CalendarCheck,
  Users,
  Mail,
  MessageCircle,
  Sparkles,
} from "~/components/ui/icons";

/**
 * The global "Getting started · FAQ · Contact" sheet.
 *
 * It is the same overlay the design doc calls the Kairos Onboarding Sheet: a
 * dark, full-screen card that opens on first login and, from then on, whenever
 * someone taps the Kairos mark anywhere in the app. Two entry points share one
 * body:
 *
 * - A `kairos:openOnboarding` window event, dispatched by the Kairos marks in
 *   the rail, the mobile topbar and the marketing header.
 * - An automatic open on first sign-in, tracked in localStorage
 *   (`kairos:onboarding-seen`) so it happens once per browser rather than once
 *   per navigation.
 *
 * It is deliberately informational — it must never gate the app. The hard
 * first-login gate is `RoleSelectionModal` (which owns the same purple mark),
 * and the sheet mounts alongside it without fighting it.
 */

const SEEN_KEY = "kairos:onboarding-seen";

/** Opens the sheet from anywhere — the Kairos marks call this. */
export function openOnboarding() {
  window.dispatchEvent(new CustomEvent("kairos:openOnboarding"));
}

type Tab = "getting-started" | "faq" | "contact";

export function OnboardingSheet() {
  const t = useTranslations("onboardingSheet");
  /* The automatic open is "on first login", so it must wait for a session: a
     brand-new visitor to the marketing landing page has not logged in yet and
     should not get the sheet forced on them. The mark click, by contrast, works
     for everyone. */
  const { status: sessionStatus } = useSession();

  const [isOpen, setIsOpen] = useState(false);
  const [tab, setTab] = useState<Tab>("getting-started");
  const [mounted, setMounted] = useState(false);
  const [firstRun, setFirstRun] = useState(false);
  /* Dismissed, but still on screen playing its exit — `isOpen` stays true for
     these frames so the close isn't an instant unmount. */
  const [closing, setClosing] = useState(false);

  /* Portal target needs the DOM, and the seen flag needs the browser. Both are
     effects so the server render and the first client frame stay stable. */
  useEffect(() => setMounted(true), []);
  useEffect(() => {
    try {
      setFirstRun(localStorage.getItem(SEEN_KEY) !== "1");
    } catch {
      setFirstRun(false);
    }
  }, []);

  /* Two ways in: the explicit event (any Kairos mark), and — once, on a signed-in
     browser that has never seen the sheet — the automatic first-login open. The
     seen flag is only written on an actual dismiss, so reopening from the mark
     does not silently swallow the first-run welcome. */
  const authed = sessionStatus === "authenticated";
  useEffect(() => {
    /* Re-opening mid-exit cancels the pending teardown, or the sheet would
       reappear and then wipe itself off screen a moment later. */
    const onOpen = () => {
      setClosing(false);
      setTab("getting-started");
      setIsOpen(true);
    };
    window.addEventListener("kairos:openOnboarding", onOpen);

    if (firstRun && authed) {
      const timer = window.setTimeout(() => {
        setClosing(false);
        setTab("getting-started");
        setIsOpen(true);
      }, 600);
      return () => {
        window.clearTimeout(timer);
        window.removeEventListener("kairos:openOnboarding", onOpen);
      };
    }
    return () => window.removeEventListener("kairos:openOnboarding", onOpen);
  }, [firstRun, authed]);

  /* Request the exit: write the seen flag, then let the closing animation play
     before the effect below unmounts the sheet. */
  const dismiss = useCallback(() => {
    try {
      localStorage.setItem(SEEN_KEY, "1");
    } catch {
      /* private mode — the sheet simply reopens next visit */
    }
    setFirstRun(false);
    setClosing(true);
  }, []);

  /* The exit is already running when `closing` flips; hold the sheet mounted for
     the animation's duration, then drop it. */
  useEffect(() => {
    if (!closing) return;
    const timer = window.setTimeout(() => {
      setClosing(false);
      setIsOpen(false);
    }, modalExitMs());
    return () => window.clearTimeout(timer);
  }, [closing]);

  const shellRef = useRef<HTMLDivElement>(null);
  useModalBehavior({ containerRef: shellRef, onDismiss: dismiss, enabled: isOpen });

  if (!mounted || !isOpen) return null;

  return createPortal(
    /* A solid backdrop so the sheet reads as its own surface over either the
       light app or the dark landing — the sheet is dark regardless of theme. */
    <div
      className={`onboarding-sheet-scrim fixed inset-0 z-[120] flex items-center justify-center overscroll-contain bg-[#050507]/92 p-4 backdrop-blur-sm ${
        closing ? "onboarding-sheet-scrim--out" : ""
      }`}
      onClick={(e) => {
        if (e.target === e.currentTarget) dismiss();
      }}
    >
      <div
        ref={shellRef}
        role="dialog"
        aria-modal="true"
        aria-label={t("title")}
        className={`onboarding-sheet-dialog dark relative flex max-h-[88dvh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#08080c] text-fg-primary shadow-2xl ${
          closing ? "onboarding-sheet-dialog--out" : ""
        }`}
      >
        {/* Purple drift, matching the landing wash */}
        <div
          className="pointer-events-none absolute -top-24 -left-24 h-72 w-72 rounded-full blur-[90px]"
          aria-hidden="true"
          style={{
            background:
              "radial-gradient(circle at 45% 45%, rgb(var(--accent-primary) / 0.22), transparent 66%)",
          }}
        />

        <header className="relative flex items-center justify-between border-b border-white/[0.08] px-6 py-4">
          <div className="flex items-center gap-3">
            <KairosMark size={26} />
            <span className="font-mono text-[11px] font-medium uppercase tracking-[0.18em] text-fg-tertiary">
              {t("eyebrow")}
            </span>
          </div>
          <button
            type="button"
            onClick={dismiss}
            aria-label={t("close")}
            className="flex h-9 w-9 items-center justify-center rounded-lg text-fg-tertiary transition-colors hover:bg-white/5 hover:text-fg-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary"
          >
            <X size={18} />
          </button>
        </header>

        <div className="relative flex-1 overflow-y-auto px-6 pt-8 pb-10 sm:px-10">
          <h1 className="font-display text-4xl leading-[1.05] font-normal tracking-[-0.01em]">
            {t("title")}
          </h1>
          <p className="mt-3 max-w-md text-[15px] leading-relaxed text-fg-secondary">
            {t("subtitle")}
          </p>

          {/* Tabs */}
          <div className="mt-8 flex flex-wrap gap-2 border-b border-white/[0.08] pb-4">
            {(
              [
                { id: "getting-started", label: t("tabs.gettingStarted") },
                { id: "faq", label: t("tabs.faq") },
                { id: "contact", label: t("tabs.contact") },
              ] as const
            ).map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setTab(item.id)}
                aria-pressed={tab === item.id}
                className={`rounded-full px-4 py-2 font-mono text-[11px] uppercase tracking-[0.12em] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary ${
                  tab === item.id
                    ? "bg-accent-primary text-white"
                    : "border border-white/10 text-fg-tertiary hover:border-white/20 hover:text-fg-primary"
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>

          <div className="mt-8">
            {tab === "getting-started" && <GettingStarted />}
            {tab === "faq" && <Faq />}
            {tab === "contact" && <Contact />}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

const STEPS = [
  { icon: LayoutDashboard, key: "steps.dashboard" },
  { icon: Briefcase, key: "steps.projects" },
  { icon: BookText, key: "steps.notes" },
  { icon: CalendarCheck, key: "steps.calendar" },
  { icon: Users, key: "steps.orgs" },
  { icon: Sparkles, key: "steps.ai" },
] as const;

function GettingStarted() {
  const t = useTranslations("onboardingSheet");

  return (
    <div className="space-y-3">
      {STEPS.map(({ icon: Icon, key }) => (
        <div
          key={key}
          className="flex items-start gap-4 rounded-xl border border-white/[0.08] bg-white/[0.02] p-4"
        >
          <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent-primary/15 text-accent-primary">
            <Icon size={18} />
          </span>
          <p className="text-sm leading-relaxed text-fg-secondary">{t(key)}</p>
        </div>
      ))}
    </div>
  );
}

const FAQ = [
  { key: "faqItems.0.q", answerKey: "faqItems.0.a" },
  { key: "faqItems.1.q", answerKey: "faqItems.1.a" },
  { key: "faqItems.2.q", answerKey: "faqItems.2.a" },
  { key: "faqItems.3.q", answerKey: "faqItems.3.a" },
  { key: "faqItems.4.q", answerKey: "faqItems.4.a" },
] as const;

function Faq() {
  const t = useTranslations("onboardingSheet");
  const [openIndex, setOpenIndex] = useState<number | null>(0);

  return (
    <div className="divide-y divide-white/[0.08] rounded-xl border border-white/[0.08]">
      {FAQ.map((item, i) => {
        const isOpen = openIndex === i;
        return (
          <div key={item.key}>
            <button
              type="button"
              onClick={() => setOpenIndex(isOpen ? null : i)}
              aria-expanded={isOpen}
              className="flex w-full items-center justify-between gap-4 px-4 py-4 text-left transition-colors hover:bg-white/[0.02] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary"
            >
              <span className="text-[15px] font-medium text-fg-primary">{t(item.key)}</span>
              <ChevronDown
                size={18}
                className={`shrink-0 text-fg-tertiary transition-transform duration-300 ${isOpen ? "rotate-180" : ""}`}
              />
            </button>
            <div
              className={`grid transition-[grid-template-rows] duration-300 ease-out ${
                isOpen ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
              }`}
            >
              <div className="overflow-hidden">
                <p className="px-4 pb-4 text-sm leading-relaxed text-fg-secondary">
                  {t(item.answerKey)}
                </p>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

const CONTACT = [
  { icon: Mail, key: "contact.email" },
  { icon: MessageCircle, key: "contact.chat" },
  { icon: Users, key: "contact.org" },
] as const;

function Contact() {
  const t = useTranslations("onboardingSheet");

  return (
    <div className="space-y-4">
      <div className="space-y-3">
        {CONTACT.map(({ icon: Icon, key }) => (
          <div
            key={key}
            className="flex items-start gap-4 rounded-xl border border-white/[0.08] bg-white/[0.02] p-4"
          >
            <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent-primary/15 text-accent-primary">
              <Icon size={18} />
            </span>
            <div>
              <p className="text-sm font-medium text-fg-primary">{t(`${key}.label`)}</p>
              <p className="mt-1 text-sm leading-relaxed text-fg-secondary">{t(`${key}.body`)}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
