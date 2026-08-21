"use client";

import { useState, useMemo } from "react";
import { EventFeed, REGIONS } from "~/components/events/EventFeed";
import { SideNav } from "~/components/layout/SideNav";
import { UserDisplay } from "~/components/layout/UserDisplay";
import { EventReminderService } from "~/components/events/EventReminderService";
import { NotificationSystem } from "~/components/notifications/NotificationSystem";
import {
    MapPin,
    Calendar,
    TrendingUp,
    CheckSquare,
    ChevronRight,
    Heart,
    MessageCircle,
    Activity,
    ChevronDown,
} from "lucide-react";
import Link from "next/link";
import { api } from "~/trpc/react";
import { useTranslations } from "next-intl";

/* ─── Left Sidebar ─── */
function FeedLeftSidebar({
    selectedRegion,
    onRegionChange,
}: {
    selectedRegion: string;
    onRegionChange: (region: string) => void;
}) {
    const t = useTranslations("publish");

    return (
        <aside className="hidden lg:block lg:col-span-3 space-y-4">
            {/* Filter by Towns — dropdown */}
            <div className="dark:bg-[#16151A] bg-white rounded-xl dark:border-white/5 border border-slate-200 p-3">
                <h3 className="text-[10px] font-bold dark:text-gray-500 text-slate-500 uppercase tracking-wider mb-2">
                    {t("filterByTowns")}
                </h3>
                <div className="relative">
                    <MapPin
                        size={12}
                        className="absolute left-2.5 top-1/2 -translate-y-1/2 text-accent-primary pointer-events-none"
                    />
                    <select
                        value={selectedRegion}
                        onChange={(e) => onRegionChange(e.target.value)}
                        className="w-full pl-7 pr-7 py-2 dark:bg-white/5 bg-slate-50 dark:border-accent-primary/20 border border-slate-200 rounded-lg text-xs dark:text-gray-200 text-slate-800 focus:outline-none focus:ring-1 focus:ring-accent-primary/40 focus:border-accent-primary appearance-none cursor-pointer transition-all"
                    >
                        <option value="" className="dark:bg-[#16151A] bg-white dark:text-gray-200 text-slate-800">{t("allRegions")}</option>
                        {REGIONS.filter((r) => r.value !== "").map((region) => (
                            <option key={region.value} value={region.value} className="dark:bg-[#16151A] bg-white dark:text-gray-200 text-slate-800">
                                {region.label}
                            </option>
                        ))}
                    </select>
                    <ChevronDown
                        size={12}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-accent-primary pointer-events-none"
                    />
                </div>
            </div>
        </aside>
    );
}

