"use client";

import { useState } from "react";
import { api } from "~/trpc/react";
import { ChevronRight } from "~/components/ui/icons";
import { useToast } from "~/components/providers/ToastProvider";
import { useTranslations } from "next-intl";

interface RoleSelectionModalProps {
  isOpen: boolean;
  onComplete: () => void;
}

export function RoleSelectionModal({ isOpen, onComplete }: RoleSelectionModalProps) {
  const t = useTranslations("onboarding");
  const toast = useToast();
  const utils = api.useUtils();
  const [step, setStep] = useState<"choose" | "admin-setup">("choose");
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

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-lg bg-bg-elevated shadow-2xl rounded-3xl border border-accent-primary/20 kairos-page-enter overflow-hidden">
        {/* Purple gradient header */}
        <div className="h-2 bg-gradient-to-r from-accent-primary via-accent-secondary to-accent-tertiary" />
        
        <div className="p-8">
          {step === "choose" && (
            <>
              <div className="text-center mb-8">
                <div className="w-16 h-16 mx-auto mb-4 bg-gradient-to-br from-accent-primary to-accent-hover rounded-2xl flex items-center justify-center shadow-accent">
                  <span className="text-3xl font-bold text-white">K</span>
                </div>
                <h3 className="text-3xl font-bold text-fg-primary mb-2">
                  {t("welcome.title")}
                </h3>
                <p className="text-fg-secondary">
                  {t("welcome.subtitle")}
                </p>
              </div>

              <div className="space-y-4">
                <button
                  onClick={() => setStep("admin-setup")}
                  className="w-full p-6 bg-gradient-to-br from-accent-primary/10 to-accent-secondary/10 hover:from-accent-primary/20 hover:to-accent-secondary/20 rounded-2xl transition-all duration-200 text-left group border-2 border-accent-primary/30 hover:border-accent-primary/60 hover:shadow-accent"
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
                  className="w-full p-6 bg-bg-surface hover:bg-bg-tertiary rounded-2xl transition-all duration-200 text-left group disabled:opacity-50 disabled:cursor-not-allowed border-2 border-border-medium hover:border-accent-primary/40"
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <span className="text-lg font-semibold text-fg-primary block mb-1">{t("personalMode.label")}</span>
                      <span className="text-fg-tertiary text-sm">{t("personalMode.description")}</span>
                    </div>
                    <ChevronRight className="text-fg-tertiary group-hover:text-accent-primary group-hover:translate-x-1 transition-all flex-shrink-0 mt-1" size={24} />
                  </div>
                </button>
              </div>
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
              <h3 className="text-2xl font-bold text-fg-primary mb-2">{t("createOrg.formTitle")}</h3>
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
                  className="w-full px-4 py-3 bg-bg-surface shadow-sm rounded-xl focus:outline-none focus:ring-2 focus:ring-accent-primary/50 focus:border-accent-primary text-fg-primary placeholder:text-fg-tertiary border-2 border-border-medium transition-all"
                  autoFocus
                />
              </div>

              <button
                onClick={handleCreateOrganization}
                disabled={createOrganization.isPending}
                className="w-full px-6 py-4 bg-gradient-to-r from-accent-primary to-accent-hover text-white font-semibold rounded-xl hover:shadow-accent transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-none"
              >
                {createOrganization.isPending ? t("createOrg.loading") : t("createOrg.submit")}
              </button>
            </div>
          </>
        )}

        {step === "admin-setup" && generatedCode && (
          <>
            <div className="text-center mb-6">
              <div className="w-16 h-16 mx-auto mb-4 bg-gradient-to-br from-green-500 to-green-600 rounded-2xl flex items-center justify-center">
                <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <h3 className="text-2xl font-bold text-fg-primary mb-2">{t("createOrg.successTitle")}</h3>
              <p className="text-fg-secondary">{t("createOrg.sharePrompt")}</p>
            </div>

            <div className="bg-gradient-to-br from-accent-primary/10 to-accent-secondary/10 rounded-2xl p-6 text-center mb-6 border-2 border-accent-primary/30">
              <p className="text-xs text-fg-tertiary uppercase tracking-wider mb-3 font-semibold">{t("createOrg.codeLabel")}</p>
              <p className="text-4xl font-bold text-accent-primary tracking-[0.3em] font-mono mb-4">
                {generatedCode}
              </p>
              <button
                onClick={handleCopyCode}
                className="px-6 py-2 bg-accent-primary text-white rounded-lg hover:bg-accent-hover transition-colors text-sm font-semibold shadow-md hover:shadow-accent"
              >
                {t("createOrg.copyButton")}
              </button>
            </div>

            <button
              onClick={() => {
                void utils.user.checkOnboardingStatus.invalidate();
                onComplete();
              }}
              className="w-full px-6 py-4 bg-gradient-to-r from-accent-primary to-accent-hover text-white font-semibold rounded-xl hover:shadow-accent transition-all duration-200"
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
