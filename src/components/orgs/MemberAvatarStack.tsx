"use client";

import Image from "next/image";

import { avatarGradientStyle } from "~/lib/avatarGradient";
import { api } from "~/trpc/react";

/**
 * Who else is in this workspace, as a Slack-style overlapping row of faces.
 *
 * `getMembers` only requires membership in the org being asked about (not
 * admin rights), so any row this renders for is one the viewer already
 * belongs to — nothing here exposes a workspace's roster to someone outside
 * it.
 */
export function MemberAvatarStack({
  organizationId,
  max = 5,
  size = 24,
}: {
  organizationId: number;
  max?: number;
  size?: number;
}) {
  const { data: members } = api.organization.getMembers.useQuery(
    { organizationId },
    { staleTime: 60_000 },
  );

  if (!members?.length) return null;

  const shown = members.slice(0, max);
  const overflow = members.length - shown.length;

  return (
    <div className="flex items-center" style={{ paddingRight: overflow > 0 ? size * 0.5 : 0 }}>
      {shown.map((member, i) => {
        const label = member.name ?? member.email;
        return (
          <div
            key={member.id}
            title={label}
            className="rounded-full ring-2 ring-bg-surface"
            style={{ marginLeft: i === 0 ? 0 : -size * 0.35, zIndex: shown.length - i }}
          >
            {member.image ? (
              <Image
                src={member.image}
                alt=""
                width={size}
                height={size}
                unoptimized
                className="rounded-full object-cover"
                style={{ width: size, height: size }}
              />
            ) : (
              <span
                className="flex items-center justify-center rounded-full font-semibold text-white"
                style={{
                  width: size,
                  height: size,
                  fontSize: size * 0.4,
                  ...avatarGradientStyle(member.email),
                }}
              >
                {label?.[0]?.toUpperCase() ?? "?"}
              </span>
            )}
          </div>
        );
      })}
      {overflow > 0 ? (
        <div
          className="flex items-center justify-center rounded-full bg-bg-tertiary text-fg-tertiary ring-2 ring-bg-surface"
          style={{
            width: size,
            height: size,
            fontSize: size * 0.36,
            marginLeft: -size * 0.35,
            zIndex: 0,
          }}
        >
          +{overflow}
        </div>
      ) : null}
    </div>
  );
}
