'use client';

import React, { useState, useEffect, useRef } from 'react';
import { api } from '~/trpc/react';
import { useSession } from 'next-auth/react';
import { useUploadThing } from '~/lib/uploadthing';
import Image from 'next/image';
import { X, ImagePlus, Loader2, MapPin, Calendar, Clock, Plus, ChevronDown } from 'lucide-react';
import { useToast } from "~/components/providers/ToastProvider";
import { useTranslations } from "next-intl";

const MAX_EVENT_IMAGE_BYTES = 4 * 1024 * 1024;

const REGIONS = [
  { value: 'sofia', label: 'Sofia' },
  { value: 'plovdiv', label: 'Plovdiv' },
  { value: 'varna', label: 'Varna' },
  { value: 'burgas', label: 'Burgas' },
  { value: 'ruse', label: 'Ruse' },
  { value: 'stara_zagora', label: 'Stara Zagora' },
  { value: 'pleven', label: 'Pleven' },
  { value: 'sliven', label: 'Sliven' },
  { value: 'dobrich', label: 'Dobrich' },
  { value: 'shumen', label: 'Shumen' },
] as const;

/**
 * The field the composer wants attention on when it hands the form over.
 * `title` means "just open it"; the others are the three chips.
 */
export type ComposerField = 'title' | 'date' | 'location' | 'image';

interface CreateEventFormProps {
  onSuccess?: () => void;
  onClose?: () => void;
  /** A title typed in the feed composer, so it is not retyped here. */
  initialTitle?: string;
  /** Which field to focus on open — the chip that was pressed. */
  focusField?: ComposerField;
}

