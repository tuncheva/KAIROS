"use client";

import { useEffect, useRef, useState } from "react";

const LETTERS = ["K", "A", "I", "R", "O", "S"] as const;

/** Curtain lifts at 2.3s over .9s; the page below is handed back at 2.5s. */
const CLEAR_MS = 2500;
const UNMOUNT_MS = 3200;

/**
 * First-load wordmark curtain. It sits *above* an already-rendered, already
 * interactive page — nothing is deferred behind it. It plays once per session
 * (gated pre-paint by the head script in `layout.tsx`, which also skips it
 * under reduced motion), and any input during playback jumps to the end.
 */
export function LandingIntro({ onClear }: { onClear: () => void }) {
    const [mounted, setMounted] = useState(true);
    const curtainRef = useRef<HTMLDivElement>(null);
    const clearedRef = useRef(false);

    useEffect(() => {
        const root = document.documentElement;

        // The head script already decided; a repeat visit never plays.
        if (root.dataset.kairosIntro !== "play") {
            clearedRef.current = true;
            setMounted(false);
            onClear();
            return;
        }

        try {
            sessionStorage.setItem("kairos-intro-seen", "1");
        } catch {
            /* private mode — the intro simply plays again next load */
        }

        let unmountTimer: ReturnType<typeof setTimeout>;

        const clear = () => {
            if (clearedRef.current) return;
            clearedRef.current = true;
            root.dataset.kairosIntro = "seen";
            onClear();
        };

        const finish = () => {
            clear();
            setMounted(false);
        };

        const skip = () => {
            if (clearedRef.current) return;
            curtainRef.current?.classList.add("k-intro-skip");
            clear();
            clearTimeout(unmountTimer);
            unmountTimer = setTimeout(() => setMounted(false), 200);
        };

        const clearTimer = setTimeout(clear, CLEAR_MS);
        unmountTimer = setTimeout(finish, UNMOUNT_MS);

        const opts = { passive: true } as const;
        window.addEventListener("keydown", skip);
        window.addEventListener("pointerdown", skip, opts);
        window.addEventListener("wheel", skip, opts);
        window.addEventListener("touchstart", skip, opts);

        return () => {
            clearTimeout(clearTimer);
            clearTimeout(unmountTimer);
            window.removeEventListener("keydown", skip);
            window.removeEventListener("pointerdown", skip);
            window.removeEventListener("wheel", skip);
            window.removeEventListener("touchstart", skip);
        };
    }, [onClear]);

    if (!mounted) return null;

    return (
        <div ref={curtainRef} className="k-intro" aria-hidden="true">
            <div className="k-intro-word">
                {LETTERS.map((letter, i) => (
                    <span key={i} className="k-intro-ch">
                        {letter}
                    </span>
                ))}
            </div>
            <div className="k-intro-track">
                <div className="k-intro-fill" />
            </div>
        </div>
    );
}
