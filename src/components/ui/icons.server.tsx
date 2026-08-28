/**
 * Phosphor-backed replacements for the icon names this app used to import
 * from `lucide-react`. Importing from here instead of the icon package keeps
 * the call sites unchanged: the same names, the same `size`/`className`, and
 * `strokeWidth` still works — it is translated to the nearest Phosphor weight.
 *
 * Server-component twin of `icons.tsx`, built on Phosphor's SSR entry so these render with no client-side JavaScript.
 *
 * To restyle an icon app-wide, change its mapping in both this file and its
 * counterpart, so client and server render the same glyph.
 */

import type { Icon, IconWeight } from "@phosphor-icons/react";
import {
  ArchiveIcon as PhosphorArchive,
  ArrowBendUpLeftIcon as PhosphorArrowBendUpLeft,
  ArrowClockwiseIcon as PhosphorArrowClockwise,
  ArrowDownIcon as PhosphorArrowDown,
  ArrowLeftIcon as PhosphorArrowLeft,
  ArrowRightIcon as PhosphorArrowRight,
  ArrowSquareOutIcon as PhosphorArrowSquareOut,
  ArrowUUpLeftIcon as PhosphorArrowUUpLeft,
  ArrowUpIcon as PhosphorArrowUp,
  ArrowUpRightIcon as PhosphorArrowUpRight,
  ArrowsClockwiseIcon as PhosphorArrowsClockwise,
  ArrowsOutSimpleIcon as PhosphorArrowsOutSimple,
  BellIcon as PhosphorBell,
  BellRingingIcon as PhosphorBellRinging,
  BellSlashIcon as PhosphorBellSlash,
  BookBookmarkIcon as PhosphorBookBookmark,
  BookOpenIcon as PhosphorBookOpen,
  BookmarkSimpleIcon as PhosphorBookmarkSimple,
  BoxArrowUpIcon as PhosphorBoxArrowUp,
  BrainIcon as PhosphorBrain,
  BriefcaseIcon as PhosphorBriefcase,
  BroadcastIcon as PhosphorBroadcast,
  BuildingsIcon as PhosphorBuildings,
  CalendarBlankIcon as PhosphorCalendarBlank,
  CalendarCheckIcon as PhosphorCalendarCheck,
  CalendarDotIcon as PhosphorCalendarDot,
  CalendarIcon as PhosphorCalendar,
  CalendarPlusIcon as PhosphorCalendarPlus,
  CalendarXIcon as PhosphorCalendarX,
  CameraIcon as PhosphorCamera,
  CaretDownIcon as PhosphorCaretDown,
  CaretLeftIcon as PhosphorCaretLeft,
  CaretRightIcon as PhosphorCaretRight,
  CaretUpIcon as PhosphorCaretUp,
  ChartBarIcon as PhosphorChartBar,
  ChatCircleIcon as PhosphorChatCircle,
  ChatTeardropIcon as PhosphorChatTeardrop,
  CheckCircleIcon as PhosphorCheckCircle,
  CheckIcon as PhosphorCheck,
  CheckSquareIcon as PhosphorCheckSquare,
  ChecksIcon as PhosphorChecks,
  CircleNotchIcon as PhosphorCircleNotch,
  ClockIcon as PhosphorClock,
  CloudSlashIcon as PhosphorCloudSlash,
  CopyIcon as PhosphorCopy,
  DotsThreeIcon as PhosphorDotsThree,
  DownloadSimpleIcon as PhosphorDownloadSimple,
  EnvelopeIcon as PhosphorEnvelope,
  EraserIcon as PhosphorEraser,
  EyeIcon as PhosphorEye,
  EyeSlashIcon as PhosphorEyeSlash,
  FileTextIcon as PhosphorFileText,
  FlagIcon as PhosphorFlag,
  FolderOpenIcon as PhosphorFolderOpen,
  FunnelSimpleIcon as PhosphorFunnelSimple,
  GearSixIcon as PhosphorGearSix,
  GlobeIcon as PhosphorGlobe,
  GridFourIcon as PhosphorGridFour,
  HeartIcon as PhosphorHeart,
  HouseIcon as PhosphorHouse,
  ImageIcon as PhosphorImage,
  ImageSquareIcon as PhosphorImageSquare,
  InfoIcon as PhosphorInfo,
  KanbanIcon as PhosphorKanban,
  KeyIcon as PhosphorKey,
  LightningIcon as PhosphorLightning,
  LinkSimpleIcon as PhosphorLinkSimple,
  ListIcon as PhosphorList,
  LockIcon as PhosphorLock,
  LockOpenIcon as PhosphorLockOpen,
  MagnifyingGlassIcon as PhosphorMagnifyingGlass,
  MapPinIcon as PhosphorMapPin,
  MapTrifoldIcon as PhosphorMapTrifold,
  MegaphoneIcon as PhosphorMegaphone,
  MoonIcon as PhosphorMoon,
  NoteBlankIcon as PhosphorNoteBlank,
  PaletteIcon as PhosphorPalette,
  PaperPlaneTiltIcon as PhosphorPaperPlaneTilt,
  PaperclipIcon as PhosphorPaperclip,
  PencilSimpleIcon as PhosphorPencilSimple,
  PlusIcon as PhosphorPlus,
  PulseIcon as PhosphorPulse,
  PushPinIcon as PhosphorPushPin,
  PushPinSlashIcon as PhosphorPushPinSlash,
  QrCodeIcon as PhosphorQrCode,
  QuestionIcon as PhosphorQuestion,
  RobotIcon as PhosphorRobot,
  ScanIcon as PhosphorScan,
  ShareNetworkIcon as PhosphorShareNetwork,
  ShieldCheckIcon as PhosphorShieldCheck,
  ShieldIcon as PhosphorShield,
  ShieldSlashIcon as PhosphorShieldSlash,
  SidebarIcon as PhosphorSidebar,
  SidebarSimpleIcon as PhosphorSidebarSimple,
  SignInIcon as PhosphorSignIn,
  SignOutIcon as PhosphorSignOut,
  SlidersHorizontalIcon as PhosphorSlidersHorizontal,
  SmileyIcon as PhosphorSmiley,
  SortDescendingIcon as PhosphorSortDescending,
  SparkleIcon as PhosphorSparkle,
  SquaresFourIcon as PhosphorSquaresFour,
  SunIcon as PhosphorSun,
  TagIcon as PhosphorTag,
  TrashIcon as PhosphorTrash,
  TreeStructureIcon as PhosphorTreeStructure,
  TrendUpIcon as PhosphorTrendUp,
  UploadSimpleIcon as PhosphorUploadSimple,
  UserIcon as PhosphorUser,
  UserMinusIcon as PhosphorUserMinus,
  UserPlusIcon as PhosphorUserPlus,
  UsersIcon as PhosphorUsers,
  WarningCircleIcon as PhosphorWarningCircle,
  WrenchIcon as PhosphorWrench,
  XIcon as PhosphorX,
} from "@phosphor-icons/react/ssr";