export const CreateEventForm: React.FC<CreateEventFormProps> = ({
  onSuccess,
  onClose,
  initialTitle = '',
  focusField = 'title',
}) => {
  const { data: session } = useSession();
  const utils = api.useUtils();
  const toast = useToast();
  const t = useTranslations("publish");
  
  const [title, setTitle] = useState(initialTitle);
  const [description, setDescription] = useState('');
  const [eventDate, setEventDate] = useState('');
  const [eventTime, setEventTime] = useState('');
  const [location, setLocation] = useState('');
  const [region, setRegion] = useState<string>('sofia');
  const [enableRsvp, setEnableRsvp] = useState(false);
  const [sendReminders, setSendReminders] = useState(false);

  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);

  // Restore unsaved changes from localStorage
  const draftKey = 'kairos_event_draft';
  const isRestoredRef = useRef(false);
  useEffect(() => {
    if (isRestoredRef.current) return;
    isRestoredRef.current = true;
    try {
      const saved = localStorage.getItem(draftKey);
      if (saved) {
        const d = JSON.parse(saved) as Record<string, string | boolean>;
        if (Date.now() - (Number(d._ts) || 0) < 120000) { // 2 minutes
          if (d.title && !initialTitle) setTitle(d.title as string);
          if (d.description) setDescription(d.description as string);
          if (d.eventDate) setEventDate(d.eventDate as string);
          if (d.eventTime) setEventTime(d.eventTime as string);
          if (d.location) setLocation(d.location as string);
          if (d.region) setRegion(d.region as string);
        } else {
          localStorage.removeItem(draftKey);
        }
      }
    } catch { /* ignore */ }
    // `initialTitle` is read once, on the same first run as the restore.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Save changes to localStorage on unmount or change
  useEffect(() => {
    const hasContent = title || description || eventDate || eventTime || location;
    if (hasContent) {
      localStorage.setItem(draftKey, JSON.stringify({ title, description, eventDate, eventTime, location, region, _ts: Date.now() }));
    } else {
      localStorage.removeItem(draftKey);
    }
  }, [title, description, eventDate, eventTime, location, region]);

  /**
   * The chip you pressed in the composer is the field you meant to fill, so the
   * dialog opens with that one focused rather than always landing on the title.
   */
  const titleRef = useRef<HTMLInputElement | null>(null);
  const dateRef = useRef<HTMLInputElement | null>(null);
  const locationRef = useRef<HTMLInputElement | null>(null);
  const imageRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const target = {
      title: titleRef,
      date: dateRef,
      location: locationRef,
      image: imageRef,
    }[focusField];
    target.current?.focus();
    if (focusField === 'image') target.current?.click();
  }, [focusField]);

  const { startUpload } = useUploadThing("imageUploader");

  // Automatically disable sendReminders when enableRsvp is turned off
  useEffect(() => {
    if (!enableRsvp && sendReminders) {
      setSendReminders(false);
    }
  }, [enableRsvp, sendReminders]);

  const createEvent = api.event.createEvent.useMutation({
    onSuccess: () => {
      setTitle('');
      setDescription('');
      setEventDate('');
      setEventTime('');
      setLocation('');
      setRegion('sofia');
      setEnableRsvp(false);
      setSendReminders(false);
      setImageFile(null);
      setImagePreview(null);
      localStorage.removeItem(draftKey);
      void utils.event.getPublicEvents.invalidate();
      onSuccess?.();
    },
    onError: (error) => {
      console.error('Error creating event:', error);
      toast.error(error.message);
    },
  });

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // reset input so selecting the same file again triggers onChange
    e.target.value = "";

    if (!file.type.startsWith("image/")) {
      toast.error(t("validation.imageType"));
      return;
    }

    if (file.size > MAX_EVENT_IMAGE_BYTES) {
      toast.error(t("validation.imageSize"));
      return;
    }

    setImageFile(file);

    // Local preview only (do NOT store base64 in DB)
    const reader = new FileReader();
    reader.onload = () => {
      setImagePreview(reader.result as string);
    };
    reader.readAsDataURL(file);
  };

  const removeImage = () => {
    setImageFile(null);
    setImagePreview(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!session) {
      toast.error(t("validation.notLoggedIn"));
      return;
    }

    const combinedDateTime = eventDate && eventTime ? `${eventDate}T${eventTime}` : eventDate;

    if (!title.trim() || !description.trim() || !combinedDateTime || !region) {
      toast.info(t("validation.requiredFields"));
      return;
    }

    try {
      setIsUploading(true);
      let imageUrl: string | undefined;

      if (imageFile) {
        const uploadResult = await startUpload([imageFile]);
        imageUrl = uploadResult?.[0]?.url;

        if (!imageUrl) {
          toast.error(t("validation.uploadFailed"));
          return;
        }
      }

      createEvent.mutate({
        title: title.trim(),
        description: description.trim(),
        eventDate: new Date(combinedDateTime),
        region: region as "sofia" | "plovdiv" | "varna" | "burgas" | "ruse" | "stara_zagora" | "pleven" | "sliven" | "dobrich" | "shumen",
        imageUrl,
        enableRsvp,
        sendReminders: enableRsvp ? sendReminders : false,
      });
    } catch (error) {
      toast.error(t("validation.uploadError"));
      console.error(error);
    } finally {
      setIsUploading(false);
    }
  };

  if (!session) {
    return (
      <div className="p-6 text-center">
        <p className="text-sm text-fg-secondary">{t("signInToCreate")}</p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col max-h-[90vh]">
      {/* Modal Header — matches create-event.html */}
      <div className="px-6 py-4 border-b dark:border-white/5 border-slate-200 flex items-center justify-between shrink-0">
        <h2 className="text-lg font-display font-bold dark:text-white text-slate-900 tracking-tight">{t("createEvent")}</h2>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="text-accent-primary/60 hover:text-accent-primary transition-colors rounded-full p-1.5 dark:hover:bg-white/5 hover:bg-accent-primary/5"
          >
            <X size={20} />
          </button>
        )}
      </div>

      {/* Modal Body — scrollable */}
      <div className="px-6 py-5 space-y-5 overflow-y-auto flex-1">
        {/* Event Title — large display font */}
        <input
          ref={titleRef}
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={t("eventTitle")}
          maxLength={256}
          className="w-full text-xl sm:text-2xl font-bold font-display dark:text-white text-slate-900 dark:placeholder-gray-600 placeholder-slate-300 border-none focus:ring-0 px-0 bg-transparent"
          disabled={createEvent.isPending || isUploading}
          required
        />

        {/* Fields */}
        <div className="space-y-3">
          {/* Region — dropdown at top */}
          <div>
            <label className="block text-[10px] font-bold dark:text-gray-500 text-slate-500 uppercase tracking-[0.15em] mb-1.5">
              <MapPin className="inline mr-1 text-accent-primary" size={10} />
              {t("region")}
            </label>
            <div className="relative">
              <MapPin
                size={14}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-accent-primary pointer-events-none"
              />
              <select
                value={region}
                onChange={(e) => setRegion(e.target.value)}
                className="w-full pl-8 pr-8 py-2.5 dark:bg-white/5 bg-slate-50 rounded-xl text-sm dark:text-gray-200 text-slate-800 dark:border-accent-primary/20 border border-slate-200 focus:outline-none focus:ring-1 focus:ring-accent-primary/40 focus:border-accent-primary appearance-none cursor-pointer transition-all"
                disabled={createEvent.isPending || isUploading}
                required
              >
                {REGIONS.map((r) => (
                  <option key={r.value} value={r.value} className="dark:bg-[#16151A] bg-white dark:text-gray-200 text-slate-800">
                    {r.label}
                  </option>
                ))}
              </select>
              <ChevronDown
                size={14}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-accent-primary pointer-events-none"
              />
            </div>
          </div>

          {/* Location */}
          <div className="flex items-center gap-2.5 dark:bg-white/5 bg-slate-50 rounded-xl p-3 border dark:border-accent-primary/20 border-slate-200 focus-within:border-accent-primary focus-within:ring-1 focus-within:ring-accent-primary/40 transition-all">
            <MapPin size={16} className="text-accent-primary shrink-0" />
            <input
              ref={locationRef}
              type="text"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder={t("addLocation")}
              className="w-full bg-transparent border-none focus:ring-0 text-sm dark:placeholder-gray-500 placeholder-slate-400 dark:text-gray-200 text-slate-800"
              disabled={createEvent.isPending || isUploading}
            />
          </div>

          {/* Date & Time grid */}
          <div className="grid grid-cols-2 gap-3">
            <div className="flex items-center gap-2.5 dark:bg-white/5 bg-slate-50 rounded-xl p-3 border dark:border-accent-primary/20 border-slate-200 focus-within:border-accent-primary focus-within:ring-1 focus-within:ring-accent-primary/40 transition-all">
              <Calendar size={16} className="text-accent-primary shrink-0" />
              <input
                ref={dateRef}
                type="date"
                value={eventDate}
                onChange={(e) => setEventDate(e.target.value)}
                className="w-full bg-transparent border-none focus:ring-0 text-sm dark:placeholder-gray-500 placeholder-slate-400 dark:text-gray-200 text-slate-800 dark:[color-scheme:dark]"
                disabled={createEvent.isPending || isUploading}
                required
              />
            </div>
            <div className="flex items-center gap-2.5 dark:bg-white/5 bg-slate-50 rounded-xl p-3 border dark:border-accent-primary/20 border-slate-200 focus-within:border-accent-primary focus-within:ring-1 focus-within:ring-accent-primary/40 transition-all">
              <Clock size={16} className="text-accent-primary shrink-0" />
              <input
                type="time"
                value={eventTime}
                onChange={(e) => setEventTime(e.target.value)}
                className="w-full bg-transparent border-none focus:ring-0 text-sm dark:placeholder-gray-500 placeholder-slate-400 dark:text-gray-200 text-slate-800 dark:[color-scheme:dark]"
                disabled={createEvent.isPending || isUploading}
              />
            </div>
          </div>

          {/* Description */}
          <div className="dark:bg-white/5 bg-slate-50 rounded-xl p-3 border dark:border-accent-primary/20 border-slate-200 focus-within:border-accent-primary focus-within:ring-1 focus-within:ring-accent-primary/40 transition-all">
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t("eventDescription")}
              rows={3}
              className="w-full bg-transparent border-none focus:ring-0 text-sm resize-none dark:placeholder-gray-500 placeholder-slate-400 dark:text-gray-200 text-slate-800 leading-relaxed"
              disabled={createEvent.isPending || isUploading}
              required
            />
          </div>

        </div>

        {/* Image upload inline */}
        {imagePreview && (
          <div className="relative rounded-xl overflow-hidden">
            <Image
              src={imagePreview}
              alt={t("preview")}
              width={800}
              height={400}
              className="w-full aspect-video object-cover"
            />
            <button
              type="button"
              onClick={removeImage}
              className="absolute top-2 right-2 p-1.5 bg-black/60 text-white rounded-full hover:bg-black/80 transition-colors"
            >
              <X size={14} />
            </button>
          </div>
        )}

        {/* Tag Collaborators */}
        <div>
          <label className="block text-[10px] font-bold dark:text-gray-500 text-slate-500 uppercase tracking-[0.15em] mb-2">
            {t("tagCollaborators")}
          </label>
          <div className="flex items-center gap-2.5">
            <button
              type="button"
              className="w-9 h-9 rounded-full border-2 border-dashed dark:border-gray-700 border-slate-300 flex items-center justify-center dark:text-gray-500 text-slate-400 hover:text-accent-primary hover:border-accent-primary transition-all"
            >
              <Plus size={18} />
            </button>
            <span className="text-xs dark:text-gray-500 text-slate-400 font-medium">
              {t("addGuestHosts")}
            </span>
          </div>
        </div>

        {/* Toggles */}
        <div className="flex items-center gap-4">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={enableRsvp}
              onChange={(e) => setEnableRsvp(e.target.checked)}
              className="w-3.5 h-3.5 rounded dark:bg-white/5 bg-slate-100 text-accent-primary focus:ring-accent-primary/30 cursor-pointer border-accent-primary/20"
            />
            <span className="text-xs dark:text-gray-400 text-slate-600">{t("enableRsvp")}</span>
          </label>
          {enableRsvp && (
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={sendReminders}
                onChange={(e) => setSendReminders(e.target.checked)}
                className="w-3.5 h-3.5 rounded dark:bg-white/5 bg-slate-100 text-accent-primary focus:ring-accent-primary/30 cursor-pointer border-accent-primary/20"
              />
              <span className="text-xs dark:text-gray-400 text-slate-600">{t("sendReminders")}</span>
            </label>
          )}
        </div>
      </div>

      {/* Modal Footer — matches create-event.html */}
      <div className="px-6 py-4 dark:bg-white/[0.02] bg-accent-primary/[0.02] border-t dark:border-white/5 border-slate-200 flex items-center justify-between shrink-0">
        <div className="flex gap-2">
          {!imagePreview && (
            <label className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-accent-primary dark:hover:bg-white/5 hover:bg-accent-primary/5 transition-all cursor-pointer group">
              <ImagePlus size={16} className="text-accent-primary" />
              <span className="text-xs font-semibold">{t("media")}</span>
              <input
                ref={imageRef}
                type="file"
                accept="image/*"
                onChange={handleImageChange}
                className="hidden"
                disabled={createEvent.isPending || isUploading}
              />
            </label>
          )}
        </div>
        <button
          type="submit"
          disabled={createEvent.isPending || isUploading || !title.trim() || !description.trim() || !eventDate || !region}
          className="bg-accent-primary hover:bg-accent-hover text-white px-7 py-2.5 rounded-xl font-bold text-sm shadow-lg shadow-accent-primary/20 hover:scale-[1.02] active:scale-[0.98] transition-all disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:scale-100 flex items-center justify-center gap-2"
        >
          {isUploading || createEvent.isPending ? (
            <>
              <Loader2 className="animate-spin" size={14} />
              {isUploading ? t("uploading") : t("publishing")}
            </>
          ) : (
            t("publishEvent")
          )}
        </button>
      </div>
    </form>
  );
};