import { StaticPage } from "~/components/marketing/StaticPage";

export const metadata = { title: "Contact · KAIROS" };

export default function ContactPage() {
    return <StaticPage titleKey="contactTitle" bodyKey="contactBody" />;
}