/* ─── Right Sidebar ─── */
function FeedRightSidebar() {
    const t = useTranslations("publish");
    const { data: eventsData } = api.event.getPublicEvents.useQuery({ limit: 50 });

    const events = useMemo(() => eventsData?.items ?? [], [eventsData]);

    /* Compute engagement stats from the events data */
    const engagementStats = useMemo(() => {
        if (events.length === 0) return null;

        const totalLikes = events.reduce((sum, e) => sum + e.likeCount, 0);
        const totalComments = events.reduce((sum, e) => sum + e.commentCount, 0);
        const totalRsvps = events.reduce(
            (sum, e) => sum + e.rsvpCounts.going + e.rsvpCounts.maybe,
            0
        );
        const maxEngagement = Math.max(
            ...events.map((e) => e.likeCount + e.commentCount),
            1
        );

        return {
            totalLikes,
            totalComments,
            totalRsvps,
            totalEvents: events.length,
            maxEngagement,
            topEvents: [...events]
                .sort((a, b) => b.likeCount + b.commentCount - (a.likeCount + a.commentCount))
                .slice(0, 3),
        };
    }, [events]);

    return (
        <aside className="hidden md:block md:col-span-12 lg:col-span-3 space-y-4">
            {/* Quick Links */}
            <div className="dark:bg-[#16151A] bg-white rounded-xl dark:border-white/5 border border-slate-200 overflow-hidden card-shadow">
                <div className="px-3 py-2.5 border-b dark:border-white/5 border-slate-100">
                    <h3 className="font-bold text-xs dark:text-white text-slate-900">{t("quickLinks")}</h3>
                </div>
                <div className="p-1.5 space-y-0.5">
                    <Link
                        href="/calendar"
                        className="flex items-center justify-between px-2.5 py-2 dark:hover:bg-white/5 hover:bg-accent-primary/5 rounded-lg group transition-all"
                    >
                        <div className="flex items-center gap-2.5">
                            <div className="p-1.5 bg-accent-primary/10 rounded-md text-accent-primary group-hover:bg-accent-primary group-hover:text-white transition-all">
                                <Calendar size={14} />
                            </div>
                            <span className="text-xs font-semibold dark:text-gray-200 text-slate-700">
                                {t("calendar")}
                            </span>
                        </div>
                        <ChevronRight size={12} className="text-accent-primary/40" />
                    </Link>
                    <Link
                        href="/progress"
                        className="flex items-center justify-between px-2.5 py-2 dark:hover:bg-white/5 hover:bg-accent-primary/5 rounded-lg group transition-all"
                    >
                        <div className="flex items-center gap-2.5">
                            <div className="p-1.5 bg-accent-primary/10 rounded-md text-accent-primary group-hover:bg-accent-primary group-hover:text-white transition-all">
                                <TrendingUp size={14} />
                            </div>
                            <span className="text-xs font-semibold dark:text-gray-200 text-slate-700">
                                {t("progress")}
                            </span>
                        </div>
                        <ChevronRight size={12} className="text-accent-primary/40" />
                    </Link>
                    <Link
                        href="/create"
                        className="flex items-center justify-between px-2.5 py-2 dark:hover:bg-white/5 hover:bg-accent-primary/5 rounded-lg group transition-all"
                    >
                        <div className="flex items-center gap-2.5">
                            <div className="p-1.5 bg-accent-primary/10 rounded-md text-accent-primary group-hover:bg-accent-primary group-hover:text-white transition-all">
                                <CheckSquare size={14} />
                            </div>
                            <span className="text-xs font-semibold dark:text-gray-200 text-slate-700">
                                {t("tasks")}
                            </span>
                        </div>
                        <ChevronRight size={12} className="text-accent-primary/40" />
                    </Link>
                </div>
            </div>

            {/* Event Progress with engagement data */}
            <div className="dark:bg-[#16151A] bg-white rounded-xl dark:border-white/5 border border-slate-200 p-3.5 card-shadow">
                <div className="flex items-center justify-between mb-4">
                    <h3 className="font-bold text-xs dark:text-white text-slate-900">{t("eventProgress")}</h3>
                    <span className="text-[9px] font-bold uppercase tracking-widest text-accent-primary bg-accent-primary/10 px-1.5 py-0.5 rounded">
                        {t("active")}
                    </span>
                </div>

                {/* Engagement summary stats */}
                {engagementStats && (
                    <div className="grid grid-cols-3 gap-1.5 mb-4">
                        <div className="text-center p-1.5 rounded-md dark:bg-white/5 bg-accent-primary/5">
                            <Heart size={12} className="mx-auto mb-0.5 text-accent-primary" />
                            <p className="text-xs font-bold dark:text-white text-slate-900">{engagementStats.totalLikes}</p>
                            <p className="text-[9px] text-fg-tertiary">{t("likes")}</p>
                        </div>
                        <div className="text-center p-1.5 rounded-md dark:bg-white/5 bg-accent-primary/5">
                            <MessageCircle size={12} className="mx-auto mb-0.5 text-accent-primary" />
                            <p className="text-xs font-bold dark:text-white text-slate-900">{engagementStats.totalComments}</p>
                            <p className="text-[9px] text-fg-tertiary">{t("comments")}</p>
                        </div>
                        <div className="text-center p-1.5 rounded-md dark:bg-white/5 bg-accent-primary/5">
                            <Activity size={12} className="mx-auto mb-0.5 text-accent-primary" />
                            <p className="text-xs font-bold dark:text-white text-slate-900">{engagementStats.totalRsvps}</p>
                            <p className="text-[9px] text-fg-tertiary">RSVPs</p>
                        </div>
                    </div>
                )}

                {!engagementStats ? (
                    <p className="text-[10px] text-fg-tertiary">No event data yet.</p>
                ) : (
                    <div className="space-y-3">
                        {engagementStats.topEvents.map((event, i) => {
                            const progress = Math.round(
                                ((event.likeCount + event.commentCount) /
                                    engagementStats.maxEngagement) *
                                    100
                            );
                            const colorClasses = [
                                { bar: "bg-accent-primary progress-bar-glow", text: "text-accent-primary" },
                                { bar: "bg-accent-primary/60", text: "text-accent-primary/70" },
                                { bar: "bg-accent-primary/30", text: "text-accent-primary/50" },
                            ];
                            const color = colorClasses[i] ?? colorClasses[0]!;
                            return (
                                <div key={event.id}>
                                    <div className="flex justify-between items-end mb-1.5">
                                        <span className="text-[10px] font-bold dark:text-gray-400 text-slate-600 truncate mr-2">
                                            {event.title}
                                        </span>
                                        <span className={`text-[10px] font-black ${color.text} shrink-0`}>
                                            {progress}%
                                        </span>
                                    </div>
                                    <div className="h-1.5 w-full dark:bg-white/5 bg-slate-100 rounded-full overflow-hidden">
                                        <div
                                            className={`h-full ${color.bar} rounded-full transition-all duration-500`}
                                            style={{ width: `${progress}%` }}
                                        />
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}


            </div>
        </aside>
    );
}

/* ─── Main Page ─── */
export default function PublishPage() {
    const [selectedRegion, setSelectedRegion] = useState("");
    const t = useTranslations("publish");

    return (
        <div className="min-h-screen bg-bg-primary">
            <SideNav />

            <div className="rail-offset pt-16 lg:pt-0 kairos-page-enter">
                <header className="sticky top-16 lg:top-0 z-30 dark:bg-[#0A0A0C] bg-white border-b dark:border-white/5 border-slate-200">
                    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3 flex justify-between items-center">
                        <h1 className="text-lg font-bold text-fg-primary tracking-tight">{t("title")}</h1>
                        <div className="flex items-center gap-2 sm:gap-3">
                            <NotificationSystem />
                            <UserDisplay />
                        </div>
                    </div>
                </header>

                <main
                    id="main-content"
                    className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8 pb-28 lg:pb-8 grid grid-cols-1 md:grid-cols-12 gap-6 sm:gap-8"
                >
                    <EventReminderService />

                    {/* Left Sidebar — hidden on mobile */}
                    <FeedLeftSidebar
                        selectedRegion={selectedRegion}
                        onRegionChange={setSelectedRegion}
                    />

                    {/* Center Feed */}
                    <section className="col-span-1 md:col-span-12 lg:col-span-6 space-y-6">
                        <EventFeed
                            showCreateForm={true}
                            externalRegion={selectedRegion}
                            hideRegionFilter={true}
                        />
                    </section>

                    {/* Right Sidebar — hidden on mobile */}
                    <FeedRightSidebar />
                </main>

            </div>
        </div>
    );
}
