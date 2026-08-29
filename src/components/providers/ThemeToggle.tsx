"use client";

import { Moon, Sun } from "~/components/ui/icons";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { api } from "~/trpc/react";

export function ThemeToggle() {
  const [mounted, setMounted] = useState(false);
  const { resolvedTheme, setTheme } = useTheme();
  const { status } = useSession();

  const updateAppearance = api.settings.updateAppearance.useMutation();

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return (
      <div className="w-10 h-10 rounded-xl bg-bg-secondary shadow-sm animate-pulse" />
    );
  }

  const isDark = resolvedTheme === "dark";
  const toggleLabel = isDark ? "Switch to light mode" : "Switch to dark mode";
  const nextTheme = isDark ? "light" : "dark";

  return (
    <button
      onClick={() => {
        setTheme(nextTheme);
        if (status === "authenticated") {
          updateAppearance.mutate({ theme: nextTheme });
        }
      }}
      className="group relative w-10 h-10 rounded-xl bg-bg-surface shadow-sm hover:shadow-md transition-all flex items-center justify-center"
      aria-label={toggleLabel}
      title={toggleLabel}
    >
      <div className="relative w-5 h-5">
        <Sun
          size={20}
          className={`absolute inset-0 text-amber-500 transition-all duration-300 ${
            isDark
              ? "rotate-90 scale-0 opacity-0"
              : "rotate-0 scale-100 opacity-100"
          }`}
        />
        <Moon
          size={20}
          className={`absolute inset-0 text-accent-primary transition-all duration-300 ${
            isDark
              ? "rotate-0 scale-100 opacity-100"
              : "-rotate-90 scale-0 opacity-0"
          }`}
        />
      </div>
    </button>
  );
}
