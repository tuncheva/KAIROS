"use client";

import { useEffect, useState } from "react";
import { api } from "~/trpc/react";
import { useUploadThing } from "~/lib/uploadthing";
import { useSession } from "next-auth/react";
import { ImageUpload } from "~/components/ui/ImageUpload";
import { useTranslations } from "next-intl";
import { useDateFormat } from "~/hooks/useDateFormat";

import {
  LedgerGroup,
  LedgerInput,
  LedgerSection,
  LedgerTextarea,
  LedgerValue,
  useDebouncedCommit,
  useSectionCrumb,
  useSettingsSave,
  type LedgerRow,
} from "./ledger/Ledger";

type Translator = (key: string, values?: Record<string, unknown>) => string;

const BIO_MAX = 100;

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
  const crumb = useSectionCrumb("profile");
  const save = useSettingsSave();
  const { formatDate: formatDatePref } = useDateFormat();

  const utils = api.useUtils();
  const { update: updateSession, status } = useSession();
  const enabled = status === "authenticated";

  const [imagePreview, setImagePreview] = useState(user.image ?? "");
  const [isUploading, setIsUploading] = useState(false);

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
    onError: (_error, _newData, context) => {
      if (context?.previousUser) {
        utils.user.getCurrentUser.setData(undefined, context.previousUser);
      }
    },
    onSettled: () => {
      void utils.user.getCurrentUser.invalidate();
    },
  });

  // The persisted values, so a name typed here and a name changed in another tab
  // agree. `useDebouncedCommit` re-syncs when this moves under it.
  const persistedName = currentUser?.name ?? user.name ?? "";
  const persistedBio = currentUser?.bio ?? user.bio ?? "";

  const name = useDebouncedCommit(persistedName, (next) => {
    const trimmed = next.trim();
    // The server refuses an empty name; clearing the field is not a request to
    // become nameless, it is a name half-typed.
    if (!trimmed) return;
    return save.run(() => updateProfile.mutateAsync({ name: trimmed }));
  });

  const bio = useDebouncedCommit(persistedBio, (next) =>
    save.run(() => updateProfile.mutateAsync({ bio: next.slice(0, BIO_MAX) })),
  );

  const uploadImageMutation = api.user.uploadProfileImage?.useMutation({
    onSuccess: (data: { imageUrl: string }) => {
      setImagePreview(data.imageUrl);
      setIsUploading(false);

      utils.user.getCurrentUser.setData(undefined, (old) =>
        old ? { ...old, image: data.imageUrl } : old,
      );
      utils.user.getProfile.setData(undefined, (old) =>
        old ? { ...old, image: data.imageUrl } : old,
      );

      void utils.user.getCurrentUser.invalidate();
      void utils.user.getProfile.invalidate();

      // Refresh event feed/comment avatars that come from cached queries.
      void utils.event.getPublicEvents.invalidate();

      // Make sure NextAuth's session (used across the app) reflects the new image.
      // Without this, places like the event comment composer can keep showing the
      // old avatar.
      void updateSession?.({ user: { image: data.imageUrl } });
    },
    onError: () => {
      setIsUploading(false);
    },
  });

  const handleImageUpload = async (file: File) => {
    if (!uploadImageMutation) return;

    setIsUploading(true);
    await save.run(async () => {
      try {
        const uploadResult = await startUpload([file]);
        const url = uploadResult?.[0]?.url;
        if (!url) throw new Error("Upload failed");
        uploadImageMutation.mutate({ image: url, filename: file.name });
      } catch (e) {
        setIsUploading(false);
        throw e;
      }
    });
  };

  const createdAt = userProfile?.createdAt as string | Date | undefined;
  const joinedDate = createdAt ? formatDatePref(new Date(createdAt), "withYear") : null;

  const identityRows: LedgerRow[] = [
    {
      id: "picture",
      title: t("profile.profilePicture"),
      desc: `${t("profile.imageFormats")} ${t("profile.imageMaxSize", { size: "4MB" })}`,
      control: (
        <ImageUpload
          size="row"
          imagePreview={imagePreview}
          onImageChange={handleImageUpload}
          onImagePreviewChange={setImagePreview}
          isUploading={isUploading}
          label=""
          description=""
        />
      ),
    },
    {
      id: "name",
      title: t("profile.fullName"),
      control: (
        <LedgerInput
          value={name.value}
          onChange={name.onChange}
          onBlur={name.flush}
          ariaLabel={t("profile.fullName")}
          placeholder={t("profile.namePlaceholder")}
          maxLength={255}
        />
      ),
    },
    {
      id: "email",
      title: t("profile.emailAddress"),
      desc: t("profile.emailNote"),
      control: <LedgerValue tone="dim">{user.email}</LedgerValue>,
    },
    {
      id: "bio",
      title: t("profile.bio"),
      desc: `${bio.value.length}/${BIO_MAX} ${t("profile.characters")}`,
      descText: t("profile.characters"),
      control: (
        <LedgerTextarea
          value={bio.value}
          onChange={(next) => bio.onChange(next.slice(0, BIO_MAX))}
          onBlur={bio.flush}
          maxLength={BIO_MAX}
          ariaLabel={t("profile.bio")}
          placeholder={t("profile.bioPlaceholder")}
        />
      ),
    },
  ];

  return (
    <LedgerSection
      sectionId="profile"
      crumb={crumb}
      title={t("profile.title")}
      subtitle={t("profile.subtitle")}
    >
      <LedgerGroup
        label={t("profile.groupIdentity")}
        hint={t("profile.groupIdentityHint")}
        rows={identityRows}
      />

      {joinedDate ? (
        <LedgerGroup
          label={t("profile.groupAccount")}
          hint={t("profile.groupAccountHint")}
          rows={[
            {
              id: "joined",
              title: t("profile.memberSince"),
              control: <LedgerValue>{joinedDate}</LedgerValue>,
            },
          ]}
        />
      ) : null}
    </LedgerSection>
  );
}
