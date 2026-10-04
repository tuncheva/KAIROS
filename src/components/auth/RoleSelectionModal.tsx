"use client";

import { useRef, useState } from "react";

import { MODAL_SCRIM, MODAL_SHELL, ModalDismiss, useModalBehavior } from "~/components/ui/Modal";
import { KairosMark } from "~/components/layout/KairosMark";
import { api } from "~/trpc/react";
import { Check, ChevronRight } from "~/components/ui/icons";
import { useToast } from "~/components/providers/ToastProvider";
import { useTranslations } from "next-intl";
import { JoinWithCodeForm } from "~/components/orgs/OrgEmptyState";

interface RoleSelectionModalProps {
  isOpen: boolean;
  onComplete: () => void;
}

export function RoleSelectionModal({ isOpen, onComplete }: RoleSelectionModalProps) {
  const t = useTranslations("onboarding");
  const tCommon = useTranslations("common");
  const toast = useToast();
  const utils = api.useUtils();
  const [step, setStep] = useState<"choose" | "admin-setup" | "join">("choose");
  const [organizationName, setOrganizationName] = useState("");
  const [generatedCode, setGeneratedCode] = useState("");

  const createOrganization = api.organization.create.useMutation({
    onSuccess: (data) => {
      setGeneratedCode(data.accessCode);
    },
    onError: (error) => {
      toast.error(error.message);
    },
  });

  const setPersonalMode = api.user.setPersonalMode.useMutation({
    onSuccess: () => {
      void utils.user.checkOnboardingStatus.invalidate();
      onComplete();
    },
    onError: (error) => {
      toast.error(error.message);
    },
  });

  const handleCreateOrganization = () => {
    if (!organizationName.trim()) {
      toast.info(t("validation.nameRequired"));
      return;
    }
    createOrganization.mutate({ name: organizationName });
  };

  const handleCopyCode = async () => {
    try {
      await navigator.clipboard.writeText(generatedCode);
      toast.success(t("notification.codeCopied"));
    } catch {
      const textArea = document.createElement("textarea");
      textArea.value = generatedCode;
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand("copy");
      document.body.removeChild(textArea);
      toast.success(t("notification.codeCopied"));
    }
  };

  const handleOrgNameKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleCreateOrganization();
    }
  };

  /* P1-27: the modal had no dismissal at all — no close control and no Escape
     handler — so a keyboard user who opened it had no way back out. Escape now
     comes from `useModalBehavior`, along with the focus trap, the focus
     restore and the scroll lock it also lacked. Onboarding is one of the two
     dialogs a *first-time* user must get through, and it had none of it. */
  const shellRef = useRef<HTMLDivElement>(null);
  useModalBehavior({ containerRef: shellRef, onDismiss: onComplete, enabled: isOpen });

  if (!isOpen) return null;

  return (
    <div className={`fixed inset-0 z-50 flex items-center justify-center p-4 ${MODAL_SCRIM}`}>
      <div
        ref={shellRef}
        role="dialog"
        aria-modal="true"
        aria-label={t("welcome.title")}
        className={`${MODAL_SHELL} kairos-page-enter max-h-[calc(100dvh-2rem)] w-full max-w-lg`}
      >
        <div className="flex flex-none justify-end px-pad-dialog pt-4 -mb-2">
          <ModalDismiss onDismiss={onComplete} label={tCommon("close")} />
        </div>

        {/* The body scrolls inside the capped shell. The shell clips its overflow,
            so on a short phone the setup form's submit button used to sit
            below the fold with nothing to scroll. */}
        <div className="min-h-0 overflow-y-auto px-pad-dialog pt-4 pb-8">
          {step === "choose" && (
            <>
              <div className="text-center mb-8">
                <KairosMark size={34} className="mx-auto mb-5" />
                <h3 className="font-display text-[28px] leading-tight font-normal text-fg-primary mb-2">
                  {t("welcome.title")}
                </h3>
                <p className="text-fg-secondary">
                  {t("welcome.subtitle")}
                </p>
              </div>

              <div className="space-y-4">
                <button
                  onClick={() => setStep("admin-setup")}
                  className="w-full p-pad-card bg-bg-surface hover:bg-bg-tertiary rounded-lg transition-colors text-left group border border-accent-primary/40 hover:border-accent-primary"
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <span className="text-lg font-semibold text-fg-primary block mb-1">{t("createOrg.label")}</span>
                      <span className="text-fg-tertiary text-sm">{t("createOrg.description")}</span>
                    </div>
                    <ChevronRight className="text-accent-primary group-hover:translate-x-1 transition-transform flex-shrink-0 mt-1" size={24} />
                  </div>
                </button>

                <button
                  onClick={() => setPersonalMode.mutate()}
                  disabled={setPersonalMode.isPending}
                  className="w-full p-pad-card bg-bg-surface hover:bg-bg-tertiary rounded-lg transition-colors text-left group disabled:opacity-50 disabled:cursor-not-allowed border border-border-medium hover:border-accent-primary/40"
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <span className="text-lg font-semibold text-fg-primary block mb-1">{t("personalMode.label")}</span>
                      <span className="text-fg-tertiary text-sm">{t("personalMode.description")}</span>
                    </div>
                    <ChevronRight className="text-fg-tertiary group-hover:text-accent-primary group-hover:translate-x-1 transition-all flex-shrink-0 mt-1" size={24} />
                  </div>
                </button>

                {/* The invited user's missing path. Without this, someone who
                    already had a code could only create a redundant org or
                    pick Personal and go hunting for the join field later. */}
                <button
                  onClick={() => setStep("join")}
                  className="w-full p-pad-card bg-bg-surface hover:bg-bg-tertiary rounded-lg transition-colors text-left group border border-border-medium hover:border-accent-primary/40"
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <span className="text-lg font-semibold text-fg-primary block mb-1">{t("joinOrg.label")}</span>
                      <span className="text-fg-tertiary text-sm">{t("joinOrg.description")}</span>
                    </div>
                    <ChevronRight className="text-fg-tertiary group-hover:text-accent-primary group-hover:translate-x-1 transition-all flex-shrink-0 mt-1" size={24} />
                  </div>
                </button>
              </div>
            </>
          )}

        {step === "join" && (
          <>
            <button
              onClick={() => setStep("choose")}
              className="text-fg-secondary hover:text-accent-primary mb-6 flex items-center gap-2 transition-colors text-sm font-medium"
            >
              &larr; {t("common.backButton")}
            </button>

            <div className="text-center mb-6">
              <h3 className="font-display text-[24px] leading-tight font-normal text-fg-primary mb-2">{t("joinOrg.formTitle")}</h3>
              <p className="text-fg-secondary text-sm">{t("joinOrg.formSubtitle")}</p>
            </div>

            {/* Same input as the `/orgs` empty state — one code field, not two. */}
            <JoinWithCodeForm onJoined={onComplete} />
          </>
        )}

        {step === "admin-setup" && !generatedCode && (
          <>
            <button
              onClick={() => setStep("choose")}
              className="text-fg-secondary hover:text-accent-primary mb-6 flex items-center gap-2 transition-colors text-sm font-medium"
            >
              &larr; {t("common.backButton")}
            </button>

            <div className="text-center mb-6">
              <h3 className="font-display text-[24px] leading-tight font-normal text-fg-primary mb-2">{t("createOrg.formTitle")}</h3>
              <p className="text-fg-secondary text-sm">{t("createOrg.formSubtitle")}</p>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-fg-secondary mb-2">
                  {t("createOrg.nameLabel")}
                </label>
                <input
                  type="text"
                  value={organizationName}
                  onChange={(e) => setOrganizationName(e.target.value)}
                  onKeyDown={handleOrgNameKeyDown}
                  placeholder={t("createOrg.namePlaceholder")}
                  className="w-full h-control-md px-4 bg-bg-surface rounded-md focus:outline-none focus:ring-2 focus:ring-accent-primary/40 focus:border-accent-primary text-fg-primary placeholder:text-fg-tertiary border border-border-medium transition-colors"
                  autoFocus
                />
              </div>

              <button
                onClick={handleCreateOrganization}
                disabled={createOrganization.isPending}
                className="w-full h-control-lg px-6 bg-accent-primary text-white font-semibold rounded-md hover:bg-accent-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {createOrganization.isPending ? t("createOrg.loading") : t("createOrg.submit")}
              </button>
            </div>
          </>
        )}

        {step === "admin-setup" && generatedCode && (
          <>
            <div className="text-center mb-6">
              <div className="w-control-lg h-control-lg mx-auto mb-4 border border-status-success-border bg-status-success-surface rounded-lg flex items-center justify-center text-status-success-ink">
                <Check size={22} />
              </div>
              <h3 className="font-display text-[24px] leading-tight font-normal text-fg-primary mb-2">{t("createOrg.successTitle")}</h3>
              <p className="text-fg-secondary">{t("createOrg.sharePrompt")}</p>
            </div>

            <div className="bg-bg-surface rounded-lg p-pad-card text-center mb-6 border border-accent-primary/40">
              <p className="font-mono text-[10px] text-fg-quaternary uppercase tracking-[0.16em] mb-3">{t("createOrg.codeLabel")}</p>
              <p className="text-[34px] text-accent-primary tracking-[0.3em] font-mono mb-4">
                {generatedCode}
              </p>
              <button
                onClick={handleCopyCode}
                className="h-control-md px-5 bg-accent-primary text-white rounded-md hover:bg-accent-hover transition-colors text-[13px] font-semibold"
              >
                {t("createOrg.copyButton")}
              </button>
            </div>

            <button
              onClick={() => {
                void utils.user.checkOnboardingStatus.invalidate();
                onComplete();
              }}
              className="w-full h-control-lg px-6 bg-accent-primary text-white font-semibold rounded-md hover:bg-accent-hover transition-colors"
            >
              {t("common.continueButton")}
            </button>
          </>
        )}
        </div>
      </div>
    </div>
  );
}
