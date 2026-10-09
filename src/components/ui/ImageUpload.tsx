"use client";

import { useRef, useState } from "react";
import { Camera, Upload } from "~/components/ui/icons";
import Image from "next/image";
import { useTranslations } from "next-intl";

/** Matches `imageUploader`'s maxFileSize in app/api/uploadthing/core.ts. */
const MAX_BYTES = 4 * 1024 * 1024;
const MAX_EDGE = 1024;

/**
 * Re-encodes an image at most MAX_EDGE px on its long side. Returns null when
 * the browser cannot decode it (e.g. HEIC outside Safari), so the caller falls
 * back to the size check on the original.
 */
async function downscaleImage(file: File): Promise<File | null> {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", 0.85),
    );
    if (!blob) return null;
    const name = file.name.replace(/\.[^.]+$/, "") + ".jpg";
    return new File([blob], name, { type: "image/jpeg" });
  } catch {
    return null;
  }
}

interface ImageUploadProps {
  imagePreview: string;
  onImageChange: (file: File) => Promise<void>;
  onImagePreviewChange: (preview: string) => void;
  isUploading: boolean;
  label: string;
  description: string;
  /**
   * `row` is the settings-ledger form: a 40px avatar and a plain Replace button,
   * with no label or description block. The picker and its size/type checks are
   * the same in every variant — only the chrome around them changes.
   */
  size?: "sm" | "md" | "row";
}

export function ImageUpload({
  imagePreview,
  onImageChange,
  onImagePreviewChange,
  isUploading,
  label,
  description,
  size = "md"
}: ImageUploadProps) {
  const t = useTranslations("settings.profile");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);

  const handleImageChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // reset input so selecting the same file again triggers onChange
    e.target.value = "";
    setError(null);

    // Errors are shown inline: throwing from an event handler only reaches the
    // dev overlay, and in production the click just silently does nothing.
    if (!file.type.startsWith("image/")) {
      setError(t("imageNotImage"));
      return;
    }

    // A phone photo is routinely over the 4MB upload cap, and an avatar never
    // renders above 96px — so shrink it here rather than turn the user away.
    let upload = file;
    if (upload.size > MAX_BYTES) {
      upload = (await downscaleImage(upload)) ?? upload;
    }
    if (upload.size > MAX_BYTES) {
      setError(t("imageTooLarge"));
      return;
    }

    // Local preview only (do NOT store base64 in DB)
    const reader = new FileReader();
    reader.onloadend = () => onImagePreviewChange(reader.result as string);
    reader.readAsDataURL(upload);

    await onImageChange(upload);
  };

  const imageSize = size === "sm" ? "w-20 h-20" : "w-24 h-24";

  const fileInput = (
    <input
      ref={fileInputRef}
      type="file"
      accept="image/*"
      onChange={handleImageChange}
      className="hidden"
    />
  );

  if (size === "row") {
    return (
      <span className="flex items-center gap-3">
        {imagePreview ? (
          <Image
            src={imagePreview}
            alt=""
            width={40}
            height={40}
            unoptimized
            className="h-10 w-10 flex-none rounded-full object-cover"
          />
        ) : (
          <span className="flex h-10 w-10 flex-none items-center justify-center rounded-full bg-accent-primary/15">
            <Camera className="text-accent-primary" size={18} />
          </span>
        )}
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={isUploading}
          className="rounded-sm border border-border-medium px-[13px] py-1.5 text-settings-small font-medium text-fg-primary transition-colors hover:bg-bg-tertiary disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isUploading ? t("uploading") : t("uploadImage")}
        </button>
        {error && (
          <span role="alert" className="text-settings-small text-error">
            {error}
          </span>
        )}
        {fileInput}
      </span>
    );
  }

  return (
    <div>
      <label className="block text-settings-meta font-semibold text-fg-secondary mb-4">
        {label}
      </label>
      <div className="flex items-center gap-6">
        <div className="relative group">
          {imagePreview ? (
            <Image
              src={imagePreview}
              alt="Preview"
              width={size === "sm" ? 80 : 96}
              height={size === "sm" ? 80 : 96}
              className={`${imageSize} rounded-full object-cover border-2 border-accent-primary/30`}
            />
          ) : (
            <div className={`${imageSize} rounded-full bg-accent-primary/15 flex items-center justify-center border-2 border-accent-primary/30`}>
              <Camera className="text-accent-primary" size={size === "sm" ? 32 : 40} />
            </div>
          )}
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={isUploading}
            /* Where there is no hover this overlay is permanently on (see the
               `@media (hover: none)` rule in globals.css — without it the only
               way to change your photo is invisible on a phone). A 60% scrim
               that never lifts would leave the avatar looking switched off, so
               on touch it drops to a tint the face still reads through. */
            className="absolute inset-0 flex items-center justify-center rounded-full bg-black/60 opacity-0 transition-opacity group-hover:opacity-100 disabled:opacity-50 [@media(hover:none)]:bg-black/35"
          >
            <Camera className="text-white" size={24} />
          </button>
        </div>
        <div className="flex-1">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={isUploading}
            className="flex items-center gap-2 px-6 py-2 text-settings-small font-medium rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed bg-fg-primary text-bg-primary hover:bg-fg-primary/90 dark:bg-bg-surface dark:text-fg-primary dark:hover:bg-bg-elevated shadow-sm"
          >
            <Upload size={18} />
            {isUploading ? t("uploading") : t("uploadImage")}
          </button>
          <p className="text-settings-meta text-fg-secondary mt-2">
            {description}
          </p>
          {error && (
            <p role="alert" className="text-settings-meta text-error mt-1">
              {error}
            </p>
          )}
        </div>
      </div>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        onChange={handleImageChange}
        className="hidden"
      />
    </div>
  );
}
