import { LegalPage } from "~/components/marketing/LegalPage";
import { privacyPolicy } from "~/content/legal/privacy";

export const metadata = {
    title: "Privacy Policy · KAIROS",
    description: "How Kairos collects, uses, and protects your data.",
};

export default function PrivacyPage() {
    return <LegalPage title="Privacy Policy" {...privacyPolicy} />;
}
