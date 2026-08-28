"use client";

import Image from"next/image";
import { avatarGradientStyle } from"~/lib/avatarGradient";
import { ChevronDown } from"lucide-react";
import { useState } from"react";

interface User {
 id: string;
 name: string | null;
 email: string;
 image: string | null;
}

interface CollaboratorItemProps {
 user: User;
 permission:"read" |"write";
 isOwner: boolean;
 onUpdatePermission?: (userId: string, permission:"read" |"write") => void;
 onRemove?: (userId: string) => void;
 showControls?: boolean;
}

export function CollaboratorItem({
 user,
 permission,
 isOwner,
 onUpdatePermission,
 onRemove,
 showControls = true,
}: CollaboratorItemProps) {
 const [isPermissionOpen, setIsPermissionOpen] = useState(false);

 return (
 <div className="relative">
 <div className="flex items-center justify-between pl-4 pr-[18px] py-[11px] active:bg-bg-tertiary transition-colors">
 <div className="flex items-center gap-3 flex-1 min-w-0">
 {user.image ? (
 <Image
 src={user.image}
 alt={user.name ??"User"}
 width={30}
 height={30}
 className="rounded-full object-cover"
 />
 ) : (
 <div style={avatarGradientStyle(user.id ?? user.email)} className="w-[30px] h-[30px] rounded-full flex items-center justify-center">
 <span className="text-[13px] font-[590] text-white">
 {user.name?.[0]?.toUpperCase() ?? user.email[0]?.toUpperCase() ??"?"}
 </span>
 </div>
 )}
 <div className="flex-1 min-w-0">
 <p className="text-[17px] leading-[1.235] tracking-[-0.016em] text-fg-primary font-[590] truncate">
 {user.name ?? user.email}
 </p>
 {user.name && (
 <p className="text-[13px] leading-[1.3846] tracking-[-0.006em] text-fg-secondary truncate">
 {user.email}
 </p>
 )}
 </div>
 </div>

 <div className="flex items-center gap-2">
 {isOwner && showControls && onUpdatePermission && onRemove ? (
 <div className="relative">
 <button
 onClick={() => setIsPermissionOpen(!isPermissionOpen)}
 className="flex items-center gap-1 px-3 py-1.5 text-[13px] bg-bg-tertiary/30 rounded-lg text-fg-primary hover:bg-bg-tertiary/50 transition-colors"
 >
 <span className="font-medium">
 {permission ==="read" ?"View" :"Edit"}
 </span>
 <ChevronDown 
 size={12} 
 className={`transition-transform ${isPermissionOpen ?"rotate-180" :""}`}
 strokeWidth={2.5}
 />
 </button>

 {isPermissionOpen && (
 <div className="absolute right-0 top-full mt-1 z-10 bg-bg-secondary rounded-[10px] border border-white/[0.06] shadow-lg min-w-[120px] overflow-hidden">
 <button
 onClick={() => {
 onUpdatePermission(user.id,"read");
 setIsPermissionOpen(false);
 }}
 className="w-full text-left px-4 py-[11px] text-[17px] text-fg-primary hover:bg-bg-tertiary transition-colors"
 >
 View
 </button>
 <div className="h-[0.33px] border-t border-white/[0.04]" />
 <button
 onClick={() => {
 onUpdatePermission(user.id,"write");
 setIsPermissionOpen(false);
 }}
 className="w-full text-left px-4 py-[11px] text-[17px] text-fg-primary hover:bg-bg-tertiary transition-colors"
 >
 Edit
 </button>
 <div className="h-[0.33px] border-t border-white/[0.04]" />
 <button
 onClick={() => {
 onRemove(user.id);
 setIsPermissionOpen(false);
 }}
 className="w-full text-left px-4 py-[11px] text-[17px] text-error hover:bg-error/10 transition-colors"
 >
 Remove
 </button>
 </div>
 )}
 </div>
 ) : (
 <span className="px-3 py-1.5 text-[13px] font-medium bg-bg-tertiary/30 text-fg-tertiary rounded-lg">
 {permission ==="read" ?"View" :"Edit"}
 </span>
 )}
 </div>
 </div>
 </div>
 );
}