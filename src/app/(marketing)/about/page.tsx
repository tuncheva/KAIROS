import { StaticPage } from "~/components/marketing/StaticPage";

export const metadata = { title: "About · KAIROS" };

export default function AboutPage() {
    return <StaticPage titleKey="aboutTitle" bodyKey="aboutBody" />;
}
