"use client";

import { useEffect, useState } from "react";
import { User, Loader2, Check } from "lucide-react";
import { api } from "~/trpc/react";
import { useUploadThing } from "~/lib/uploadthing";
import { useSession } from "next-auth/react";
import { ImageUpload } from "~/components/ui/ImageUpload";
import { useTranslations } from "next-intl";
import { useDateFormat } from "~/hooks/useDateFormat";

type Translator = (key: string, values?: Record<string, unknown>) => string;

interface ProfileSettingsClientProps {
 user: {
 name?: string | null;
 email?: string | null;
 image?: string | null;
 bio?: string | null;
 id?: string;
 };
}

export function ProfileSettingsClient({ user }: ProfileSettingsClientProps) {
 const useT = useTranslations as unknown as (namespace: string) => Translator;
  const t = useT("settings");
 const { formatDate: formatDatePref } = useDateFormat();
 const utils = api.useUtils();
 const { update: updateSession, status } = useSession();
 const enabled = status === "authenticated";
 const [name, setName] = useState(user.name ?? "");
 const [bio, setBio] = useState(user.bio ?? "");
 const [imagePreview, setImagePreview] = useState(user.image ?? "");
 const [isUploading, setIsUploading] = useState(false);
 const [isSaving, setIsSaving] = useState(false);
 

 const { startUpload } = useUploadThing("imageUploader");

 const { data: userProfile } = api.user.getProfile.useQuery(undefined, {
 enabled,
 retry: false,
 refetchOnWindowFocus: false,
 });
 const { data: currentUser } = api.user.getCurrentUser.useQuery(undefined, {
 enabled,
 retry: false,
 refetchOnWindowFocus: false,
 });

 useEffect(() => {
 if (isUploading) return;
 if (!currentUser?.image) return;
 if (currentUser.image === imagePreview) return;
 setImagePreview(currentUser.image);
 }, [currentUser?.image, imagePreview, isUploading]);

 const updateProfile = api.settings.updateProfile.useMutation({
 onMutate: async (newData) => {
 setIsSaving(true);
 await utils.user.getCurrentUser.cancel();
 const previousUser = utils.user.getCurrentUser.getData();
 
 utils.user.getCurrentUser.setData(undefined, (old) => {
 if (!old) return old;
 return {
 ...old,
 name: newData.name ?? old.name,
 bio: newData.bio ?? old.bio,
 };
 });
 
 return { previousUser };
 },
 
 onSuccess: () => {
 setIsSaving(false);
 },
 
 onError: (error, _newData, context) => {
 setIsSaving(false);
 
 if (context?.previousUser) {
 utils.user.getCurrentUser.setData(undefined, context.previousUser);
 }
 },
 
 onSettled: () => {
 void utils.user.getCurrentUser.invalidate();
 },
 });

 
 const uploadImageMutation = api.user.uploadProfileImage?.useMutation({
 onSuccess: (data: { imageUrl: string }) => {
 setImagePreview(data.imageUrl);
 setIsUploading(false);

 utils.user.getCurrentUser.setData(undefined, (old) => {
 if (!old) return old;
 return { ...old, image: data.imageUrl };
 });
 utils.user.getProfile.setData(undefined, (old) => {
 if (!old) return old;
 return { ...old, image: data.imageUrl };
 });

 void utils.user.getCurrentUser.invalidate();
 void utils.user.getProfile.invalidate();

 // Refresh event feed/comment avatars that come from cached queries.
 void utils.event.getPublicEvents.invalidate();

 // Make sure NextAuth's session (used across the app) reflects the new image.
 // Without this, places like the event comment composer can keep showing the old avatar.
 void updateSession?.({ user: { image: data.imageUrl } });
 },
  onError: () => {
    setIsUploading(false);
  },
 });

 const handleImageUpload = async (file: File) => {
 if (!uploadImageMutation) {
 return;
 }

 setIsUploading(true);

 try {
 const uploadResult = await startUpload([file]);
 const url = uploadResult?.[0]?.url;
 if (!url) throw new Error("Upload failed");
 uploadImageMutation.mutate({
 image: url,
 filename: file.name,
 });
    } catch {
      setIsUploading(false);
    }
 };

 const handleSubmit = (e: React.FormEvent) => {
 e.preventDefault();
 updateProfile.mutate({ 
 name: name || undefined, 
 bio: bio || undefined 
 });
 };

 const getJoinedDate = () => {
 // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
 const createdAt = (userProfile as any)?.createdAt as string | Date | undefined;
 
 if (!createdAt) return null;
 
 return formatDatePref(new Date(createdAt), "withYear");
 };

  const joinedDate = getJoinedDate();
  const imageFormatsText = `${t("profile.imageFormats")} ${t("profile.imageMaxSize", { size: "4MB" })}`;

 return (
 <div className="w-full h-full overflow-y-auto bg-bg-primary">
 <div className="w-full px-4 sm:px-6">
 {/* Header */}
 <div className="pt-8 pb-6">
 <h1 className="text-[34px] font-[700] leading-[1.1] tracking-[-0.022em] text-fg-primary mb-2">
 {(() => {
 try {
 return t("profile.title");
 } catch {
 return "Profile";
 }
 })()}
 </h1>
 <p className="text-[15px] leading-[1.4667] tracking-[-0.01em] text-fg-tertiary">
 {(() => {
 try {
 return t("profile.subtitle");
 } catch {
 return "Manage your profile and preferences";
 }
 })()}
 </p>
 </div>

 <form onSubmit={handleSubmit}>
 {/* Profile Picture Card */}
 <div className="mb-8">
 <div className="bg-bg-secondary rounded-[10px] overflow-hidden border border-white/[0.06]">
 <div className="pl-[16px] pr-[18px] py-[11px]">
 <div className="flex items-center justify-between">
 <div className="flex items-center gap-[13px]">
 <div className="w-[30px] h-[30px] rounded-full bg-bg-tertiary flex items-center justify-center">
 <User size={18} className="text-fg-secondary" strokeWidth={2.2} />
 </div>
 <div className="flex-1">
 <div className="text-[13px] leading-[1.3846] tracking-[-0.006em] text-fg-secondary mb-[1px]">
 {(() => {
 try {
 return t("profile.profilePicture");
 } catch {
 return "Profile Picture";
 }
 })()}
 </div>
 <div className="text-[15px] leading-[1.4667] tracking-[-0.012em] text-fg-primary font-[590]">
  {imageFormatsText}
 </div>
 </div>
 </div>
 <div className="ml-4">
 <ImageUpload
 imagePreview={imagePreview}
 onImageChange={handleImageUpload}
 onImagePreviewChange={setImagePreview}
 isUploading={isUploading}
 label=""
 description=""
 />
 </div>
 </div>
 </div>
 </div>
 </div>

 {/* Full Name Card */}
 <div className="mb-8">
 <div className="bg-bg-secondary rounded-[10px] overflow-hidden border border-white/[0.06]">
 <div className="pl-[16px] pr-[18px] py-[11px]">
 <div className="flex items-center justify-between">
 <div className="flex items-center gap-[13px]">
 <div className="w-[30px] h-[30px] rounded-full bg-bg-tertiary flex items-center justify-center">
 <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
 <path d="M12 12C14.21 12 16 10.21 16 8C16 5.79 14.21 4 12 4C9.79 4 8 5.79 8 8C8 10.21 9.79 12 12 12ZM12 14C9.33 14 4 15.34 4 18V20H20V18C20 15.34 14.67 14 12 14Z" 
 fill="currentColor" className="text-fg-secondary"/>
 </svg>
 </div>
 <div className="flex-1">
 <div className="text-[13px] leading-[1.3846] tracking-[-0.006em] text-fg-secondary mb-[1px]">
 {(() => {
 try {
 return t("profile.fullName");
 } catch {
 return "Full Name";
 }
 })()}
 </div>
 <input
 type="text"
 value={name}
 onChange={(e) => setName(e.target.value)}
 className="w-full bg-transparent text-[15px] leading-[1.4667] tracking-[-0.012em] text-fg-primary font-[590] focus:outline-none placeholder:text-fg-tertiary"
 placeholder={(() => {
 try {
 return t("profile.namePlaceholder");
 } catch {
 return "Enter your full name";
 }
 })()}
 />
 </div>
 </div>
 </div>
 </div>
 </div>
 </div>

 {/* Email Address Card */}
 <div className="mb-8">
 <div className="bg-bg-secondary rounded-[10px] overflow-hidden border border-white/[0.06]">
 <div className="pl-[16px] pr-[18px] py-[11px]">
 <div className="flex items-center justify-between">
 <div className="flex items-center gap-[13px]">
 <div className="w-[30px] h-[30px] rounded-full bg-bg-tertiary flex items-center justify-center">
 <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
 <path d="M20 4H4C2.9 4 2.01 4.9 2.01 6L2 18C2 19.1 2.9 20 4 20H20C21.1 20 22 19.1 22 18V6C22 4.9 21.1 4 20 4ZM20 8L12 13L4 8V6L12 11L20 6V8Z" 
 fill="currentColor" className="text-fg-secondary"/>
 </svg>
 </div>
 <div className="flex-1">
 <div className="text-[13px] leading-[1.3846] tracking-[-0.006em] text-fg-secondary mb-[1px]">
 {(() => {
 try {
 return t("profile.emailAddress");
 } catch {
 return "Email Address";
 }
 })()}
 </div>
 <div className="text-[15px] leading-[1.4667] tracking-[-0.012em] text-fg-primary font-[590] opacity-60">
 {user.email}
 </div>
 <div className="text-[13px] leading-[1.3846] tracking-[-0.006em] text-fg-tertiary mt-1">
 {(() => {
 try {
 return t("profile.emailNote");
 } catch {
 return "Email cannot be changed";
 }
 })()}
 </div>
 </div>
 </div>
 </div>
 </div>
 </div>
 </div>

 {/* Bio Card */}
 <div className="mb-8">
 <div className="bg-bg-secondary rounded-[10px] overflow-hidden border border-white/[0.06]">
 <div className="pl-[16px] pr-[18px] py-[11px]">
 <div className="flex items-center justify-between">
 <div className="flex items-center gap-[13px]">
 <div className="w-[30px] h-[30px] rounded-full bg-bg-tertiary flex items-center justify-center">
 <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
 <path d="M18 2H6C4.9 2 4 2.9 4 4V20C4 21.1 4.9 22 6 22H18C19.1 22 20 21.1 20 20V4C20 2.9 19.1 2 18 2ZM9 4H11V9L10 8.25L9 9V4ZM18 20H6V4H7V13L10 10.75L13 13V4H18V20Z" 
 fill="currentColor" className="text-fg-secondary"/>
 </svg>
 </div>
 <div className="flex-1">
 <div className="text-[13px] leading-[1.3846] tracking-[-0.006em] text-fg-secondary mb-[1px]">
 {(() => {
 try {
 return t("profile.bio");
 } catch {
 return "Bio";
 }
 })()}
 </div>
 <textarea
 rows={3}
 value={bio}
 onChange={(e) => setBio(e.target.value.slice(0, 100))}
 maxLength={100}
 className="w-full bg-transparent text-[15px] leading-[1.4667] tracking-[-0.012em] text-fg-primary font-[590] focus:outline-none placeholder:text-fg-tertiary resize-none"
 placeholder={(() => {
 try {
 return t("profile.bioPlaceholder");
 } catch {
 return "Tell us a little about yourself...";
 }
 })()}
 />
 <div className="text-[13px] leading-[1.3846] tracking-[-0.006em] text-fg-tertiary mt-2">
 {bio.length}/100 {(() => {
 try {
 return t("profile.characters");
 } catch {
 return "characters";
 }
 })()}
 </div>
 </div>
 </div>
 </div>
 </div>
 </div>
 </div>

 {/* Member Since Card */}
 {joinedDate && (
 <div className="mb-8">
 <div className="bg-bg-secondary rounded-[10px] overflow-hidden border border-white/[0.06]">
 <div className="pl-[16px] pr-[18px] py-[11px]">
 <div className="flex items-center justify-between">
 <div className="flex items-center gap-[13px]">
 <div className="w-[30px] h-[30px] rounded-full bg-bg-tertiary flex items-center justify-center">
 <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
 <path d="M11.99 2C6.47 2 2 6.48 2 12C2 17.52 6.47 22 11.99 22C17.52 22 22 17.52 22 12C22 6.48 17.52 2 11.99 2ZM12 20C7.58 20 4 16.42 4 12C4 7.58 7.58 4 12 4C16.42 4 20 7.58 20 12C20 16.42 16.42 20 12 20ZM12.5 7H11V13L16.25 16.15L17 14.92L12.5 12.25V7Z" 
 fill="currentColor" className="text-fg-secondary"/>
 </svg>
 </div>
 <div className="flex-1">
 <div className="text-[13px] leading-[1.3846] tracking-[-0.006em] text-fg-secondary mb-[1px]">
 {(() => {
 try {
 return t("profile.memberSince");
 } catch {
 return "Member Since";
 }
 })()}
 </div>
 <div className="text-[15px] leading-[1.4667] tracking-[-0.012em] text-fg-primary font-[590]">
 {joinedDate}
 </div>
 </div>
 </div>
 </div>
 </div>
 </div>
 </div>
 )}

 {/* Save Button Card */}
 <div className="mb-6">
 <div className="bg-bg-secondary rounded-[10px] overflow-hidden border border-white/[0.06]">
 <div className="px-4 py-4">
 <div className="flex items-center gap-2">
 <button
 type="submit"
 disabled={isSaving}
 className={`px-4 py-2 rounded-[8px] text-[14px] leading-[1.4286] tracking-[-0.012em] font-[590] transition-all duration-200 flex items-center justify-center gap-2 ${
 isSaving
 ? "bg-bg-tertiary text-fg-secondary cursor-not-allowed"
 : "text-white active:opacity-80 hover:opacity-90"
 }`}
 style={!isSaving ? { backgroundColor: `rgb(var(--accent-primary))` } : undefined}
 >
 {isSaving ? (
 <>
 <Loader2 className="animate-spin" size={16} />
 {(() => {
 try {
 return t("profile.saving");
 } catch {
 return "Saving...";
 }
 })()}
 </>
 ) : (
 (() => {
 try {
 return t("profile.updateProfile");
 } catch {
 return "Update Profile";
 }
 })()
 )}
 </button>
 <button
 type="reset"
 disabled={isSaving}
 className="ml-auto px-4 py-2 rounded-[8px] text-[14px] leading-[1.4286] tracking-[-0.012em] font-[590] transition-all duration-200 bg-bg-tertiary text-fg-primary hover:bg-bg-tertiary/80 active:opacity-80 disabled:cursor-not-allowed disabled:opacity-60"
 >
  {t("security.cancel")}
  </button>
 </div>
 </div>
 </div>
 </div>

 {/* Success Message */}
 {!isSaving && updateProfile.isSuccess && (
 <div className="mb-6">
 <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800/40 rounded-[10px] overflow-hidden">
 <div className="px-4 py-3.5">
 <div className="flex items-center justify-center gap-2">
 <Check size={20} className="text-green-600 dark:text-green-400" strokeWidth={3} />
 <span className="text-[15px] leading-[1.4667] tracking-[-0.012em] text-green-600 dark:text-green-400">
 {(() => {
 try {
 return t("profile.saveSuccess");
 } catch {
 return "Profile updated successfully";
 }
 })()}
 </span>
 </div>
 </div>
 </div>
 </div>
 )}

 {/* Bottom Spacing */}
 <div className="h-8"></div>
 </form>
 </div>
 </div>
 );
}
