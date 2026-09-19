import { getTranslations } from "next-intl/server";

import { SystemScreen } from "~/components/ui/SystemScreen";

/**
 * The full-page loading state, shown while a route outside the app shell
 * resolves. The in-app routes each draw a skeleton of their own layout instead
 * — see `components/ui/Skeleton`.
 */
export default async function Loading() {
  const t = await getTranslations("errors.loading");

  return <SystemScreen eyebrow={t("eyebrow")} title={t("title")} />;
}