export type IconProps = Omit<React.ComponentPropsWithoutRef<Icon>, "weight"> & {
  /** Lucide-style stroke width, mapped onto the closest Phosphor weight. */
  strokeWidth?: number;
  weight?: IconWeight;
};

function weightFor(strokeWidth: number | undefined): IconWeight {
  if (strokeWidth === undefined) return "regular";
  if (strokeWidth <= 1.75) return "light";
  if (strokeWidth >= 2.2) return "bold";
  return "regular";
}

function lucideCompat(Base: Icon) {
  return function PhosphorIcon({
    strokeWidth,
    weight,
    size = 24,
    ...props
  }: IconProps) {
    return (
      <Base size={size} weight={weight ?? weightFor(strokeWidth)} {...props} />
    );
  };
}

export const Activity = /*#__PURE__*/ lucideCompat(PhosphorPulse);
export const AlertCircle = /*#__PURE__*/ lucideCompat(PhosphorWarningCircle);
export const Archive = /*#__PURE__*/ lucideCompat(PhosphorArchive);
export const ArchiveRestore = /*#__PURE__*/ lucideCompat(PhosphorBoxArrowUp);
export const ArrowDown = /*#__PURE__*/ lucideCompat(PhosphorArrowDown);
export const ArrowDownWideNarrow = /*#__PURE__*/ lucideCompat(
  PhosphorSortDescending,
);
export const ArrowLeft = /*#__PURE__*/ lucideCompat(PhosphorArrowLeft);
export const ArrowRight = /*#__PURE__*/ lucideCompat(PhosphorArrowRight);
export const ArrowUp = /*#__PURE__*/ lucideCompat(PhosphorArrowUp);
export const ArrowUpRight = /*#__PURE__*/ lucideCompat(PhosphorArrowUpRight);
export const BarChart3 = /*#__PURE__*/ lucideCompat(PhosphorChartBar);
export const Bell = /*#__PURE__*/ lucideCompat(PhosphorBell);
export const BellOff = /*#__PURE__*/ lucideCompat(PhosphorBellSlash);
export const BellRing = /*#__PURE__*/ lucideCompat(PhosphorBellRinging);
export const BookOpen = /*#__PURE__*/ lucideCompat(PhosphorBookOpen);
export const BookText = /*#__PURE__*/ lucideCompat(PhosphorBookBookmark);
export const Bookmark = /*#__PURE__*/ lucideCompat(PhosphorBookmarkSimple);
export const Bot = /*#__PURE__*/ lucideCompat(PhosphorRobot);
export const Brain = /*#__PURE__*/ lucideCompat(PhosphorBrain);
export const BrainCircuit = /*#__PURE__*/ lucideCompat(PhosphorBrain);
export const Briefcase = /*#__PURE__*/ lucideCompat(PhosphorBriefcase);
export const Building2 = /*#__PURE__*/ lucideCompat(PhosphorBuildings);
export const Calendar = /*#__PURE__*/ lucideCompat(PhosphorCalendar);
export const CalendarCheck = /*#__PURE__*/ lucideCompat(PhosphorCalendarCheck);
export const CalendarClock = /*#__PURE__*/ lucideCompat(PhosphorCalendarDot);
export const CalendarDays = /*#__PURE__*/ lucideCompat(PhosphorCalendarBlank);
export const CalendarPlus = /*#__PURE__*/ lucideCompat(PhosphorCalendarPlus);
export const CalendarX = /*#__PURE__*/ lucideCompat(PhosphorCalendarX);
export const Camera = /*#__PURE__*/ lucideCompat(PhosphorCamera);
export const Check = /*#__PURE__*/ lucideCompat(PhosphorCheck);
export const CheckCheck = /*#__PURE__*/ lucideCompat(PhosphorChecks);
export const CheckCircle2 = /*#__PURE__*/ lucideCompat(PhosphorCheckCircle);
export const CheckCircle = /*#__PURE__*/ lucideCompat(PhosphorCheckCircle);
export const CheckSquare = /*#__PURE__*/ lucideCompat(PhosphorCheckSquare);
export const ChevronDown = /*#__PURE__*/ lucideCompat(PhosphorCaretDown);
export const ChevronLeft = /*#__PURE__*/ lucideCompat(PhosphorCaretLeft);
export const ChevronRight = /*#__PURE__*/ lucideCompat(PhosphorCaretRight);
export const ChevronUp = /*#__PURE__*/ lucideCompat(PhosphorCaretUp);
export const Clock = /*#__PURE__*/ lucideCompat(PhosphorClock);
export const CloudOff = /*#__PURE__*/ lucideCompat(PhosphorCloudSlash);
export const Copy = /*#__PURE__*/ lucideCompat(PhosphorCopy);
export const CornerUpLeft = /*#__PURE__*/ lucideCompat(PhosphorArrowBendUpLeft);
export const Download = /*#__PURE__*/ lucideCompat(PhosphorDownloadSimple);
export const Eraser = /*#__PURE__*/ lucideCompat(PhosphorEraser);
export const Eye = /*#__PURE__*/ lucideCompat(PhosphorEye);
export const EyeOff = /*#__PURE__*/ lucideCompat(PhosphorEyeSlash);
export const FileText = /*#__PURE__*/ lucideCompat(PhosphorFileText);
export const Filter = /*#__PURE__*/ lucideCompat(PhosphorFunnelSimple);
export const Flag = /*#__PURE__*/ lucideCompat(PhosphorFlag);
export const FolderKanban = /*#__PURE__*/ lucideCompat(PhosphorKanban);
export const FolderOpen = /*#__PURE__*/ lucideCompat(PhosphorFolderOpen);
export const Globe = /*#__PURE__*/ lucideCompat(PhosphorGlobe);
export const Heart = /*#__PURE__*/ lucideCompat(PhosphorHeart);
export const HelpCircle = /*#__PURE__*/ lucideCompat(PhosphorQuestion);
export const Home = /*#__PURE__*/ lucideCompat(PhosphorHouse);
export const ImageIcon = /*#__PURE__*/ lucideCompat(PhosphorImage);
export const ImagePlus = /*#__PURE__*/ lucideCompat(PhosphorImageSquare);
export const Info = /*#__PURE__*/ lucideCompat(PhosphorInfo);
export const KeyRound = /*#__PURE__*/ lucideCompat(PhosphorKey);
export const LayoutDashboard = /*#__PURE__*/ lucideCompat(PhosphorSquaresFour);
export const LayoutGrid = /*#__PURE__*/ lucideCompat(PhosphorGridFour);
export const Link2 = /*#__PURE__*/ lucideCompat(PhosphorLinkSimple);
export const List = /*#__PURE__*/ lucideCompat(PhosphorList);
export const ListTree = /*#__PURE__*/ lucideCompat(PhosphorTreeStructure);
export const Loader2 = /*#__PURE__*/ lucideCompat(PhosphorCircleNotch);
export const Lock = /*#__PURE__*/ lucideCompat(PhosphorLock);
export const LockOpen = /*#__PURE__*/ lucideCompat(PhosphorLockOpen);
export const LogIn = /*#__PURE__*/ lucideCompat(PhosphorSignIn);
export const LogOut = /*#__PURE__*/ lucideCompat(PhosphorSignOut);
export const Mail = /*#__PURE__*/ lucideCompat(PhosphorEnvelope);
export const Map = /*#__PURE__*/ lucideCompat(PhosphorMapTrifold);
export const MapPin = /*#__PURE__*/ lucideCompat(PhosphorMapPin);
export const Maximize2 = /*#__PURE__*/ lucideCompat(PhosphorArrowsOutSimple);
export const Megaphone = /*#__PURE__*/ lucideCompat(PhosphorMegaphone);
export const Menu = /*#__PURE__*/ lucideCompat(PhosphorList);
export const MessageCircle = /*#__PURE__*/ lucideCompat(PhosphorChatCircle);
export const MessageSquare = /*#__PURE__*/ lucideCompat(PhosphorChatTeardrop);
export const Moon = /*#__PURE__*/ lucideCompat(PhosphorMoon);
export const MoreHorizontal = /*#__PURE__*/ lucideCompat(PhosphorDotsThree);
export const Palette = /*#__PURE__*/ lucideCompat(PhosphorPalette);
export const PanelLeftClose = /*#__PURE__*/ lucideCompat(PhosphorSidebarSimple);
export const PanelLeftOpen = /*#__PURE__*/ lucideCompat(PhosphorSidebar);
export const Paperclip = /*#__PURE__*/ lucideCompat(PhosphorPaperclip);
export const Pencil = /*#__PURE__*/ lucideCompat(PhosphorPencilSimple);
export const Pin = /*#__PURE__*/ lucideCompat(PhosphorPushPin);
export const PinOff = /*#__PURE__*/ lucideCompat(PhosphorPushPinSlash);
export const Plus = /*#__PURE__*/ lucideCompat(PhosphorPlus);
export const QrCode = /*#__PURE__*/ lucideCompat(PhosphorQrCode);
export const Radar = /*#__PURE__*/ lucideCompat(PhosphorBroadcast);
export const RefreshCw = /*#__PURE__*/ lucideCompat(PhosphorArrowsClockwise);
export const RotateCw = /*#__PURE__*/ lucideCompat(PhosphorArrowClockwise);
export const ScanLine = /*#__PURE__*/ lucideCompat(PhosphorScan);
export const Search = /*#__PURE__*/ lucideCompat(PhosphorMagnifyingGlass);
export const Send = /*#__PURE__*/ lucideCompat(PhosphorPaperPlaneTilt);
export const Settings = /*#__PURE__*/ lucideCompat(PhosphorGearSix);
export const Share2 = /*#__PURE__*/ lucideCompat(PhosphorShareNetwork);
export const Shield = /*#__PURE__*/ lucideCompat(PhosphorShield);
export const ShieldCheck = /*#__PURE__*/ lucideCompat(PhosphorShieldCheck);
export const ShieldOff = /*#__PURE__*/ lucideCompat(PhosphorShieldSlash);
export const SlidersHorizontal = /*#__PURE__*/ lucideCompat(
  PhosphorSlidersHorizontal,
);
export const Smile = /*#__PURE__*/ lucideCompat(PhosphorSmiley);
export const Sparkles = /*#__PURE__*/ lucideCompat(PhosphorSparkle);
export const SquareArrowOutUpRight = /*#__PURE__*/ lucideCompat(
  PhosphorArrowSquareOut,
);
export const StickyNote = /*#__PURE__*/ lucideCompat(PhosphorNoteBlank);
export const Sun = /*#__PURE__*/ lucideCompat(PhosphorSun);
export const Tag = /*#__PURE__*/ lucideCompat(PhosphorTag);
export const Trash2 = /*#__PURE__*/ lucideCompat(PhosphorTrash);
export const TrendingUp = /*#__PURE__*/ lucideCompat(PhosphorTrendUp);
export const Undo2 = /*#__PURE__*/ lucideCompat(PhosphorArrowUUpLeft);
export const Upload = /*#__PURE__*/ lucideCompat(PhosphorUploadSimple);
export const User = /*#__PURE__*/ lucideCompat(PhosphorUser);
export const UserMinus = /*#__PURE__*/ lucideCompat(PhosphorUserMinus);
export const UserPlus = /*#__PURE__*/ lucideCompat(PhosphorUserPlus);
export const Users = /*#__PURE__*/ lucideCompat(PhosphorUsers);
export const Wrench = /*#__PURE__*/ lucideCompat(PhosphorWrench);
export const X = /*#__PURE__*/ lucideCompat(PhosphorX);
export const Zap = /*#__PURE__*/ lucideCompat(PhosphorLightning);
