"use client";

import { useRef } from "react";
import { Camera, Upload } from "~/components/ui/icons";
import Image from "next/image";
import { useTranslations } from "next-intl";

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

  const handleImageChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // reset input so selecting the same file again triggers onChange
    e.target.value = "";

    const maxBytes = 4 * 1024 * 1024;
    if (file.size > maxBytes) {
      throw new Error("File size must be 4MB or less");
    }

    // Check file type
    if (!file.type.startsWith("image/")) {
      throw new Error("Please upload an image file");
    }

    // Local preview only (do NOT store base64 in DB)
    const reader = new FileReader();
    reader.onloadend = () => onImagePreviewChange(reader.result as string);
    reader.readAsDataURL(file);

    await onImageChange(file);
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
          className="rounded-[7px] border border-border-medium px-[13px] py-1.5 text-[12.5px] font-medium text-fg-primary transition-colors hover:bg-bg-tertiary disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isUploading ? t("uploading") : t("uploadImage")}
        </button>
        {fileInput}
      </span>
    );
  }

  return (
    <div>
      <label className="block text-sm font-semibold text-fg-secondary mb-4">
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
            className="flex items-center gap-2 px-6 py-2 font-semibold rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed bg-fg-primary text-bg-primary hover:bg-fg-primary/90 dark:bg-bg-surface dark:text-fg-primary dark:hover:bg-bg-elevated shadow-sm"
          >
            <Upload size={18} />
            {isUploading ? t("uploading") : t("uploadImage")}
          </button>
          <p className="text-xs text-fg-secondary mt-2">
            {description}
          </p>
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
