import { Bell, Check, ChevronDown, Copy, Edit3, FileUp, Forward, Grid2X2, Image, Languages, Laugh, Link as LinkIcon, Maximize2, MessageSquare, Mic, MicOff, Minimize2, MonitorUp, MoreHorizontal, Paperclip, Phone, PhoneOff, Pin, RefreshCcw, Reply, Search, Send, Shield, SlidersHorizontal, Speaker, Square, Trash2, UserPlus, Users, Video, VideoOff, Volume2, X } from "lucide-react";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { API_URL, WS_URL } from "../api/client";
import { callApi, chatApi, friendApi, userApi } from "../api/services";
import { useAuthStore } from "../stores/authStore";
import type { CallLog, Conversation, Friend, FriendRequest, Message, UploadedAttachment, User } from "../types";
import { RingtonePlayer } from "../utils/ringtone";
import { WebRTCClient } from "../utils/webrtc";

type ChatEvent =
  | { type: "message"; message: Message }
  | { type: "message:deleted"; message_id: number; scope: "me" | "everyone"; message?: Message }
  | { type: "typing"; conversation_id: number; user_id: number; is_typing: boolean }
  | { type: "read"; conversation_id: number; user_id: number; message_ids: number[] }
  | { type: "presence"; user_id: number; online: boolean };

type CallEvent =
  | { type: "call:ringing"; call: CallLog }
  | { type: "call:state"; call: CallLog }
  | { type: "webrtc:offer"; from_user_id: number; sdp: RTCSessionDescriptionInit }
  | { type: "webrtc:answer"; from_user_id: number; sdp: RTCSessionDescriptionInit }
  | { type: "webrtc:ice"; from_user_id: number; candidate: RTCIceCandidateInit };

type EmojiCategory = "emoji" | "gestures" | "people" | "food" | "places" | "objects" | "symbols";
type EmojiTab = "all" | EmojiCategory | "stickers" | "gifs";
type EmojiItem = { symbol: string; label: string; keywords: string };
type StickerItem = { label: string; value: string; color: string; keywords: string };
type GifItem = { label: string; value: string; icon: string; keywords: string };
type GiphyItem = { id: string; title: string; url: string; preview: string };

const GIPHY_API_KEY = import.meta.env.VITE_GIPHY_API_KEY as string | undefined;

function normalizeMessage(message: Message): Message {
  return { ...message, message_type: message.message_type ?? "text", read_by: Array.isArray(message.read_by) ? message.read_by : [] };
}

function includesNumber(values: unknown, value: number): boolean {
  return Array.isArray(values) && values.includes(value);
}

function requestSenderName(request: FriendRequest): string {
  return request.sender?.name ?? `User #${request.sender_id}`;
}

function requestSenderAvatar(request: FriendRequest): string | null {
  return request.sender?.avatar ?? null;
}

function avatarSrc(value?: string | null): string {
  if (!value) return "";
  return value.startsWith("/") ? `${API_URL}${value}` : value;
}

function isCallEvent(message: Message): boolean {
  return message.body.startsWith("__call__:");
}

function formatCallEventTime(value: string): string {
  return new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

function formatCallDuration(totalSeconds: number): string {
  const safeSeconds = Math.max(0, totalSeconds);
  const minutes = Math.floor(safeSeconds / 60);
  const seconds = safeSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function callEventText(message: Message): string {
  const [, callType, action, state, durationSeconds] = message.body.split(":");
  const label = callType === "video" ? "Video call" : "Audio call";
  if (action === "start") {
    return `${label} started at ${formatCallEventTime(message.created_at)}`;
  }
  const duration = Number.parseInt(durationSeconds ?? "0", 10);
  const stateLabel = state === "missed" ? "ended" : "ended";
  return `${label} ${stateLabel} at ${formatCallEventTime(message.created_at)} - Duration ${formatCallDuration(Number.isFinite(duration) ? duration : 0)}`;
}

function messagePreview(message?: Message, currentUserId?: number): string {
  if (!message) return "No messages yet";
  if (isCallEvent(message)) return callEventText(message);
  if (message.message_type === "image") return `${message.sender_id === currentUserId ? "You: " : ""}Photo`;
  if (message.message_type === "audio") return `${message.sender_id === currentUserId ? "You: " : ""}Voice message`;
  if (message.message_type === "video") return `${message.sender_id === currentUserId ? "You: " : ""}Video message`;
  if (message.message_type === "file") return `${message.sender_id === currentUserId ? "You: " : ""}${message.attachment_name ?? "Attachment"}`;
  if (message.message_type === "sticker") return `${message.sender_id === currentUserId ? "You: " : ""}Sticker`;
  if (message.message_type === "gif") return `${message.sender_id === currentUserId ? "You: " : ""}GIF`;
  return `${message.sender_id === currentUserId ? "You: " : ""}${message.body}`;
}

function messageUnread(message: Message | undefined, currentUserId?: number): boolean {
  return Boolean(message && message.sender_id !== currentUserId && !includesNumber(message.read_by, currentUserId ?? 0));
}

function recorderMimeType(kind: "audio" | "video"): string {
  const candidates = kind === "video"
    ? ["video/webm;codecs=vp8,opus", "video/webm;codecs=vp9,opus", "video/webm"]
    : ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus"];
  return candidates.find((type) => MediaRecorder.isTypeSupported(type)) ?? "";
}

export function MessengerPage() {
  const { user, accessToken } = useAuthStore();
  const navigate = useNavigate();
  const { conversationId } = useParams();
  const [friends, setFriends] = useState<Friend[]>([]);
  const [requests, setRequests] = useState<FriendRequest[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [lastMessages, setLastMessages] = useState<Record<number, Message | undefined>>({});
  const [messages, setMessages] = useState<Message[]>([]);
  const [mentionRecords, setMentionRecords] = useState<Message[]>([]);
  const [callHistory, setCallHistory] = useState<CallLog[]>([]);
  const [selected, setSelected] = useState<Conversation | null>(null);
  const [replyingTo, setReplyingTo] = useState<Message | null>(null);
  const [messageMenu, setMessageMenu] = useState<{ message: Message; x: number; y: number } | null>(null);
  const [pinnedMessageIds, setPinnedMessageIds] = useState<number[]>([]);
  const [locallyUnreadIds, setLocallyUnreadIds] = useState<number[]>([]);
  const [showGroupModal, setShowGroupModal] = useState(false);
  const [groupTitle, setGroupTitle] = useState("");
  const [groupMemberIds, setGroupMemberIds] = useState<number[]>([]);
  const [body, setBody] = useState("");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<User[]>([]);
  const [searchError, setSearchError] = useState("");
  const [activeView, setActiveView] = useState<"chat" | "people" | "activity">("chat");
  const [showEmojiPanel, setShowEmojiPanel] = useState(false);
  const [emojiTab, setEmojiTab] = useState<EmojiTab>("all");
  const [emojiSearch, setEmojiSearch] = useState("");
  const [giphyResults, setGiphyResults] = useState<GiphyItem[]>([]);
  const [giphyLoading, setGiphyLoading] = useState(false);
  const [showAudioMenu, setShowAudioMenu] = useState(false);
  const [noiseSuppression, setNoiseSuppression] = useState(true);
  const [showMobileDevices, setShowMobileDevices] = useState(false);
  const [typingUserId, setTypingUserId] = useState<number | null>(null);
  const [composerError, setComposerError] = useState("");
  const [uploading, setUploading] = useState(false);
  const [recordingKind, setRecordingKind] = useState<"audio" | "video" | null>(null);
  const [recordingPreview, setRecordingPreview] = useState<{ kind: "audio" | "video"; blob: Blob | null; url: string; stream?: MediaStream } | null>(null);
  const [screenSharing, setScreenSharing] = useState(false);
  const [activeCall, setActiveCall] = useState<CallLog | null>(null);
  const [callError, setCallError] = useState("");
  const [callMinimized, setCallMinimized] = useState(false);
  const [callTick, setCallTick] = useState(0);
  const [micMuted, setMicMuted] = useState(false);
  const [cameraOff, setCameraOff] = useState(false);
  const [videoMessageFacingMode, setVideoMessageFacingMode] = useState<"user" | "environment">("user");
  const [callPosition, setCallPosition] = useState({ x: 0, y: 0 });
  const [soundReady, setSoundReady] = useState(false);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [audioInputs, setAudioInputs] = useState<MediaDeviceInfo[]>([]);
  const [videoInputs, setVideoInputs] = useState<MediaDeviceInfo[]>([]);
  const [audioOutputs, setAudioOutputs] = useState<MediaDeviceInfo[]>([]);
  const [audioInputId, setAudioInputId] = useState("");
  const [videoInputId, setVideoInputId] = useState("");
  const [audioOutputId, setAudioOutputId] = useState("");
  const [pendingOffer, setPendingOffer] = useState<{ fromUserId: number; sdp: RTCSessionDescriptionInit } | null>(null);
  const chatSocket = useRef<WebSocket | null>(null);
  const callSocket = useRef<WebSocket | null>(null);
  const rtc = useRef<WebRTCClient | null>(null);
  const ringtone = useRef(new RingtonePlayer());
  const localVideo = useRef<HTMLVideoElement | null>(null);
  const remoteVideo = useRef<HTMLVideoElement | null>(null);
  const remoteAudio = useRef<HTMLAudioElement | null>(null);
  const screenStream = useRef<MediaStream | null>(null);
  const fileInput = useRef<HTMLInputElement | null>(null);
  const mediaInput = useRef<HTMLInputElement | null>(null);
  const messagesContainer = useRef<HTMLDivElement | null>(null);
  const messagesEnd = useRef<HTMLDivElement | null>(null);
  const typingTimer = useRef<number | null>(null);
  const callTimeoutTimer = useRef<number | null>(null);
  const callDrag = useRef<{ pointerId: number; startX: number; startY: number; originX: number; originY: number } | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const recordingPreviewVideo = useRef<HTMLVideoElement | null>(null);
  const recordedChunks = useRef<Blob[]>([]);
  const discardRecordingOnStop = useRef(false);
  const messageSwipe = useRef<{ id: number; x: number } | null>(null);
  const audioOutputIdRef = useRef(audioOutputId);
  const activeCallRef = useRef<CallLog | null>(activeCall);
  const localStreamRef = useRef<MediaStream | null>(localStream);
  const closedCallIds = useRef<Set<number>>(new Set());
  const callEndMessageSentIds = useRef<Set<number>>(new Set());

  const peer = selected?.peer ?? null;
  const routeConversationId = conversationId ? Number.parseInt(conversationId, 10) : null;
  const incomingRequests = useMemo(
    () => requests.filter((request) => request.receiver_id === user?.id && request.status === "pending"),
    [requests, user?.id]
  );
  const friendIds = useMemo(() => new Set(friends.map((friend) => friend.user.id)), [friends]);
  const pendingSentIds = useMemo(
    () => new Set(requests.filter((request) => request.sender_id === user?.id && request.status === "pending").map((request) => request.receiver_id)),
    [requests, user?.id]
  );
  const pendingReceivedIds = useMemo(
    () => new Set(requests.filter((request) => request.receiver_id === user?.id && request.status === "pending").map((request) => request.sender_id)),
    [requests, user?.id]
  );
  const emojiGroups: Record<Exclude<typeof emojiTab, "all" | "stickers" | "gifs">, string[]> = {
    emoji: ["😮", "😢", "😠", "😍", "😎", "🙌", "🤝", "🔥", "🎉", "👀", "💯", "💡", "✅", "➕", "❌", "🔜", "🚢", "🤔", "🥺", "😭", "🤭", "😌", "😇", "👻", "😳", "😋", "😱", "😐", "🙄", "🤩", "🤪", "😏", "🥳", "🤣", "🫡", "🤗"],
    gestures: ["👍", "👎", "👌", "✌️", "🤞", "🤟", "🤘", "👋", "👏", "🙌", "🙏", "💪", "🫶", "☝️", "👊", "🤙"],
    people: ["😀", "😃", "😄", "😁", "🙂", "😊", "🥰", "😘", "😜", "🤓", "😴", "😷", "🤒", "🥶", "😵", "🤯"],
    food: ["🍕", "🍔", "🍟", "🌮", "🍿", "🍩", "🍪", "🎂", "☕", "🍵", "🍎", "🍌", "🍓", "🍇", "🥗", "🍫"],
    places: ["🚗", "🚕", "🚌", "🚆", "✈️", "🚀", "🏠", "🏢", "🏖️", "⛰️", "🌍", "🌙", "⭐", "☀️", "🌧️", "🌈"],
    objects: ["💡", "📎", "📌", "📷", "🎧", "💻", "📱", "⌚", "🎁", "🔑", "🔒", "🧭", "📝", "📚", "⚙️", "🛠️"],
    symbols: ["❤️", "🧡", "💛", "💚", "💙", "💜", "🖤", "💔", "❗", "❓", "⚠️", "♻️", "🔴", "🟢", "🔵", "✔️"]
  };
  const emojiOptions = Object.values(emojiGroups).flat();
  const stickerOptions = [
    { label: "Star", value: "🌟", color: "bg-amber-100" },
    { label: "Perfect", value: "💯", color: "bg-rose-100" },
    { label: "Clap", value: "👏", color: "bg-indigo-100" },
    { label: "Hands", value: "🙌", color: "bg-sky-100" },
    { label: "Rocket", value: "🚀", color: "bg-purple-100" },
    { label: "Done", value: "✅", color: "bg-emerald-100" },
    { label: "Love", value: "❤️", color: "bg-pink-100" },
    { label: "Fire", value: "🔥", color: "bg-orange-100" },
    { label: "Thinking", value: "🤔", color: "bg-slate-100" }
  ];
  const gifOptions = [
    { label: "Deal with it", value: "😎 Deal with it", icon: "😎" },
    { label: "Nice", value: "🔥 Nice!", icon: "🔥" },
    { label: "LOL", value: "😂 LOL", icon: "😂" },
    { label: "Congrats", value: "🎊 Congrats!", icon: "🎊" },
    { label: "On it", value: "✅ On it", icon: "✅" },
    { label: "Wow", value: "😮 Wow!", icon: "😮" },
    { label: "Please", value: "🙏 Please", icon: "🙏" },
    { label: "Done", value: "💯 Done", icon: "💯" },
    { label: "Party", value: "🥳 Party time", icon: "🥳" }
  ];
  const richEmojiGroups: Record<EmojiCategory, EmojiItem[]> = {
    emoji: [
      { symbol: "😀", label: "grinning", keywords: "happy smile face" },
      { symbol: "😂", label: "laugh", keywords: "lol funny tears joy" },
      { symbol: "🤣", label: "rolling laugh", keywords: "rofl funny haha" },
      { symbol: "😊", label: "smile", keywords: "happy blush" },
      { symbol: "😍", label: "heart eyes", keywords: "love crush" },
      { symbol: "😘", label: "kiss", keywords: "love mwah" },
      { symbol: "😎", label: "cool", keywords: "sunglasses swag" },
      { symbol: "😮", label: "wow", keywords: "surprised shock" },
      { symbol: "😢", label: "sad", keywords: "cry tear upset" },
      { symbol: "😭", label: "cry", keywords: "sad tears" },
      { symbol: "😡", label: "angry", keywords: "mad upset" },
      { symbol: "🤔", label: "thinking", keywords: "think doubt question" },
      { symbol: "🥳", label: "party", keywords: "celebrate birthday" },
      { symbol: "🤯", label: "mind blown", keywords: "shock surprised" },
      { symbol: "🥺", label: "please", keywords: "sad puppy eyes" },
      { symbol: "🙄", label: "eyeroll", keywords: "annoyed bored" }
    ],
    gestures: [
      { symbol: "👍", label: "thumbs up", keywords: "like yes ok" },
      { symbol: "👎", label: "thumbs down", keywords: "dislike no" },
      { symbol: "👌", label: "ok", keywords: "perfect fine" },
      { symbol: "✌️", label: "peace", keywords: "victory two" },
      { symbol: "🤞", label: "fingers crossed", keywords: "hope luck" },
      { symbol: "🤝", label: "handshake", keywords: "deal agree" },
      { symbol: "👋", label: "wave", keywords: "hello hi bye" },
      { symbol: "👏", label: "clap", keywords: "applause good" },
      { symbol: "🙏", label: "pray", keywords: "please thanks" },
      { symbol: "💪", label: "strong", keywords: "muscle power" },
      { symbol: "👊", label: "fist bump", keywords: "punch bump" },
      { symbol: "🤙", label: "call me", keywords: "phone hang loose" }
    ],
    people: [
      { symbol: "👨‍💻", label: "developer", keywords: "coder laptop work" },
      { symbol: "👩‍💻", label: "developer woman", keywords: "coder laptop work" },
      { symbol: "🧑‍🎓", label: "student", keywords: "school college" },
      { symbol: "🧑‍⚕️", label: "doctor", keywords: "medical health" },
      { symbol: "🧑‍🏫", label: "teacher", keywords: "class education" },
      { symbol: "🤷", label: "shrug", keywords: "confused maybe" },
      { symbol: "🙋", label: "raise hand", keywords: "question me" },
      { symbol: "🙌", label: "hands up", keywords: "celebrate yay" }
    ],
    food: [
      { symbol: "🍕", label: "pizza", keywords: "food slice" },
      { symbol: "🍔", label: "burger", keywords: "food fast" },
      { symbol: "🍟", label: "fries", keywords: "food chips" },
      { symbol: "🍿", label: "popcorn", keywords: "movie snack" },
      { symbol: "🎂", label: "cake", keywords: "birthday sweet" },
      { symbol: "☕", label: "coffee", keywords: "drink tea" },
      { symbol: "🍎", label: "apple", keywords: "fruit" },
      { symbol: "🍫", label: "chocolate", keywords: "sweet" }
    ],
    places: [
      { symbol: "🚗", label: "car", keywords: "drive vehicle" },
      { symbol: "✈️", label: "plane", keywords: "flight travel" },
      { symbol: "🚀", label: "rocket", keywords: "launch fast" },
      { symbol: "🏠", label: "home", keywords: "house" },
      { symbol: "🏢", label: "office", keywords: "building work" },
      { symbol: "🏖️", label: "beach", keywords: "holiday travel" },
      { symbol: "🌍", label: "earth", keywords: "world globe" },
      { symbol: "🌈", label: "rainbow", keywords: "color" }
    ],
    objects: [
      { symbol: "💡", label: "idea", keywords: "light bulb" },
      { symbol: "📎", label: "paperclip", keywords: "attach file" },
      { symbol: "📷", label: "camera", keywords: "photo image" },
      { symbol: "🎧", label: "headphones", keywords: "music audio" },
      { symbol: "💻", label: "laptop", keywords: "computer work" },
      { symbol: "📱", label: "phone", keywords: "mobile call" },
      { symbol: "🎁", label: "gift", keywords: "present" },
      { symbol: "🔒", label: "lock", keywords: "secure" }
    ],
    symbols: [
      { symbol: "❤️", label: "heart", keywords: "love red" },
      { symbol: "💯", label: "hundred", keywords: "perfect score" },
      { symbol: "✅", label: "check", keywords: "done yes complete" },
      { symbol: "❌", label: "cross", keywords: "no cancel close" },
      { symbol: "➕", label: "plus", keywords: "add" },
      { symbol: "❗", label: "important", keywords: "warning alert" },
      { symbol: "❓", label: "question", keywords: "help ask" },
      { symbol: "⚠️", label: "warning", keywords: "alert" }
    ]
  };
  const richStickerOptions: StickerItem[] = [
    { label: "Star", value: "🌟", color: "bg-amber-100", keywords: "favorite shine" },
    { label: "Perfect", value: "💯", color: "bg-rose-100", keywords: "hundred best" },
    { label: "Clap", value: "👏", color: "bg-indigo-100", keywords: "applause good" },
    { label: "Hands", value: "🙌", color: "bg-sky-100", keywords: "yay celebrate" },
    { label: "Rocket", value: "🚀", color: "bg-purple-100", keywords: "fast launch" },
    { label: "Done", value: "✅", color: "bg-emerald-100", keywords: "complete yes" },
    { label: "Love", value: "❤️", color: "bg-pink-100", keywords: "heart like" },
    { label: "Fire", value: "🔥", color: "bg-orange-100", keywords: "hot nice" },
    { label: "Thinking", value: "🤔", color: "bg-slate-100", keywords: "question maybe" },
    { label: "LOL", value: "🤣", color: "bg-yellow-100", keywords: "laugh funny" },
    { label: "Please", value: "🙏", color: "bg-blue-100", keywords: "request thanks" },
    { label: "Wow", value: "😮", color: "bg-cyan-100", keywords: "surprise" }
  ];
  const richGifOptions: GifItem[] = [
    { label: "Deal with it", value: "😎 Deal with it", icon: "😎", keywords: "cool sunglasses" },
    { label: "Nice", value: "🔥 Nice!", icon: "🔥", keywords: "good fire" },
    { label: "LOL", value: "😂 LOL", icon: "😂", keywords: "laugh funny" },
    { label: "Congrats", value: "🎉 Congrats!", icon: "🎉", keywords: "celebrate party" },
    { label: "On it", value: "✅ On it", icon: "✅", keywords: "done working" },
    { label: "Wow", value: "😮 Wow!", icon: "😮", keywords: "surprise shock" },
    { label: "Please", value: "🙏 Please", icon: "🙏", keywords: "request" },
    { label: "Done", value: "💯 Done", icon: "💯", keywords: "complete perfect" },
    { label: "Party", value: "🥳 Party time", icon: "🥳", keywords: "celebrate" },
    { label: "Typing fast", value: "⚡ Typing fast", icon: "⚡", keywords: "quick speed" },
    { label: "Good morning", value: "☀️ Good morning", icon: "☀️", keywords: "hello day" },
    { label: "Good night", value: "🌙 Good night", icon: "🌙", keywords: "sleep bye" }
  ];
  const mentionMessages = mentionRecords.length
    ? mentionRecords
    : messages.filter((message) => user && message.sender_id !== user.id && message.body.toLowerCase().includes(`@${user.name.toLowerCase()}`));
  const searchNeedle = emojiSearch.trim().toLowerCase();
  const matchesSearch = (item: { label: string; keywords: string; value?: string; symbol?: string }) =>
    !searchNeedle || `${item.label} ${item.keywords} ${item.value ?? ""} ${item.symbol ?? ""}`.toLowerCase().includes(searchNeedle);
  const filteredEmojiGroups = Object.fromEntries(
    Object.entries(richEmojiGroups).map(([category, items]) => [category, items.filter(matchesSearch)])
  ) as Record<EmojiCategory, EmojiItem[]>;
  const filteredEmojiOptions = Object.values(filteredEmojiGroups).flat();
  const filteredStickerOptions = richStickerOptions.filter(matchesSearch);
  const filteredGifOptions = richGifOptions.filter(matchesSearch);
  const callPeerId = activeCall ? (activeCall.caller_id === user?.id ? activeCall.callee_id : activeCall.caller_id) : null;
  const callPeer = callPeerId ? friends.find((friend) => friend.user.id === callPeerId)?.user : null;

  const formatClockTime = (value?: string | null) => {
    if (!value) return "--";
    return new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" }).format(new Date(value));
  };

  const formatDuration = (startedAt?: string | null, tick = callTick) => {
    void tick;
    if (!startedAt) return "00:00";
    const seconds = Math.max(0, Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000));
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${String(minutes).padStart(2, "0")}:${String(remainingSeconds).padStart(2, "0")}`;
  };

  const callDurationSeconds = (call: CallLog) =>
    Math.max(0, Math.floor((Date.now() - new Date(call.started_at).getTime()) / 1000));

  const selectedMatchesCall = (call: CallLog) => {
    if (!selected || !user) return false;
    const peerId = call.caller_id === user.id ? call.callee_id : call.caller_id;
    return selected.user1_id === peerId || selected.user2_id === peerId || selected.peer?.id === peerId;
  };

  const conversationTitle = (conversation: Conversation | null) =>
    conversation?.conversation_type === "group"
      ? conversation.title || "Group"
      : conversation?.peer?.name ?? "Chat";

  const conversationSubtitle = (conversation: Conversation | null) =>
    conversation?.conversation_type === "group"
      ? `${conversation.members?.length ?? 0} members`
      : callError || (typingUserId === conversation?.peer?.id ? "Typing..." : conversation?.peer?.online ? "Online" : "Offline");

  const messageSummary = (message?: Message | null) => {
    if (!message) return "";
    if (message.deleted_for_everyone) return "This message was deleted";
    if (message.attachment_name) return message.attachment_name;
    if (message.message_type === "image") return "Photo";
    if (message.message_type === "audio") return "Voice message";
    if (message.message_type === "video") return "Video message";
    if (message.message_type === "gif") return "GIF";
    if (message.message_type === "sticker") return "Sticker";
    return message.body || "Message";
  };

  const cleanupCallMedia = () => {
    if (callTimeoutTimer.current) {
      window.clearTimeout(callTimeoutTimer.current);
      callTimeoutTimer.current = null;
    }
    ringtone.current.stop();
    rtc.current?.close();
    screenStream.current?.getTracks().forEach((track) => track.stop());
    screenStream.current = null;
    setLocalStream(null);
    setRemoteStream(null);
    setPendingOffer(null);
    setCallMinimized(false);
    setScreenSharing(false);
    setMicMuted(false);
    setCameraOff(false);
  };

  const loadAll = async () => {
    if (!accessToken) return;
    const [friendRows, requestRows, conversationRows, callRows] = await Promise.all([
      friendApi.list(),
      friendApi.requests(),
      chatApi.conversations(),
      callApi.history().catch(() => [])
    ]);
    setFriends(friendRows);
    setRequests(requestRows);
    setConversations(conversationRows);
    setCallHistory(callRows);
    const conversationMessages = await Promise.all(
      conversationRows.map(async (conversation) => {
        const items = await chatApi.messages(conversation.id).catch(() => []);
        return { conversationId: conversation.id, items: items.map(normalizeMessage) };
      })
    );
    setLastMessages(Object.fromEntries(conversationMessages.map(({ conversationId, items }) => [conversationId, items.length ? items[items.length - 1] : undefined] as const)));
    if (user) {
      const mentionNeedle = `@${user.name.toLowerCase()}`;
      setMentionRecords(
        conversationMessages
          .flatMap(({ items }) => items)
          .filter((message) => message.sender_id !== user.id && message.body.toLowerCase().includes(mentionNeedle))
      );
    }
  };

  const selectConversation = (conversation: Conversation) => {
    setActiveView("chat");
    setSelected(conversation);
    navigate(`/app/chat/${conversation.id}`);
  };

  const showChatView = () => {
    setActiveView("chat");
  };

  const showPeopleView = () => {
    setActiveView("people");
    setSelected(null);
    navigate("/app");
    loadAll().catch(() => undefined);
  };

  const showActivityView = () => {
    setActiveView("activity");
    setSelected(null);
    navigate("/app");
    loadAll().catch(() => undefined);
  };

  const playMessageSound = () => {
    try {
      const AudioContextCtor = window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioContextCtor) return;
      const context = new AudioContextCtor();
      const gain = context.createGain();
      const oscillator = context.createOscillator();
      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(660, context.currentTime);
      oscillator.frequency.setValueAtTime(880, context.currentTime + 0.08);
      gain.gain.setValueAtTime(0.0001, context.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.18, context.currentTime + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.22);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start();
      oscillator.stop(context.currentTime + 0.24);
    } catch {
      // Browsers may block notification audio until the user interacts with the page.
    }
  };

  const loadDevices = async () => {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    const devices = await navigator.mediaDevices.enumerateDevices();
    const microphones = devices.filter((device) => device.kind === "audioinput");
    const cameras = devices.filter((device) => device.kind === "videoinput");
    const speakers = devices.filter((device) => device.kind === "audiooutput");
    setAudioInputs(microphones);
    setVideoInputs(cameras);
    setAudioOutputs(speakers);
    setAudioInputId((current) => current || microphones[0]?.deviceId || "");
    setVideoInputId((current) => current || cameras[0]?.deviceId || "");
    setAudioOutputId((current) => current || speakers[0]?.deviceId || "");
  };

  const unlockAudio = () => {
    ringtone.current
      .unlock(audioOutputId)
      .then(() => {
        setSoundReady(true);
        setCallError("");
      })
      .catch(() => setCallError("Click Enable call sound, then allow audio playback in your browser."));
  };

  const scrollMessagesToBottom = (behavior: ScrollBehavior = "smooth") => {
    const scroll = () => {
      const container = messagesContainer.current;
      if (container) {
        container.scrollTo({ top: container.scrollHeight, behavior });
        return;
      }
      messagesEnd.current?.scrollIntoView({ behavior, block: "end" });
    };
    window.requestAnimationFrame(scroll);
    window.setTimeout(scroll, 40);
  };

  const mediaErrorMessage = (error: unknown, callType: "audio" | "video") => {
      if (error instanceof DOMException) {
        if (error.name === "NotFoundError") {
          return callType === "video"
          ? "No camera was found. Starting with microphone only."
          : "No microphone was found. Choose another microphone and try again.";
      }
      if (error.name === "NotAllowedError") {
        return "Browser permission is blocked. Allow camera/microphone access and try again.";
      }
    }
    return "Could not start the call. Check your selected devices and browser permissions.";
  };

  const sendSocketPayload = (socket: WebSocket | null, payload: Record<string, unknown>) => {
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(payload));
      return true;
    }
    return false;
  };

  const sendChatMessage = (payload: {
    body: string;
    message_type?: Message["message_type"];
    attachment_url?: string | null;
    attachment_name?: string | null;
    attachment_mime?: string | null;
    attachment_size?: number | null;
    reply_to_message_id?: number | null;
  }) => {
    if (!selected) return false;
    return sendSocketPayload(chatSocket.current, {
      type: "message",
      conversation_id: selected.id,
      body: payload.body,
      message_type: payload.message_type ?? "text",
      attachment_url: payload.attachment_url,
      attachment_name: payload.attachment_name,
      attachment_mime: payload.attachment_mime,
      attachment_size: payload.attachment_size,
      reply_to_message_id: payload.reply_to_message_id ?? replyingTo?.id ?? null
    });
  };

  const absoluteMediaUrl = (value?: string | null) => {
    if (!value) return "";
    return value.startsWith("/") ? `${API_URL}${value}` : value;
  };

  const playRemoteMedia = () => {
    const media = remoteAudio.current ?? remoteVideo.current;
    media?.play().catch(() => setCallError("Remote audio is blocked. Click inside the page once, then reconnect the call."));
  };

  const bindLocalVideo = (element: HTMLVideoElement | null) => {
    localVideo.current = element;
    if (element && localStream) {
      element.srcObject = localStream;
    }
  };

  const bindRemoteVideo = (element: HTMLVideoElement | null) => {
    remoteVideo.current = element;
    if (element && remoteStream) {
      element.srcObject = remoteStream;
      element.play().catch(() => undefined);
    }
  };

  const bindRemoteAudio = (element: HTMLAudioElement | null) => {
    remoteAudio.current = element;
    if (element && remoteStream) {
      element.srcObject = remoteStream;
      element.play().catch(() => undefined);
    }
  };

  const acceptIncomingOffer = async (fromUserId: number, sdp: RTCSessionDescriptionInit) => {
    const call = activeCallRef.current;
    if (call?.id && closedCallIds.current.has(call.id)) return;
    if (!call || call.state !== "accepted") {
      setPendingOffer({ fromUserId, sdp });
      return;
    }
    if (!localStreamRef.current) {
      const wantsVideo = call.call_type === "video";
      const stream = await rtc.current?.startLocal(wantsVideo, { audioInputId, videoInputId });
      if (stream) {
        setLocalStream(stream);
        if (wantsVideo && stream.getVideoTracks().length === 0) {
          setCallError("No camera found. Continuing with microphone only.");
        }
      }
    }
    await rtc.current?.acceptOffer(fromUserId, sdp);
    setPendingOffer(null);
  };

  useEffect(() => {
    audioOutputIdRef.current = audioOutputId;
  }, [audioOutputId]);

  useEffect(() => {
    activeCallRef.current = activeCall;
  }, [activeCall]);

  useEffect(() => {
    localStreamRef.current = localStream;
  }, [localStream]);

  useEffect(() => {
    if (!activeCall || activeCall.state !== "accepted") return;
    const intervalId = window.setInterval(() => setCallTick((value) => value + 1), 1000);
    return () => window.clearInterval(intervalId);
  }, [activeCall?.id, activeCall?.state]);

  useEffect(() => {
    if (!activeCall || !user || activeCall.state !== "ringing" || activeCall.caller_id !== user.id) {
      if (callTimeoutTimer.current) {
        window.clearTimeout(callTimeoutTimer.current);
        callTimeoutTimer.current = null;
      }
      return;
    }
    callTimeoutTimer.current = window.setTimeout(() => {
      const currentCall = activeCallRef.current;
      if (!currentCall || currentCall.id !== activeCall.id || currentCall.state !== "ringing") return;
      sendCallEndMessage(currentCall, "missed");
      sendSocketPayload(callSocket.current, { type: "call:state", call_id: currentCall.id, state: "missed" });
      closedCallIds.current.add(currentCall.id);
      setActiveCall(null);
      activeCallRef.current = null;
      cleanupCallMedia();
    }, 60000);
    return () => {
      if (callTimeoutTimer.current) {
        window.clearTimeout(callTimeoutTimer.current);
        callTimeoutTimer.current = null;
      }
    };
  }, [activeCall?.id, activeCall?.state, activeCall?.caller_id, user?.id]);

  useEffect(() => {
    if (recordingPreviewVideo.current && recordingPreview?.stream) {
      recordingPreviewVideo.current.srcObject = recordingPreview.stream;
      recordingPreviewVideo.current.play().catch(() => undefined);
    }
    if (recordingPreviewVideo.current && !recordingPreview?.stream) {
      recordingPreviewVideo.current.srcObject = null;
    }
  }, [recordingPreview]);

  useEffect(() => {
    if (!accessToken) return;
    loadAll();
    loadDevices().catch(() => undefined);
    const intervalId = window.setInterval(() => {
      loadAll().catch(() => undefined);
    }, 5000);
    return () => window.clearInterval(intervalId);
  }, [accessToken]);

  useEffect(() => {
    document.addEventListener("pointerdown", unlockAudio, { once: true });
    return () => document.removeEventListener("pointerdown", unlockAudio);
  }, [audioOutputId]);

  useEffect(() => {
    if (!messageMenu) return;
    const closeMenu = () => setMessageMenu(null);
    window.addEventListener("pointerdown", closeMenu);
    window.addEventListener("scroll", closeMenu, true);
    return () => {
      window.removeEventListener("pointerdown", closeMenu);
      window.removeEventListener("scroll", closeMenu, true);
    };
  }, [messageMenu]);

  useEffect(() => {
    if (!accessToken) return;
    let disposed = false;
    let chatReconnectTimer: number | undefined;
    let callReconnectTimer: number | undefined;

    rtc.current = new WebRTCClient(
      (payload) => {
        if (!sendSocketPayload(callSocket.current, payload)) {
          setCallError("Call connection is still starting. Try again in a moment.");
        }
      },
      (stream) => setRemoteStream(stream)
    );

    const handleChatMessage = (event: MessageEvent<string>) => {
      const payload = JSON.parse(event.data) as ChatEvent;
      if (payload.type === "message") {
        const nextMessage = normalizeMessage(payload.message);
        if (nextMessage.sender_id !== user?.id) {
          playMessageSound();
        }
        setMessages((current) =>
          current.some((message) => message.id === nextMessage.id) ? current : [...current, nextMessage]
        );
        setLastMessages((current) => ({ ...current, [nextMessage.conversation_id]: nextMessage }));
        loadAll().catch(() => undefined);
        scrollMessagesToBottom();
      }
      if (payload.type === "message:deleted") {
        if (payload.scope === "me") {
          setMessages((current) => current.filter((message) => message.id !== payload.message_id));
          return;
        }
        if (payload.message) {
          const deletedMessage = normalizeMessage(payload.message);
          setMessages((current) => current.map((message) => (message.id === payload.message_id ? deletedMessage : message)));
          setLastMessages((current) => ({ ...current, [deletedMessage.conversation_id]: deletedMessage }));
        }
      }
      if (payload.type === "typing") {
        setTypingUserId(payload.is_typing ? payload.user_id : null);
      }
      if (payload.type === "read") {
        const readMessageIds = Array.isArray(payload.message_ids) ? payload.message_ids : [];
        setMessages((current) =>
          current.map((message) =>
            includesNumber(readMessageIds, message.id)
              ? { ...message, read_by: Array.from(new Set([...(message.read_by ?? []), payload.user_id])) }
              : message
          )
        );
        setLastMessages((current) =>
          Object.fromEntries(
            Object.entries(current).map(([conversationId, message]) => [
              conversationId,
              message && includesNumber(readMessageIds, message.id)
                ? { ...message, read_by: Array.from(new Set([...(message.read_by ?? []), payload.user_id])) }
                : message
            ])
          )
        );
      }
      if (payload.type === "presence") {
        setFriends((current) =>
          current.map((friend) =>
            friend.user.id === payload.user_id ? { ...friend, user: { ...friend.user, online: payload.online } } : friend
          )
        );
      }
    };

    const handleCallMessage = async (event: MessageEvent<string>) => {
      const payload = JSON.parse(event.data) as CallEvent;
      if (payload.type === "call:ringing" || payload.type === "call:state") {
        const callFinished = payload.call.state === "ended" || payload.call.state === "rejected" || payload.call.state === "missed";
        if (callFinished) {
          closedCallIds.current.add(payload.call.id);
          if (payload.call.caller_id === user?.id) {
            sendCallEndMessage(payload.call, payload.call.state);
          }
        } else {
          closedCallIds.current.delete(payload.call.id);
        }
        setActiveCall(callFinished ? null : payload.call);
        activeCallRef.current = callFinished ? null : payload.call;
        if (callFinished) {
          cleanupCallMedia();
        }
        const isIncomingRinging = payload.call.state === "ringing" && payload.call.callee_id === user?.id;
        const isOutgoingRinging = payload.call.state === "ringing" && payload.call.caller_id === user?.id;
        if (isIncomingRinging) {
          ringtone.current
            .setOutputDevice(audioOutputIdRef.current)
            .then(() => ringtone.current.start())
            .catch(() => setCallError("Incoming call sound is blocked. Click Enable call sound once."));
        } else if (isOutgoingRinging) {
          ringtone.current
            .setOutputDevice(audioOutputIdRef.current)
            .then(() => ringtone.current.start("caller"))
            .catch(() => setCallError("Caller tune is blocked. Click Enable call sound once."));
        } else {
          ringtone.current.stop();
        }
        if (payload.type === "call:state" && payload.call.state === "accepted" && payload.call.caller_id === user?.id) {
          const peerId = payload.call.callee_id;
          const wantsVideo = payload.call.call_type === "video";
          if (!localStreamRef.current) {
            const stream = await rtc.current?.startLocal(wantsVideo, { audioInputId, videoInputId });
            if (stream) {
              setLocalStream(stream);
            }
          }
          await rtc.current?.createOffer(peerId).catch(() => setCallError("Could not start media after the call was accepted."));
        }
      }
      if (payload.type === "webrtc:offer") {
        if (!activeCallRef.current || closedCallIds.current.has(activeCallRef.current.id)) return;
        await acceptIncomingOffer(payload.from_user_id, payload.sdp).catch(() =>
          setCallError("Could not connect the incoming audio stream. End the call and try again.")
        );
      }
      if (payload.type === "webrtc:answer") {
        await rtc.current?.acceptAnswer(payload.sdp).catch(() => setCallError("Could not connect the remote audio stream."));
      }
      if (payload.type === "webrtc:ice") {
        await rtc.current?.addIce(payload.candidate).catch(() => undefined);
      }
    };

    const openChatSocket = () => {
      if (disposed) return;
      const chat = new WebSocket(`${WS_URL}/ws/chat?token=${accessToken}`);
      chatSocket.current = chat;
      chat.onmessage = handleChatMessage;
      chat.onerror = () => chat.close();
      chat.onclose = () => {
        if (chatSocket.current === chat) chatSocket.current = null;
        if (!disposed) {
          chatReconnectTimer = window.setTimeout(openChatSocket, 3000);
        }
      };
    };

    const openCallSocket = () => {
      if (disposed) return;
      const call = new WebSocket(`${WS_URL}/ws/call?token=${accessToken}`);
      callSocket.current = call;
      call.onmessage = (event) => {
        handleCallMessage(event).catch(() => setCallError("Call connection lost. Reconnecting..."));
      };
      call.onerror = () => call.close();
      call.onclose = () => {
        if (callSocket.current === call) callSocket.current = null;
        if (!disposed) {
          callReconnectTimer = window.setTimeout(openCallSocket, 3000);
        }
      };
    };

    openChatSocket();
    openCallSocket();

    return () => {
      disposed = true;
      window.clearTimeout(chatReconnectTimer);
      window.clearTimeout(callReconnectTimer);
      chatSocket.current?.close();
      callSocket.current?.close();
      chatSocket.current = null;
      callSocket.current = null;
      ringtone.current.stop();
      rtc.current?.close();
    };
  }, [accessToken, user?.id]);

  useEffect(() => {
    if (selected) {
      chatApi.messages(selected.id).then((items) => setMessages(items.map(normalizeMessage)));
    }
  }, [selected]);

  useEffect(() => {
    if (emojiTab !== "gifs" || !GIPHY_API_KEY) {
      setGiphyResults([]);
      return;
    }
    const controller = new AbortController();
    const queryValue = emojiSearch.trim();
    setGiphyLoading(true);
    const endpoint = queryValue ? "search" : "trending";
    const params = new URLSearchParams({
      api_key: GIPHY_API_KEY,
      limit: "12",
      rating: "pg",
      bundle: "messaging_non_clips"
    });
    if (queryValue) params.set("q", queryValue);
    fetch(`https://api.giphy.com/v1/gifs/${endpoint}?${params.toString()}`, { signal: controller.signal })
      .then((response) => response.json())
      .then((payload) => {
        const results = Array.isArray(payload.data)
          ? payload.data.map((item: any) => ({
              id: String(item.id),
              title: item.title || "GIF",
              preview: item.images?.fixed_width_small?.url || item.images?.preview_gif?.url || item.images?.downsized?.url,
              url: item.images?.original?.url || item.images?.downsized?.url
            })).filter((item: GiphyItem) => item.preview && item.url)
          : [];
        setGiphyResults(results);
      })
      .catch(() => {
        if (!controller.signal.aborted) setGiphyResults([]);
      })
      .finally(() => {
        if (!controller.signal.aborted) setGiphyLoading(false);
      });
    return () => controller.abort();
  }, [emojiSearch, emojiTab]);

  useEffect(() => {
    if (!routeConversationId || !Number.isFinite(routeConversationId)) {
      if (selected) setSelected(null);
      return;
    }
    if (selected?.id === routeConversationId) return;
    const conversation = conversations.find((item) => item.id === routeConversationId);
    if (conversation) {
      setActiveView("chat");
      setSelected(conversation);
    }
  }, [conversations, routeConversationId, selected?.id]);

  useEffect(() => {
    scrollMessagesToBottom();
  }, [messages.length, selected?.id]);

  useEffect(() => {
    if (!selected || !user) return;
    const unreadPeerMessages = messages
      .filter((message) => message.sender_id !== user.id && !includesNumber(message.read_by, user.id))
      .map((message) => message.id);
    if (unreadPeerMessages.length) {
      sendSocketPayload(chatSocket.current, { type: "read", conversation_id: selected.id, message_ids: unreadPeerMessages });
    }
  }, [messages, selected, user]);

  useEffect(() => {
    if (localVideo.current && localStream) localVideo.current.srcObject = localStream;
    if (remoteVideo.current && remoteStream) remoteVideo.current.srcObject = remoteStream;
    if (remoteAudio.current && remoteStream) remoteAudio.current.srcObject = remoteStream;
    if (remoteStream) {
      remoteVideo.current?.play().catch(() => undefined);
      playRemoteMedia();
      scrollMessagesToBottom("auto");
    }
  }, [localStream, remoteStream, activeCall?.state, activeCall?.call_type]);

  useEffect(() => {
    const applyOutput = async () => {
      const remote = remoteVideo.current as HTMLVideoElement & { setSinkId?: (sinkId: string) => Promise<void> };
      const audio = remoteAudio.current as HTMLAudioElement & { setSinkId?: (sinkId: string) => Promise<void> };
      const local = localVideo.current as HTMLVideoElement & { setSinkId?: (sinkId: string) => Promise<void> };
      if (remote?.setSinkId) await remote.setSinkId(audioOutputId || "");
      if (audio?.setSinkId) await audio.setSinkId(audioOutputId || "");
      if (local?.setSinkId) await local.setSinkId(audioOutputId || "");
      await ringtone.current.setOutputDevice(audioOutputId);
    };
    applyOutput().catch(() => undefined);
  }, [audioOutputId]);

  const search = async (value: string) => {
    setQuery(value);
    setSearchError("");
    if (value.trim().length <= 1) {
      setResults([]);
      return;
    }
    try {
      setResults(await userApi.search(value));
    } catch {
      setResults([]);
      setSearchError("Search failed. Please sign in again or try after a moment.");
    }
  };

  const openConversation = async (friend: Friend) => {
    const conversation = await chatApi.createConversation(friend.user.id);
    const merged = { ...conversation, peer: friend.user };
    setConversations((current) => [merged, ...current.filter((item) => item.id !== merged.id)]);
    selectConversation(merged);
  };

  const sendMessage = async (event: FormEvent) => {
    event.preventDefault();
    if (!selected || !body.trim()) return;
    sendChatMessage({ body: body.trim(), message_type: "text" });
    setBody("");
    setReplyingTo(null);
    setShowEmojiPanel(false);
    scrollMessagesToBottom();
  };

  const deleteMessage = async (message: Message, scope: "me" | "everyone") => {
    if (sendSocketPayload(chatSocket.current, { type: "message:delete", message_id: message.id, scope })) {
      return;
    }
    const deleted = await chatApi.deleteMessage(message.id, scope);
    if (scope === "me") {
      setMessages((current) => current.filter((item) => item.id !== message.id));
    } else {
      setMessages((current) => current.map((item) => (item.id === message.id ? normalizeMessage(deleted) : item)));
    }
  };

  const toggleGroupMember = (friendId: number) => {
    setGroupMemberIds((current) =>
      current.includes(friendId) ? current.filter((id) => id !== friendId) : [...current, friendId]
    );
  };

  const startMessageSwipe = (message: Message, event: React.PointerEvent<HTMLDivElement>) => {
    messageSwipe.current = { id: message.id, x: event.clientX };
  };

  const endMessageSwipe = (message: Message, event: React.PointerEvent<HTMLDivElement>) => {
    const swipe = messageSwipe.current;
    messageSwipe.current = null;
    if (message.deleted_for_everyone) return;
    if (!swipe || swipe.id !== message.id) return;
    if (Math.abs(event.clientX - swipe.x) > 70) {
      setReplyingTo(message);
    }
  };

  const openMessageMenu = (message: Message, event: React.MouseEvent<HTMLElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setMessageMenu({ message, x: event.clientX, y: event.clientY });
  };

  const copyMessageText = async (message: Message) => {
    await navigator.clipboard?.writeText(message.body || message.attachment_url || "");
    setMessageMenu(null);
  };

  const copyMessageLink = async (message: Message) => {
    await navigator.clipboard?.writeText(`${window.location.origin}/app/chat/${message.conversation_id}?message=${message.id}`);
    setMessageMenu(null);
  };

  const pinMessage = (message: Message) => {
    setPinnedMessageIds((current) => current.includes(message.id) ? current : [...current, message.id]);
    setMessageMenu(null);
  };

  const markMessageUnread = (message: Message) => {
    setLocallyUnreadIds((current) => current.includes(message.id) ? current : [...current, message.id]);
    setMessageMenu(null);
  };

  const createGroup = async () => {
    const title = groupTitle.trim();
    if (!title || !groupMemberIds.length) return;
    const group = await chatApi.createGroup({ title, member_ids: groupMemberIds });
    setConversations((current) => [group, ...current.filter((item) => item.id !== group.id)]);
    selectConversation(group);
    setGroupTitle("");
    setGroupMemberIds([]);
    setShowGroupModal(false);
  };

  const sendCallEventMessage = (callType: "audio" | "video", action: "start" | "end") => {
    if (!selected) return;
    sendChatMessage({ body: `__call__:${callType}:${action}`, message_type: "call" });
  };

  const sendCallEndMessage = (call: CallLog, state: CallLog["state"] = "ended") => {
    if (callEndMessageSentIds.current.has(call.id) || !selectedMatchesCall(call)) return;
    callEndMessageSentIds.current.add(call.id);
    sendChatMessage({
      body: `__call__:${call.call_type}:end:${state}:${callDurationSeconds(call)}`,
      message_type: "call"
    });
  };

  const sendUploadedAttachment = async (attachment: UploadedAttachment, caption = "") => {
    if (!selected) return;
    sendChatMessage({
      body: caption,
      message_type: attachment.message_type,
      attachment_url: attachment.url,
      attachment_name: attachment.name,
      attachment_mime: attachment.mime,
      attachment_size: attachment.size
    });
    scrollMessagesToBottom();
  };

  const uploadAndSend = async (file: File | Blob, filename: string, caption = "") => {
    if (!selected) return;
    setUploading(true);
    setComposerError("");
    try {
      const attachment = await chatApi.uploadAttachment(selected.id, file, filename);
      await sendUploadedAttachment(attachment, caption);
    } catch {
      setComposerError("Could not send attachment. Use a file up to 25MB and try again.");
    } finally {
      setUploading(false);
    }
  };

  const handleFileSelect = (file: File | undefined) => {
    if (!file) return;
    uploadAndSend(file, file.name);
  };

  const sendQuickMessage = (value: string, messageType: Message["message_type"]) => {
    sendChatMessage({ body: value, message_type: messageType });
    setShowEmojiPanel(false);
  };

  const startRecording = async (kind: "audio" | "video", facingMode = videoMessageFacingMode) => {
    setComposerError("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: kind === "video"
          ? {
              facingMode: { ideal: facingMode },
              width: { ideal: 720, max: 1280 },
              height: { ideal: 1280, max: 1280 },
              frameRate: { ideal: 24, max: 30 }
            }
          : false
      });
      recordedChunks.current = [];
      discardRecordingOnStop.current = false;
      const mimeType = recorderMimeType(kind);
      const mediaRecorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      recorder.current = mediaRecorder;
      setRecordingKind(kind);
      if (kind === "video") {
        setRecordingPreview({ kind, blob: null, url: "", stream });
      }
      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) recordedChunks.current.push(event.data);
      };
      mediaRecorder.onstop = () => {
        stream.getTracks().forEach((track) => track.stop());
        if (discardRecordingOnStop.current) {
          discardRecordingOnStop.current = false;
          recorder.current = null;
          setRecordingKind(null);
          return;
        }
        const mime = mediaRecorder.mimeType || (kind === "video" ? "video/webm" : "audio/webm");
        const blob = new Blob(recordedChunks.current, { type: mime });
        const url = URL.createObjectURL(blob);
        recorder.current = null;
        setRecordingKind(null);
        setRecordingPreview((current) => {
          if (current?.url) URL.revokeObjectURL(current.url);
          return { kind, blob, url };
        });
      };
      mediaRecorder.start();
    } catch {
      setComposerError(kind === "video" ? "Camera or microphone permission is blocked." : "Microphone permission is blocked.");
    }
  };

  const toggleRecording = async (kind: "audio" | "video") => {
    if (recordingKind) {
      recorder.current?.stop();
      return;
    }
    await startRecording(kind);
  };

  const switchVideoMessageCamera = async () => {
    const nextMode = videoMessageFacingMode === "user" ? "environment" : "user";
    setVideoMessageFacingMode(nextMode);
    if (recordingKind === "video" && recorder.current) {
      discardRecordingOnStop.current = true;
      recorder.current.stop();
      window.setTimeout(() => {
        startRecording("video", nextMode).catch(() => undefined);
      }, 150);
    }
  };

  const switchCamera = async () => {
    if (!activeCall || activeCall.state !== "accepted") return;
    setCallError("");
    try {
      await loadDevices();
      const cameras = videoInputs.length ? videoInputs : (await navigator.mediaDevices.enumerateDevices()).filter((device) => device.kind === "videoinput");
      if (cameras.length <= 1) {
        setCallError("No second camera was found.");
        return;
      }
      const currentIndex = Math.max(0, cameras.findIndex((device) => device.deviceId === videoInputId));
      const next = cameras[(currentIndex + 1) % cameras.length];
      setVideoInputId(next.deviceId);
      const stream = await rtc.current?.startLocal(true, { audioInputId, videoInputId: next.deviceId });
      if (stream) {
        screenStream.current?.getTracks().forEach((track) => track.stop());
        screenStream.current = null;
        setScreenSharing(false);
        setLocalStream(stream);
        if (callPeerId) await rtc.current?.createOffer(callPeerId);
      }
    } catch {
      setCallError("Could not switch camera. Check camera permission and try again.");
    }
  };

  const toggleScreenShare = async () => {
    if (!activeCall || activeCall.state !== "accepted") return;
    setCallError("");
    if (screenSharing) {
      try {
        screenStream.current?.getTracks().forEach((track) => track.stop());
        screenStream.current = null;
        setScreenSharing(false);
        const stream = await rtc.current?.startLocal(activeCall.call_type === "video", { audioInputId, videoInputId });
        if (stream) setLocalStream(stream);
      } catch {
        setCallError("Could not return to camera.");
      }
      return;
    }
    try {
      const stream = await rtc.current?.startScreenShare();
      if (stream) {
        screenStream.current = stream;
        setScreenSharing(true);
        setLocalStream(stream);
        if (callPeerId) await rtc.current?.createOffer(callPeerId);
        stream.getVideoTracks()[0]?.addEventListener("ended", () => {
          setScreenSharing(false);
          screenStream.current = null;
          rtc.current?.startLocal(activeCall.call_type === "video", { audioInputId, videoInputId }).then(async (nextStream) => {
            setLocalStream(nextStream);
            if (callPeerId) await rtc.current?.createOffer(callPeerId);
          }).catch(() => undefined);
        });
      }
    } catch {
      setCallError("Screen share was cancelled or blocked.");
    }
  };

  const discardRecordingPreview = () => {
    if (recordingPreview?.url) URL.revokeObjectURL(recordingPreview.url);
    recordingPreview?.stream?.getTracks().forEach((track) => track.stop());
    setRecordingPreview(null);
  };

  const sendRecordingPreview = async () => {
    if (!recordingPreview?.blob) return;
    const { blob, kind } = recordingPreview;
    discardRecordingPreview();
    await uploadAndSend(blob, `${kind}-message-${Date.now()}.webm`);
  };

  const rerecordMessage = async () => {
    const kind = recordingPreview?.kind ?? "video";
    discardRecordingPreview();
    await toggleRecording(kind);
  };

  const toggleMicMute = () => {
    const nextMuted = !micMuted;
    setMicMuted(nextMuted);
    rtc.current?.setAudioEnabled(!nextMuted);
    localStream?.getAudioTracks().forEach((track) => {
      track.enabled = !nextMuted;
    });
  };

  const toggleCameraOff = () => {
    const nextOff = !cameraOff;
    setCameraOff(nextOff);
    rtc.current?.setVideoEnabled(!nextOff);
    localStream?.getVideoTracks().forEach((track) => {
      track.enabled = !nextOff;
    });
  };

  const startCallDrag = (event: React.PointerEvent<HTMLElement>) => {
    if ((event.target as HTMLElement).closest("button, input, select, textarea, video, audio, a")) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    callDrag.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: callPosition.x,
      originY: callPosition.y
    };
  };

  const moveCallDrag = (event: React.PointerEvent<HTMLElement>) => {
    const drag = callDrag.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    setCallPosition({
      x: drag.originX + event.clientX - drag.startX,
      y: drag.originY + event.clientY - drag.startY
    });
  };

  const endCallDrag = (event: React.PointerEvent<HTMLElement>) => {
    if (callDrag.current?.pointerId === event.pointerId) {
      callDrag.current = null;
    }
  };

  const startCall = async (callType: "audio" | "video") => {
    if (!peer) return;
    setCallError("");
    setCallMinimized(false);
    try {
      await loadDevices();
      const stream = await rtc.current?.startLocal(callType === "video", { audioInputId, videoInputId });
      if (stream) {
        setLocalStream(stream);
        if (callType === "video" && stream.getVideoTracks().length === 0) {
          setCallError("No camera found. Continuing with microphone only.");
        }
      }
      if (!sendSocketPayload(callSocket.current, { type: "call:start", callee_id: peer.id, call_type: callType })) {
        setCallError("Call connection is still starting. Try again in a moment.");
        return;
      }
      ringtone.current
        .setOutputDevice(audioOutputIdRef.current)
        .then(() => ringtone.current.start("caller"))
        .catch(() => setCallError("Caller tune is blocked. Click Enable call sound once."));
      sendCallEventMessage(callType, "start");
      await rtc.current?.createOffer(peer.id);
    } catch (error) {
      setCallError(mediaErrorMessage(error, callType));
    }
  };

  const setCallState = async (state: CallLog["state"]) => {
    if (!activeCall) return;
    const peerId = activeCall.caller_id === user?.id ? activeCall.callee_id : activeCall.caller_id;
    if (state === "ended" || state === "rejected") {
      sendCallEndMessage(activeCall, state);
      closedCallIds.current.add(activeCall.id);
      setActiveCall(null);
      activeCallRef.current = null;
      cleanupCallMedia();
      sendSocketPayload(callSocket.current, { type: "call:state", call_id: activeCall.id, state });
    }
    if (state === "accepted" && peerId) {
      setCallError("");
      setCallMinimized(false);
      const acceptedCall: CallLog = {
        ...activeCall,
        state: "accepted",
        answered_at: activeCall.answered_at ?? new Date().toISOString()
      };
      setActiveCall(acceptedCall);
      activeCallRef.current = acceptedCall;
      sendSocketPayload(callSocket.current, { type: "call:state", call_id: activeCall.id, state });
      try {
        ringtone.current.stop();
        await loadDevices();
        const wantsVideo = acceptedCall.call_type === "video";
        const stream = await rtc.current?.startLocal(wantsVideo, { audioInputId, videoInputId });
        if (stream) {
          setLocalStream(stream);
          if (wantsVideo && stream.getVideoTracks().length === 0) {
            setCallError("No camera found. Continuing with microphone only.");
          }
        }
        if (pendingOffer) {
          await rtc.current?.acceptOffer(pendingOffer.fromUserId, pendingOffer.sdp);
          setPendingOffer(null);
        } else {
          rtc.current?.ensurePeer(peerId);
        }
      } catch (error) {
        setCallError(mediaErrorMessage(error, acceptedCall.call_type));
      }
    }
  };

  const sendFriendRequest = async (receiverId: number) => {
    try {
      await friendApi.send(receiverId);
      await loadAll();
      setResults((current) => [...current]);
    } catch {
      setSearchError("Could not send request. Refresh your session and try again.");
    }
  };

  const getSearchAction = (result: User) => {
    if (friendIds.has(result.id)) return { label: "Friends", disabled: true };
    if (pendingSentIds.has(result.id)) return { label: "Request sent", disabled: true };
    if (pendingReceivedIds.has(result.id)) return { label: "Respond", disabled: true };
    return { label: "Add", disabled: false };
  };

  const acceptRequest = async (requestId: number) => {
    await friendApi.accept(requestId);
    await loadAll();
  };

  const rejectRequest = async (requestId: number) => {
    await friendApi.reject(requestId);
    await loadAll();
  };

  const deviceControls = (
    <div className="space-y-3">
      <label className="block text-xs font-medium text-slate-500">
        <span className="mb-1 flex items-center gap-1"><Mic size={14} /> Microphone</span>
        <select
          value={audioInputId}
          onChange={(event) => setAudioInputId(event.target.value)}
          onFocus={() => loadDevices().catch(() => undefined)}
          className="w-full rounded-md border border-[#d1d1e0] bg-white px-2 py-2 text-sm text-slate-800 outline-none focus:border-[#6264a7]"
        >
          <option value="">Default microphone</option>
          {audioInputs.map((device, index) => (
            <option key={device.deviceId || index} value={device.deviceId}>
              {device.label || `Microphone ${index + 1}`}
            </option>
          ))}
        </select>
      </label>
      <label className="block text-xs font-medium text-slate-500">
        <span className="mb-1 flex items-center gap-1"><Video size={14} /> Camera</span>
        <select
          value={videoInputId}
          onChange={(event) => setVideoInputId(event.target.value)}
          onFocus={() => loadDevices().catch(() => undefined)}
          className="w-full rounded-md border border-[#d1d1e0] bg-white px-2 py-2 text-sm text-slate-800 outline-none focus:border-[#6264a7]"
        >
          <option value="">Default camera</option>
          {videoInputs.map((device, index) => (
            <option key={device.deviceId || index} value={device.deviceId}>
              {device.label || `Camera ${index + 1}`}
            </option>
          ))}
        </select>
      </label>
      <label className="block text-xs font-medium text-slate-500">
        <span className="mb-1 flex items-center gap-1"><Speaker size={14} /> Speaker</span>
        <select
          value={audioOutputId}
          onChange={(event) => {
            setAudioOutputId(event.target.value);
            setSoundReady(false);
          }}
          onFocus={() => loadDevices().catch(() => undefined)}
          className="w-full rounded-md border border-[#d1d1e0] bg-white px-2 py-2 text-sm text-slate-800 outline-none focus:border-[#6264a7]"
        >
          <option value="">Default speaker</option>
          {audioOutputs.map((device, index) => (
            <option key={device.deviceId || index} value={device.deviceId}>
              {device.label || `Speaker ${index + 1}`}
            </option>
          ))}
        </select>
      </label>
      <button
        onClick={() => loadDevices().then(unlockAudio).catch(() => setCallError("Allow microphone/camera permission to show device names."))}
        className="w-full rounded-md border border-[#d1d1e0] py-2 text-sm font-medium hover:bg-[#f5f5fb]"
      >
        Refresh devices
      </button>
      <button
        onClick={unlockAudio}
        className={`w-full rounded-md py-2 text-sm font-medium ${
          soundReady ? "bg-emerald-50 text-emerald-700" : "bg-[#6264a7] text-white"
        }`}
      >
        {soundReady ? "Call sound enabled" : "Enable call sound"}
      </button>
      {callError && <p className="rounded-md bg-red-50 p-2 text-xs text-red-700">{callError}</p>}
    </div>
  );

  const callPanel = activeCall ? (
    activeCall.state === "ringing" && activeCall.callee_id === user?.id ? (
    <div className="overflow-hidden rounded-lg bg-[#4a403d] text-white shadow-2xl shadow-slate-900/35">
      <div className="flex h-10 items-center justify-between px-3 text-xs">
        <span
          onPointerDown={startCallDrag}
          onPointerMove={moveCallDrag}
          onPointerUp={endCallDrag}
          onPointerCancel={endCallDrag}
          className="cursor-move select-none font-semibold"
        >
          Chat Messenger
        </span>
        <button onClick={() => setCallMinimized(true)} className="grid h-7 w-7 place-items-center rounded-md hover:bg-white/10" title="Minimize">
          <Minimize2 size={15} />
        </button>
      </div>
      <div className="flex flex-col items-center px-5 pb-4 pt-2 text-center">
        <div className="grid h-20 w-20 place-items-center overflow-hidden rounded-full bg-[#ffdcd7] text-3xl font-semibold text-[#8a3f34] shadow-lg">
          {callPeer?.avatar ? <img src={avatarSrc(callPeer.avatar)} alt={callPeer.name} className="h-full w-full object-cover" /> : (callPeer?.name ?? "C").slice(0, 1).toUpperCase()}
        </div>
        <h2 className="mt-3 max-w-full truncate text-sm font-semibold">{callPeer?.name ?? "Incoming call"}</h2>
        <p className="text-sm text-white/90">is calling you</p>
        <div className="mt-4 grid w-full grid-cols-2 gap-2">
          <button onClick={() => setCallState("accepted")} className="flex items-center justify-center gap-2 rounded-md bg-[#5b5fc7] py-2.5 font-semibold hover:bg-[#4f52b2]">
            <Phone size={17} />Accept
          </button>
          <button onClick={() => setCallState("rejected")} className="flex items-center justify-center gap-2 rounded-md bg-[#d13438] py-2.5 font-semibold hover:bg-[#b92d31]">
            <PhoneOff size={17} />Reject
          </button>
        </div>
      </div>
    </div>
    ) : (
    <div className={callMinimized ? "rounded-lg border border-[#d1d1e0] bg-white p-2 shadow-2xl shadow-slate-900/20" : "flex h-full flex-col overflow-hidden rounded-lg border border-[#d1d1e0] bg-white shadow-2xl shadow-slate-900/25"}>
      <audio ref={bindRemoteAudio} autoPlay />
      <div className="flex h-16 shrink-0 items-center justify-between border-b border-[#ddddec] bg-white px-3">
        <div
          onPointerDown={startCallDrag}
          onPointerMove={moveCallDrag}
          onPointerUp={endCallDrag}
          onPointerCancel={endCallDrag}
          className="flex min-w-0 cursor-move select-none items-center gap-3"
        >
          <Shield size={19} className="text-slate-700" />
          <span className="text-sm text-slate-700">
            {activeCall.state === "accepted" ? formatDuration(activeCall.answered_at ?? activeCall.started_at) : "00:00"}
          </span>
        </div>
        <div className="flex items-center gap-1">
          {!callMinimized && (
            <>
              {[
                { label: "Record", icon: <RefreshCcw size={18} />, action: undefined },
                { label: "Chat", icon: <MessageSquare size={18} />, action: () => setCallMinimized(true) },
                { label: "People", icon: <Users size={18} />, action: undefined },
                { label: "View", icon: <Grid2X2 size={18} />, action: undefined },
                { label: "More", icon: <MoreHorizontal size={20} />, action: undefined }
              ].map((item) => (
                <button key={item.label} onClick={item.action} className="hidden min-w-14 rounded-md px-2 py-1.5 text-xs text-slate-700 hover:bg-[#f3f3f8] md:grid md:place-items-center" title={item.label}>
                  {item.icon}
                  <span className="mt-0.5">{item.label}</span>
                </button>
              ))}
              <span className="mx-1 hidden h-9 w-px bg-[#ddddec] md:block" />
              <button onClick={toggleCameraOff} className={`min-w-14 rounded-md px-2 py-1.5 text-xs ${cameraOff ? "bg-[#f3f3f8] text-slate-400" : "text-slate-700 hover:bg-[#f3f3f8]"}`} title={cameraOff ? "Turn camera on" : "Turn camera off"}>
                <span className="grid place-items-center">{cameraOff ? <VideoOff size={18} /> : <Video size={18} />}</span>
                <span className="mt-0.5 block">Camera</span>
              </button>
              <button onClick={switchCamera} className="hidden min-w-10 rounded-md px-2 py-1.5 text-xs text-slate-700 hover:bg-[#f3f3f8] md:grid md:place-items-center" title="Switch camera">
                <RefreshCcw size={17} />
              </button>
              <div className="relative">
                <button onClick={toggleMicMute} className={`min-w-14 rounded-l-md px-2 py-1.5 text-xs ${micMuted ? "bg-[#f3f3f8] text-slate-400" : "text-slate-700 hover:bg-[#f3f3f8]"}`} title={micMuted ? "Unmute microphone" : "Mute microphone"}>
                  <span className="grid place-items-center">{micMuted ? <MicOff size={18} /> : <Mic size={18} />}</span>
                  <span className="mt-0.5 block">Mic</span>
                </button>
                <button onClick={() => setShowAudioMenu((value) => !value)} className="absolute right-0 top-0 grid h-full w-5 place-items-center rounded-r-md text-[#6264a7] hover:bg-[#ededfa]" title="Audio settings">
                  <ChevronDown size={13} />
                </button>
                {showAudioMenu && (
                  <div className="absolute right-0 top-14 z-[70] w-80 rounded-md border border-[#ddddec] bg-white p-4 text-left text-sm text-slate-700 shadow-2xl">
                    <p className="mb-2 font-medium">Speaker</p>
                    <label className="flex items-center gap-2">
                      <input type="radio" checked readOnly />
                      <span className="truncate">{audioOutputs.find((device) => device.deviceId === audioOutputId)?.label || "Default speaker"}</span>
                    </label>
                    <div className="mt-3 flex items-center gap-3">
                      <Volume2 size={18} />
                      <input type="range" min="0" max="100" defaultValue="70" className="w-full accent-[#6264a7]" />
                    </div>
                    <hr className="my-4" />
                    <p className="mb-2 font-medium">Microphone</p>
                    <div className="space-y-2">
                      <label className="flex items-center gap-2">
                        <input type="radio" checked={!audioInputId} onChange={() => setAudioInputId("")} />
                        <span>Default microphone</span>
                      </label>
                      {audioInputs.slice(0, 3).map((device) => (
                        <label key={device.deviceId} className="flex items-center gap-2">
                          <input type="radio" checked={audioInputId === device.deviceId} onChange={() => setAudioInputId(device.deviceId)} />
                          <span className="truncate">{device.label || "Microphone"}</span>
                        </label>
                      ))}
                    </div>
                    <div className="mt-3 flex items-center gap-1 text-slate-400">
                      <MicOff size={17} />
                      {Array.from({ length: 18 }).map((_, index) => <span key={index} className="h-4 w-1 rounded-full bg-slate-300" />)}
                    </div>
                    <hr className="my-4" />
                    <label className="flex items-center justify-between">
                      <span>Noise suppression</span>
                      <button type="button" onClick={() => setNoiseSuppression((value) => !value)} className={`h-6 w-11 rounded-full p-0.5 ${noiseSuppression ? "bg-[#6264a7]" : "bg-slate-300"}`}>
                        <span className={`block h-5 w-5 rounded-full bg-white transition ${noiseSuppression ? "translate-x-5" : ""}`} />
                      </button>
                    </label>
                    <hr className="my-4" />
                    <button type="button" className="text-left text-slate-700">More audio settings</button>
                  </div>
                )}
              </div>
              <button onClick={toggleScreenShare} className={`min-w-14 rounded-md px-2 py-1.5 text-xs ${screenSharing ? "bg-[#6264a7] text-white" : "text-slate-700 hover:bg-[#f3f3f8]"}`} title={screenSharing ? "Stop sharing" : "Share screen"}>
                <span className="grid place-items-center"><MonitorUp size={18} /></span>
                <span className="mt-0.5 block">Share</span>
              </button>
              <span className="mx-1 hidden h-9 w-px bg-[#ddddec] md:block" />
            </>
          )}
          <button
            onClick={() => setCallMinimized((value) => !value)}
            className="grid h-9 w-9 place-items-center rounded-md text-[#464775] hover:bg-[#ededfa]"
            title={callMinimized ? "Restore call" : "Minimize call"}
          >
            {callMinimized ? <Maximize2 size={17} /> : <Minimize2 size={17} />}
          </button>
          <button
            onClick={() => setCallState(activeCall.state === "ringing" ? "rejected" : "ended")}
            className="grid h-9 w-9 place-items-center rounded-md bg-[#c4314b] text-white hover:bg-[#a4263c]"
            title={activeCall.state === "ringing" && activeCall.callee_id === user?.id ? "Reject" : "End call"}
          >
            <PhoneOff size={17} />
          </button>
        </div>
      </div>
      {callMinimized ? (
        <button onClick={() => setCallMinimized(false)} className="mt-2 flex w-full items-center gap-3 text-left">
          <span className="grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-full bg-[#c7d5e8] text-lg font-semibold text-[#123a63]">
            {callPeer?.avatar ? <img src={avatarSrc(callPeer.avatar)} alt={callPeer.name} className="h-full w-full object-cover" /> : (callPeer?.name ?? "C").slice(0, 1).toUpperCase()}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold">{callPeer?.name ?? "Call"}</span>
            <span className="block truncate text-xs text-slate-500">
              {activeCall.state === "accepted" ? formatDuration(activeCall.answered_at ?? activeCall.started_at) : activeCall.state}
            </span>
          </span>
        </button>
      ) : (
        <div className="relative min-h-0 flex-1 overflow-hidden bg-[#f7f8fb]">
          {activeCall.state === "accepted" && activeCall.call_type === "video" && remoteStream ? (
            <video ref={bindRemoteVideo} autoPlay playsInline className="h-full w-full bg-slate-950 object-cover" />
          ) : (
            <div className="flex h-full flex-col items-center justify-center bg-gradient-to-br from-[#f8fafc] via-[#eef6ef] to-[#e7f3f6] p-6 text-center">
              <div className="grid h-36 w-36 place-items-center overflow-hidden rounded-full bg-[#c7d5e8] text-6xl font-semibold text-[#123a63] shadow-sm sm:h-44 sm:w-44">
                {callPeer?.avatar ? <img src={avatarSrc(callPeer.avatar)} alt={callPeer.name} className="h-full w-full object-cover" /> : (callPeer?.name ?? "C").slice(0, 1).toUpperCase()}
              </div>
              <p className="mt-6 text-lg font-semibold text-slate-800">
                {activeCall.state === "accepted" ? formatDuration(activeCall.answered_at ?? activeCall.started_at) : activeCall.callee_id === user?.id ? "Incoming call..." : "Calling..."}
              </p>
              <p className="mt-1 text-sm capitalize text-slate-500">{activeCall.call_type} call</p>
            </div>
          )}
          <div className="absolute bottom-4 left-4 rounded-md bg-slate-900/60 px-2 py-1 text-xs font-medium text-white">
            {callPeer?.name ?? "Call"}
          </div>
          <div className="absolute bottom-4 right-4 h-32 w-44 overflow-hidden rounded-lg border border-white/70 bg-[#e8f7f4] shadow-xl">
            {activeCall.call_type === "video" && localStream ? (
              cameraOff ? (
                <div className="grid h-full place-items-center text-sm font-semibold text-slate-600">Camera off</div>
              ) : (
                <video ref={bindLocalVideo} muted autoPlay playsInline className="h-full w-full object-cover" />
              )
            ) : (
              <div className="grid h-full place-items-center">
                <div className="grid h-16 w-16 place-items-center overflow-hidden rounded-full bg-[#c7d5e8] text-xl font-semibold text-[#123a63]">
                  {user?.avatar ? <img src={avatarSrc(user.avatar)} alt={user.name} className="h-full w-full object-cover" /> : (user?.name ?? "Y").slice(0, 1).toUpperCase()}
                </div>
              </div>
            )}
          </div>
          {activeCall.state === "ringing" && activeCall.callee_id === user?.id && (
            <button onClick={() => setCallState("accepted")} className="absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-full bg-[#13a10e] px-6 py-3 font-semibold text-white shadow-lg hover:bg-[#0f7b0c]">
              <Phone size={18} />Accept
            </button>
          )}
        </div>
      )}
    </div>
    )
  ) : null;

  return (
    <main className="relative grid h-[calc(100dvh-3.5rem)] grid-cols-1 overflow-hidden bg-[#f5f5fb] pb-14 md:grid-cols-[64px_300px_minmax(0,1fr)] md:pb-0 xl:grid-cols-[64px_310px_minmax(0,1fr)_320px]">
      <nav className="fixed inset-x-0 bottom-0 z-40 grid h-14 grid-cols-3 justify-items-center border-t border-[#ddddec] bg-[#ebebf5] px-2 py-1 md:static md:h-auto md:grid-cols-1 md:border-r md:border-t-0 md:px-0 md:py-3 md:flex md:flex-col md:items-center md:gap-2">
        <button
          onClick={showChatView}
          className={`grid h-12 w-12 place-items-center rounded-md ${activeView === "chat" ? "bg-[#6264a7] text-white" : "text-[#464775] hover:bg-white"}`}
          title="Chat"
        >
          <MessageSquare size={21} />
        </button>
        <button
          onClick={showActivityView}
          className={`relative grid h-12 w-12 place-items-center rounded-md ${activeView === "activity" ? "bg-[#6264a7] text-white" : "text-[#464775] hover:bg-white"}`}
          title="Activity"
        >
          <Bell size={21} />
          {incomingRequests.length > 0 && <span className="absolute right-2 top-2 h-2.5 w-2.5 rounded-full bg-[#c4314b]" />}
        </button>
        <button
          onClick={showPeopleView}
          className={`grid h-12 w-12 place-items-center rounded-md ${activeView === "people" ? "bg-[#6264a7] text-white" : "text-[#464775] hover:bg-white"}`}
          title="People"
        >
          <Users size={21} />
        </button>
      </nav>

      <aside className={`${selected ? "hidden md:block" : "block"} overflow-y-auto border-r border-[#ddddec] bg-[#f7f7fc] p-3`}>
        <div className="mb-3 flex items-center justify-between px-1">
          <h2 className="text-xl font-semibold tracking-tight">{activeView === "chat" ? "Chat" : activeView === "activity" ? "Activity" : "People"}</h2>
          <button
            type="button"
            onClick={() => activeView === "chat" ? setShowGroupModal(true) : activeView === "activity" ? showPeopleView() : showPeopleView()}
            className="grid h-9 w-9 place-items-center rounded-md bg-white text-[#464775] shadow-sm hover:bg-[#ededfa]"
            title={activeView === "chat" ? "Create group" : "People"}
          >
            {activeView === "chat" ? <MessageSquare size={17} /> : <UserPlus size={17} />}
          </button>
        </div>
        {activeView === "activity" && (
          <div className="space-y-4">
            <section className="rounded-md border border-[#d1d1e0] bg-white p-3">
              <h3 className="font-semibold">Friend requests</h3>
              <div className="mt-3 space-y-2">
                {incomingRequests.length === 0 && <p className="text-sm text-slate-500">No pending requests.</p>}
                {incomingRequests.map((request) => (
                  <div key={request.id} className="rounded-md bg-[#f7f7fc] p-3">
                    <div className="flex items-center gap-2">
                      <span className="grid h-9 w-9 place-items-center overflow-hidden rounded-full bg-[#6264a7] font-semibold text-white">
                        {requestSenderAvatar(request) ? <img src={avatarSrc(requestSenderAvatar(request))} alt={requestSenderName(request)} className="h-full w-full object-cover" /> : requestSenderName(request).slice(0, 1).toUpperCase()}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-sm font-medium">{requestSenderName(request)}</span>
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-2">
                      <button onClick={() => acceptRequest(request.id)} className="rounded-md bg-[#13a10e] py-2 text-sm font-medium text-white">Accept</button>
                      <button onClick={() => rejectRequest(request.id)} className="rounded-md bg-[#c4314b] py-2 text-sm font-medium text-white">Reject</button>
                    </div>
                  </div>
                ))}
              </div>
            </section>
            <section className="rounded-md border border-[#d1d1e0] bg-white p-3">
              <h3 className="font-semibold">Call records</h3>
              <div className="mt-3 space-y-2">
                {callHistory.length === 0 && <p className="text-sm text-slate-500">No call records yet.</p>}
                {callHistory.slice(0, 12).map((call) => {
                  const otherId = call.caller_id === user?.id ? call.callee_id : call.caller_id;
                  const other = friends.find((friend) => friend.user.id === otherId)?.user;
                  return (
                    <div key={call.id} className="rounded-md bg-[#f7f7fc] p-3 text-sm">
                      <p className="font-medium">{other?.name ?? `User #${otherId}`}</p>
                      <p className="text-xs capitalize text-slate-500">{call.call_type} call {call.state} at {formatClockTime(call.started_at)}</p>
                    </div>
                  );
                })}
              </div>
            </section>
            <section className="rounded-md border border-[#d1d1e0] bg-white p-3">
              <h3 className="font-semibold">Mentions</h3>
              <div className="mt-3 space-y-2">
                {mentionMessages.length === 0 && <p className="text-sm text-slate-500">No mentions in this chat.</p>}
                {mentionMessages.slice(-6).map((message) => (
                  <div key={message.id} className="rounded-md bg-[#f7f7fc] p-3 text-sm">
                    <p className="truncate">{message.body}</p>
                    <p className="text-xs text-slate-500">{formatClockTime(message.created_at)}</p>
                  </div>
                ))}
              </div>
            </section>
          </div>
        )}
        <div className="relative">
          <Search className="absolute left-3 top-3 text-slate-400" size={18} />
          <input
            value={query}
            onChange={(event) => search(event.target.value)}
            className="w-full rounded-md border border-[#d1d1e0] bg-white py-2.5 pl-10 pr-3 outline-none focus:border-[#6264a7]"
            placeholder="Search"
          />
        </div>
        {searchError && <p className="mt-2 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{searchError}</p>}
        <div className="mt-4 space-y-2">
          {results.map((result) => {
            const action = getSearchAction(result);
            return (
              <button
                key={result.id}
                onClick={() => !action.disabled && sendFriendRequest(result.id)}
                disabled={action.disabled}
                className="flex w-full items-center justify-between rounded-md border border-[#d1d1e0] bg-white p-3 text-left hover:bg-[#ededfa] disabled:cursor-default disabled:opacity-75 disabled:hover:bg-white"
              >
                <span className="min-w-0">
                  <span className="block truncate font-medium">{result.name}</span>
                  <span className="block truncate text-xs text-slate-500">{result.email}</span>
                </span>
                <span className={`ml-3 shrink-0 rounded-md px-2 py-1 text-xs font-semibold ${action.disabled ? "bg-slate-100 text-slate-500" : "bg-[#ededfa] text-[#464775]"}`}>
                  {action.label}
                </span>
              </button>
            );
          })}
        </div>
        {activeView === "people" && (
          <>
            <h2 className="mt-6 px-1 text-sm font-semibold text-slate-500">Friend Requests</h2>
            <div className="mt-3 space-y-2">
              {incomingRequests.length === 0 && <p className="px-1 text-sm text-slate-500">No pending requests.</p>}
              {incomingRequests.map((request) => (
                <div key={request.id} className="rounded-md border border-[#d1d1e0] bg-white p-3">
                  <div className="flex items-center gap-3">
                    <span className="grid h-9 w-9 place-items-center overflow-hidden rounded-full bg-[#6264a7] font-semibold text-white">
                      {requestSenderAvatar(request) ? (
                        <img src={avatarSrc(requestSenderAvatar(request))} alt={requestSenderName(request)} className="h-full w-full object-cover" />
                      ) : (
                        requestSenderName(request).slice(0, 1).toUpperCase()
                      )}
                    </span>
                    <div>
                      <p className="text-sm font-medium">{requestSenderName(request)}</p>
                      <p className="text-xs text-slate-500">sent you a friend request</p>
                    </div>
                  </div>
                  <div className="mt-3 flex gap-2">
                    <button onClick={() => acceptRequest(request.id)} className="flex flex-1 items-center justify-center gap-1 rounded-md bg-[#13a10e] py-2 text-sm font-medium text-white">
                      <Check size={15} />Accept
                    </button>
                    <button onClick={() => rejectRequest(request.id)} className="flex flex-1 items-center justify-center gap-1 rounded-md bg-[#c4314b] py-2 text-sm font-medium text-white">
                      <X size={15} />Reject
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
        {activeView === "chat" && conversations.some((conversation) => conversation.conversation_type === "group") && (
          <>
            <h2 className="mt-6 px-1 text-sm font-semibold text-slate-500">Groups</h2>
            <div className="mt-3 space-y-2">
              {conversations.filter((conversation) => conversation.conversation_type === "group").map((conversation) => {
                const lastMessage = lastMessages[conversation.id];
                const unread = messageUnread(lastMessage, user?.id);
                return (
                  <button key={conversation.id} onClick={() => selectConversation(conversation)} className="flex w-full items-center gap-3 rounded-md p-3 text-left hover:bg-[#ededfa]">
                    <span className="grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-full bg-[#6264a7] font-semibold text-white">
                      {(conversation.title ?? "G").slice(0, 1).toUpperCase()}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className={`block truncate ${unread ? "font-bold" : "font-medium"}`}>{conversation.title ?? "Group"}</span>
                      <span className={`block truncate text-xs ${unread ? "font-bold text-slate-900" : "text-slate-500"}`}>
                        {messagePreview(lastMessage, user?.id)}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          </>
        )}
        <h2 className="mt-6 px-1 text-sm font-semibold text-slate-500">{activeView === "chat" ? "Friends" : "Your Friends"}</h2>
        <div className="mt-3 space-y-2">
          {friends.map((friend) => {
            const conversation = conversations.find((item) => item.conversation_type !== "group" && (item.peer?.id === friend.user.id || item.user1_id === friend.user.id || item.user2_id === friend.user.id));
            const lastMessage = conversation ? lastMessages[conversation.id] : undefined;
            const unread = messageUnread(lastMessage, user?.id);
            return (
              <button key={friend.friendship_id} onClick={() => openConversation(friend)} className="flex w-full items-center gap-3 rounded-md p-3 text-left hover:bg-[#ededfa]">
                <span className="relative grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-full bg-[#6264a7] font-semibold text-white">
                  {friend.user.avatar ? <img src={avatarSrc(friend.user.avatar)} alt={friend.user.name} className="h-full w-full object-cover" /> : friend.user.name.slice(0, 1).toUpperCase()}
                  <span className={`absolute bottom-0 right-0 h-3 w-3 rounded-full border-2 border-white ${friend.user.online ? "bg-emerald-500" : "bg-slate-400"}`} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className={`block truncate ${unread ? "font-bold" : "font-medium"}`}>{friend.user.name}</span>
                  <span className={`block truncate text-xs ${unread ? "font-bold text-slate-900" : "text-slate-500"}`}>
                    {messagePreview(lastMessage, user?.id)}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </aside>

      <section className={`${selected || activeView === "people" ? "flex" : "hidden md:flex"} min-h-0 flex-col bg-white`}>
        {activeView === "people" ? (
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="border-b border-[#ddddec] bg-white px-5 py-4">
              <h2 className="text-xl font-semibold">People</h2>
              <p className="text-sm text-slate-500">Find teammates, manage friend requests, and start chats.</p>
            </div>
            <div className="grid flex-1 gap-4 overflow-y-auto bg-[#f5f5fb] p-4 lg:grid-cols-2">
              <section className="rounded-md border border-[#d1d1e0] bg-white p-4">
                <h3 className="font-semibold">Incoming requests</h3>
                <div className="mt-3 space-y-2">
                  {incomingRequests.length === 0 && <p className="text-sm text-slate-500">No pending requests.</p>}
                  {incomingRequests.map((request) => (
                    <div key={request.id} className="flex items-center justify-between rounded-md border border-[#d1d1e0] p-3">
                      <span className="flex items-center gap-3 text-sm">
                        <span className="grid h-9 w-9 place-items-center overflow-hidden rounded-full bg-[#6264a7] font-semibold text-white">
                          {requestSenderAvatar(request) ? (
                            <img src={avatarSrc(requestSenderAvatar(request))} alt={requestSenderName(request)} className="h-full w-full object-cover" />
                          ) : (
                            requestSenderName(request).slice(0, 1).toUpperCase()
                          )}
                        </span>
                        <span>
                          <span className="block font-medium">{requestSenderName(request)}</span>
                          <span className="block text-xs text-slate-500">wants to connect</span>
                        </span>
                      </span>
                      <span className="flex gap-2">
                        <button onClick={() => acceptRequest(request.id)} className="rounded-md bg-[#13a10e] px-3 py-1.5 text-sm font-medium text-white">Accept</button>
                        <button onClick={() => rejectRequest(request.id)} className="rounded-md bg-[#c4314b] px-3 py-1.5 text-sm font-medium text-white">Reject</button>
                      </span>
                    </div>
                  ))}
                </div>
              </section>
              <section className="rounded-md border border-[#d1d1e0] bg-white p-4">
                <h3 className="font-semibold">Friends</h3>
                <div className="mt-3 space-y-2">
                  {friends.length === 0 && <p className="text-sm text-slate-500">No friends yet.</p>}
                  {friends.map((friend) => (
                    <button key={friend.friendship_id} onClick={() => openConversation(friend)} className="flex w-full items-center gap-3 rounded-md p-3 text-left hover:bg-[#ededfa]">
                      <span className="grid h-10 w-10 place-items-center overflow-hidden rounded-full bg-[#6264a7] font-semibold text-white">
                        {friend.user.avatar ? <img src={avatarSrc(friend.user.avatar)} alt={friend.user.name} className="h-full w-full object-cover" /> : friend.user.name.slice(0, 1).toUpperCase()}
                      </span>
                      <span>
                        <span className="block font-medium">{friend.user.name}</span>
                        <span className="block text-xs text-slate-500">{friend.user.online ? "Online" : "Offline"}</span>
                      </span>
                    </button>
                  ))}
                </div>
              </section>
            </div>
          </div>
        ) : selected ? (
          <>
            <div className="flex items-center justify-between border-b border-[#ddddec] bg-white px-3 py-2 sm:px-4">
              <div className="min-w-0">
                <h2 className="font-semibold">{conversationTitle(selected)}</h2>
                <p className="truncate text-xs text-slate-500">{conversationSubtitle(selected)}</p>
              </div>
              <div className="flex shrink-0 gap-1 sm:gap-2">
                {selected.conversation_type !== "group" && (
                  <>
                    <button onClick={() => startCall("audio")} className="grid h-9 w-9 place-items-center rounded-md text-[#464775] hover:bg-[#ededfa]" title="Audio call"><Phone size={18} /></button>
                    <button onClick={() => startCall("video")} className="grid h-9 w-9 place-items-center rounded-md text-[#464775] hover:bg-[#ededfa]" title="Video call"><Video size={18} /></button>
                  </>
                )}
                <button onClick={() => setShowMobileDevices((value) => !value)} className="grid h-9 w-9 place-items-center rounded-md text-[#464775] hover:bg-[#ededfa] xl:hidden" title="Call devices"><SlidersHorizontal size={18} /></button>
              </div>
            </div>
            {showMobileDevices && (
              <div className="max-h-[42dvh] overflow-y-auto border-b border-[#ddddec] bg-[#f7f7fc] p-3 xl:hidden">
                {deviceControls}
              </div>
            )}
            <div ref={messagesContainer} className="flex-1 space-y-3 overflow-y-auto bg-[#f5f5fb] p-4">
              {pinnedMessageIds.length > 0 && (
                <div className="sticky top-0 z-10 rounded-md border border-[#ddddec] bg-white/95 p-2 text-xs shadow-sm backdrop-blur">
                  <p className="font-semibold text-slate-700">Pinned</p>
                  <div className="mt-1 space-y-1">
                    {messages.filter((message) => pinnedMessageIds.includes(message.id)).slice(-3).map((message) => (
                      <button key={message.id} type="button" onClick={() => setReplyingTo(message)} className="block w-full truncate rounded bg-[#f7f7fc] px-2 py-1 text-left text-slate-600">
                        {messageSummary(message)}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {messages.map((rawMessage) => {
                const message = normalizeMessage(rawMessage);
                if (isCallEvent(message)) {
                  return (
                    <div key={message.id} className="flex justify-center">
                      <span className="rounded-md bg-white px-3 py-1.5 text-xs font-medium text-slate-600 shadow-sm">
                        {callEventText(message)}
                      </span>
                    </div>
                  );
                }
                const mine = message.sender_id === user?.id;
                return (
                  <div key={message.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                    <div
                      onPointerDown={(event) => startMessageSwipe(message, event)}
                      onPointerUp={(event) => endMessageSwipe(message, event)}
                      onContextMenu={(event) => openMessageMenu(message, event)}
                      className={`group relative max-w-[78%] rounded-md px-3.5 py-2 text-sm shadow-sm ${locallyUnreadIds.includes(message.id) ? "ring-2 ring-[#6264a7]/40" : ""} ${mine ? "bg-[#6264a7] text-white" : "bg-white text-slate-900"}`}
                    >
                      <button
                        type="button"
                        onClick={(event) => openMessageMenu(message, event)}
                        className={`absolute -top-3 ${mine ? "left-2" : "right-2"} grid h-7 w-7 place-items-center rounded-full bg-white text-[#464775] opacity-0 shadow-md transition group-hover:opacity-100`}
                        title="Message actions"
                      >
                        <MoreHorizontal size={17} />
                      </button>
                      {message.reply_to && (
                        <button
                          type="button"
                          onClick={() => setReplyingTo(message.reply_to ? ({ ...message.reply_to, conversation_id: message.conversation_id, attachment_url: null, attachment_mime: null, attachment_size: null, created_at: message.created_at, read_by: [] } as Message) : null)}
                          className={`mb-2 block w-full rounded-md border-l-4 px-2 py-1 text-left text-xs ${mine ? "border-white/70 bg-white/15" : "border-[#6264a7] bg-[#f3f3fb]"}`}
                        >
                          <span className="block font-semibold">Reply</span>
                          <span className="block truncate">{messageSummary(message.reply_to as Message)}</span>
                        </button>
                      )}
                      {message.message_type === "gif" && message.body.startsWith("http") && (
                        <img src={message.body} alt="GIF" className="mb-2 max-h-72 rounded-md object-contain" />
                      )}
                      {message.deleted_for_everyone ? (
                        <p className="italic opacity-80">This message was deleted</p>
                      ) : (
                        <>
                      {message.message_type === "image" && message.attachment_url && (
                        <img src={absoluteMediaUrl(message.attachment_url)} alt={message.attachment_name ?? "Image"} className="mb-2 max-h-72 rounded-md object-contain" />
                      )}
                      {message.message_type === "audio" && message.attachment_url && (
                        <audio controls src={absoluteMediaUrl(message.attachment_url)} className="mb-2 max-w-full" />
                      )}
                      {message.message_type === "video" && message.attachment_url && (
                        <video controls src={absoluteMediaUrl(message.attachment_url)} className="mb-2 max-h-80 max-w-full rounded-md bg-slate-950" />
                      )}
                      {message.message_type === "file" && message.attachment_url && (
                        <a
                          href={absoluteMediaUrl(message.attachment_url)}
                          target="_blank"
                          rel="noreferrer"
                          className={`mb-2 flex items-center gap-2 rounded-md px-3 py-2 ${mine ? "bg-white/15 text-white" : "bg-slate-100 text-slate-800"}`}
                        >
                          <FileUp size={16} />
                          <span className="truncate">{message.attachment_name ?? "Attachment"}</span>
                        </a>
                      )}
                      {message.body && !(message.message_type === "gif" && message.body.startsWith("http")) && <p className={message.message_type === "emoji" || message.message_type === "sticker" ? "text-3xl" : ""}>{message.body}</p>}
                        </>
                      )}
                      <div className={`mt-1 flex items-center justify-between gap-3 text-[11px] ${mine ? "text-blue-100" : "text-slate-400"}`}>
                        <span>{mine && peer && includesNumber(message.read_by, peer.id) ? "Read" : "Sent"}</span>
                        <span className="flex gap-2 opacity-0 transition group-hover:opacity-100">
                          {!message.deleted_for_everyone && <button type="button" onClick={() => setReplyingTo(message)} className="underline">Reply</button>}
                          <button type="button" onClick={() => deleteMessage(message, "me")} className="underline">Delete me</button>
                          {mine && !message.deleted_for_everyone && <button type="button" onClick={() => deleteMessage(message, "everyone")} className="underline">Delete all</button>}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
              <div ref={messagesEnd} />
            </div>
            <form onSubmit={sendMessage} className="relative border-t border-[#ddddec] bg-white p-3 sm:p-4">
              {showEmojiPanel && (
                <div
                  className="absolute bottom-[76px] right-3 z-20 flex max-h-[min(72dvh,560px)] w-[min(360px,calc(100vw-2rem))] flex-col overflow-hidden rounded-lg border border-[#d1d1e0] bg-white shadow-2xl"
                  onMouseDown={(event) => event.stopPropagation()}
                >
                  <div className="grid grid-cols-4 border-b border-[#e6e6f2] text-sm">
                    {(["all", "emoji", "stickers", "gifs"] as const).map((tab) => (
                      <button
                        key={tab}
                        type="button"
                        onClick={() => setEmojiTab(tab)}
                        className={`py-3 font-medium capitalize ${emojiTab === tab ? "border-b-2 border-[#6264a7] text-slate-900" : "text-slate-500 hover:bg-[#f7f7fc]"}`}
                      >
                        {tab === "gifs" ? "GIFs" : tab}
                      </button>
                    ))}
                  </div>
                  <div className="flex gap-1 overflow-x-auto border-b border-[#e6e6f2] px-2 py-2 text-lg">
                    {([
                      ["emoji", "🕘"],
                      ["people", "☺️"],
                      ["gestures", "👋"],
                      ["food", "🍕"],
                      ["places", "🏙️"],
                      ["objects", "💡"],
                      ["symbols", "#️⃣"]
                    ] as const).map(([tab, icon]) => (
                      <button
                        key={tab}
                        type="button"
                        onClick={() => setEmojiTab(tab)}
                        className={`grid h-8 w-8 shrink-0 place-items-center rounded-md ${emojiTab === tab ? "bg-[#ededfa] text-[#464775]" : "hover:bg-[#f7f7fc]"}`}
                      >
                        {icon}
                      </button>
                    ))}
                  </div>
                  <div className="min-h-0 overflow-y-auto p-3">
                    <div className="relative">
                      <Search className="absolute right-3 top-2.5 text-slate-400" size={16} />
                      <input
                        value={emojiSearch}
                        onChange={(event) => setEmojiSearch(event.target.value)}
                        className="w-full rounded-md border border-[#d1d1e0] py-2 pl-3 pr-9 text-sm outline-none focus:border-[#6264a7]"
                        placeholder="Find emoji, GIF, sticker"
                      />
                    </div>
                    {emojiTab !== "gifs" && emojiTab !== "stickers" && (
                      <>
                        <div className="mt-3 flex items-center justify-between text-sm">
                          <span className="font-medium text-slate-700">{emojiTab === "all" ? "Recent" : "Emoji"}</span>
                          <button type="button" onClick={() => setEmojiTab("emoji")} className="text-xs text-slate-500">See all</button>
                        </div>
                        <div className="mt-2 grid grid-cols-6 gap-2">
                          {(emojiTab === "all" ? filteredEmojiOptions.slice(0, 48) : filteredEmojiGroups[emojiTab as EmojiCategory]).map((emoji) => (
                            <button key={`${emoji.symbol}-${emoji.label}`} type="button" onClick={() => setBody((value) => `${value}${emoji.symbol}`)} className="grid h-10 place-items-center rounded-md text-2xl hover:bg-[#ededfa]" title={emoji.label}>
                              {emoji.symbol}
                            </button>
                          ))}
                        </div>
                      </>
                    )}
                    {(emojiTab === "all" || emojiTab === "stickers") && (
                      <>
                        <div className="mt-3 flex items-center justify-between text-sm">
                          <span className="font-medium text-slate-700">Stickers</span>
                          <button type="button" onClick={() => setEmojiTab("stickers")} className="text-xs text-slate-500">See all</button>
                        </div>
                        <div className="mt-2 grid grid-cols-3 gap-2">
                          {filteredStickerOptions.map((sticker) => (
                            <button
                              key={sticker.label}
                              type="button"
                              onClick={() => sendQuickMessage(sticker.value, "sticker")}
                              className={`grid h-20 place-items-center rounded-lg ${sticker.color} text-4xl shadow-sm hover:scale-[1.02]`}
                              title={sticker.label}
                            >
                              {sticker.value}
                            </button>
                          ))}
                        </div>
                      </>
                    )}
                    {(emojiTab === "all" || emojiTab === "gifs") && (
                      <>
                        <div className="mt-3 flex items-center justify-between text-sm">
                          <span className="font-medium text-slate-700">GIFs</span>
                          <button type="button" onClick={() => setEmojiTab("gifs")} className="text-xs text-slate-500">See all</button>
                        </div>
                        <div className="mt-2 grid grid-cols-3 gap-2">
                          {giphyResults.length > 0 ? giphyResults.map((gif) => (
                            <button
                              key={gif.id}
                              type="button"
                              onClick={() => sendQuickMessage(gif.url, "gif")}
                              className="overflow-hidden rounded-md bg-slate-100 shadow-sm hover:scale-[1.02]"
                              title={gif.title}
                            >
                              <img src={gif.preview} alt={gif.title} className="h-24 w-full object-cover" />
                            </button>
                          )) : filteredGifOptions.map((gif, index) => (
                            <button
                              key={gif.value}
                              type="button"
                              onClick={() => sendQuickMessage(gif.value, "gif")}
                              className={`grid h-24 place-items-center rounded-md p-2 text-center text-xs font-semibold text-white shadow-sm hover:scale-[1.02] ${
                                index % 3 === 0 ? "bg-[#6264a7]" : index % 3 === 1 ? "bg-[#0f766e]" : "bg-[#c4314b]"
                              }`}
                            >
                              <span className="text-3xl">{gif.icon}</span>
                              <span>{gif.label}</span>
                            </button>
                          ))}
                        </div>
                        <p className="mt-3 text-center text-[11px] text-slate-500">
                          {GIPHY_API_KEY ? (giphyLoading ? "Loading GIFs from GIPHY..." : "GIFs powered by GIPHY") : "Add VITE_GIPHY_API_KEY to use GIFs powered by GIPHY"}
                        </p>
                      </>
                    )}
                  </div>
                </div>
              )}
              {composerError && <p className="mb-2 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{composerError}</p>}
              {replyingTo && (
                <div className="mb-2 flex items-center justify-between rounded-md border-l-4 border-[#6264a7] bg-[#f3f3fb] px-3 py-2 text-sm">
                  <span className="min-w-0">
                    <span className="block font-semibold text-slate-700">Replying to message</span>
                    <span className="block truncate text-slate-500">{messageSummary(replyingTo)}</span>
                  </span>
                  <button type="button" onClick={() => setReplyingTo(null)} className="grid h-8 w-8 place-items-center rounded-md text-slate-500 hover:bg-white">
                    <X size={16} />
                  </button>
                </div>
              )}
              <input ref={fileInput} type="file" className="hidden" onChange={(event) => handleFileSelect(event.target.files?.[0])} />
              <input ref={mediaInput} type="file" accept="image/*,video/*,audio/*" className="hidden" onChange={(event) => handleFileSelect(event.target.files?.[0])} />
              <div className="flex gap-2">
                <button type="button" onClick={() => setShowEmojiPanel((value) => !value)} className="grid h-12 w-10 place-items-center rounded-md text-[#464775] hover:bg-[#ededfa]" title="Emoji, GIF, sticker">
                  <Laugh size={18} />
                </button>
                <button type="button" onClick={() => fileInput.current?.click()} className="grid h-12 w-10 place-items-center rounded-md text-[#464775] hover:bg-[#ededfa]" title="Attach file">
                  <Paperclip size={18} />
                </button>
                <button type="button" onClick={() => mediaInput.current?.click()} className="grid h-12 w-10 place-items-center rounded-md text-[#464775] hover:bg-[#ededfa]" title="Attach media">
                  <Image size={18} />
                </button>
                <button type="button" onClick={() => toggleRecording("audio")} className={`grid h-12 w-10 place-items-center rounded-md ${recordingKind === "audio" ? "bg-[#c4314b] text-white" : "text-[#464775] hover:bg-[#ededfa]"}`} title="Voice message">
                  {recordingKind === "audio" ? <Square size={16} /> : <Mic size={18} />}
                </button>
                <button type="button" onClick={() => toggleRecording("video")} className={`grid h-12 w-10 place-items-center rounded-md ${recordingKind === "video" ? "bg-[#c4314b] text-white" : "text-[#464775] hover:bg-[#ededfa]"}`} title="Video message">
                  {recordingKind === "video" ? <Square size={16} /> : <Video size={18} />}
                </button>
                <input
                  value={body}
                  onChange={(event) => {
                    setBody(event.target.value);
                    sendSocketPayload(chatSocket.current, { type: "typing", conversation_id: selected.id, is_typing: true });
                    if (typingTimer.current) window.clearTimeout(typingTimer.current);
                    typingTimer.current = window.setTimeout(() => {
                      sendSocketPayload(chatSocket.current, { type: "typing", conversation_id: selected.id, is_typing: false });
                    }, 900);
                  }}
                  className="min-w-0 flex-1 rounded-md border border-[#d1d1e0] bg-white px-4 py-3 outline-none focus:border-[#6264a7]"
                  placeholder={uploading ? "Uploading..." : recordingKind ? "Recording..." : "Type a new message"}
                  disabled={uploading}
                />
                <button className="grid h-12 w-12 place-items-center rounded-md bg-[#6264a7] text-white disabled:opacity-60" disabled={uploading || !body.trim()} title="Send"><Send size={18} /></button>
              </div>
            </form>
          </>
        ) : (
          <div className="grid h-full place-items-center p-6 text-center text-slate-500">Select a friend to start chatting.</div>
        )}
      </section>

      <aside className="hidden overflow-y-auto border-l border-[#ddddec] bg-[#f7f7fc] p-4 xl:block">
        <h2 className="font-semibold">Requests</h2>
        <div className="mt-3 space-y-2">
          {incomingRequests.map((request) => (
            <div key={request.id} className="flex items-center justify-between rounded-md border border-[#d1d1e0] bg-white p-3">
              <span className="flex min-w-0 items-center gap-2 text-sm">
                <span className="grid h-8 w-8 shrink-0 place-items-center overflow-hidden rounded-full bg-[#6264a7] font-semibold text-white">
                  {requestSenderAvatar(request) ? (
                    <img src={avatarSrc(requestSenderAvatar(request))} alt={requestSenderName(request)} className="h-full w-full object-cover" />
                  ) : (
                    requestSenderName(request).slice(0, 1).toUpperCase()
                  )}
                </span>
                <span className="truncate">{requestSenderName(request)}</span>
              </span>
              <span className="flex gap-2">
                <button onClick={() => acceptRequest(request.id)} className="grid h-8 w-8 place-items-center rounded-lg bg-emerald-600 text-white" title="Accept"><Check size={16} /></button>
                <button onClick={() => rejectRequest(request.id)} className="grid h-8 w-8 place-items-center rounded-lg bg-red-600 text-white" title="Reject"><X size={16} /></button>
              </span>
            </div>
          ))}
        </div>
        <h2 className="mt-6 font-semibold">Conversations</h2>
        <div className="mt-3 space-y-2">
          {conversations.map((conversation) => (
            <button key={conversation.id} onClick={() => selectConversation(conversation)} className="w-full rounded-md border border-[#d1d1e0] bg-white p-3 text-left text-sm hover:bg-[#ededfa]">
              <span className="block font-medium">{conversationTitle(conversation)}</span>
              <span className={`block truncate text-xs ${messageUnread(lastMessages[conversation.id], user?.id) ? "font-bold text-slate-900" : "text-slate-500"}`}>
                {messagePreview(lastMessages[conversation.id], user?.id)}
              </span>
            </button>
          ))}
        </div>
        <h2 className="mt-6 font-semibold">Call devices</h2>
        <div className="mt-3">{deviceControls}</div>
      </aside>
      {callPanel && (
        <div
          onPointerDown={startCallDrag}
          onPointerMove={moveCallDrag}
          onPointerUp={endCallDrag}
          onPointerCancel={endCallDrag}
          className={
            activeCall?.state === "ringing" && activeCall.callee_id === user?.id
              ? "fixed bottom-16 right-4 z-50 w-[calc(100vw-2rem)] max-w-[360px]"
              : callMinimized
              ? "fixed bottom-4 right-4 z-50 w-[calc(100vw-2rem)] max-w-[340px]"
              : "fixed inset-x-3 top-16 z-50 h-[calc(100dvh-5rem)] overflow-hidden sm:inset-x-8 lg:inset-x-[11vw] xl:inset-x-[12vw]"
          }
          style={{ transform: `translate(${callPosition.x}px, ${callPosition.y}px)` }}
        >
          {callPanel}
        </div>
      )}
      {showGroupModal && (
        <div className="fixed inset-0 z-[80] grid place-items-center bg-slate-950/50 px-4">
          <section className="w-full max-w-md rounded-lg bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-[#ddddec] px-4 py-3">
              <h2 className="font-semibold">Create group</h2>
              <button type="button" onClick={() => setShowGroupModal(false)} className="grid h-8 w-8 place-items-center rounded-md hover:bg-slate-100">
                <X size={18} />
              </button>
            </div>
            <div className="space-y-4 p-4">
              <input
                value={groupTitle}
                onChange={(event) => setGroupTitle(event.target.value)}
                className="w-full rounded-md border border-[#d1d1e0] px-3 py-2 outline-none focus:border-[#6264a7]"
                placeholder="Group name"
              />
              <div className="max-h-72 space-y-2 overflow-y-auto">
                {friends.map((friend) => (
                  <label key={friend.friendship_id} className="flex cursor-pointer items-center gap-3 rounded-md p-2 hover:bg-[#f5f5fb]">
                    <input
                      type="checkbox"
                      checked={groupMemberIds.includes(friend.user.id)}
                      onChange={() => toggleGroupMember(friend.user.id)}
                      className="accent-[#6264a7]"
                    />
                    <span className="grid h-9 w-9 place-items-center overflow-hidden rounded-full bg-[#6264a7] font-semibold text-white">
                      {friend.user.avatar ? <img src={avatarSrc(friend.user.avatar)} alt={friend.user.name} className="h-full w-full object-cover" /> : friend.user.name.slice(0, 1).toUpperCase()}
                    </span>
                    <span className="min-w-0 flex-1 truncate">{friend.user.name}</span>
                  </label>
                ))}
              </div>
              <button
                type="button"
                onClick={createGroup}
                disabled={!groupTitle.trim() || !groupMemberIds.length}
                className="w-full rounded-md bg-[#6264a7] py-2.5 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
              >
                Create group
              </button>
            </div>
          </section>
        </div>
      )}
      {messageMenu && (
        <div
          className="fixed z-[95] w-64 overflow-hidden rounded-md border border-[#ddddec] bg-white py-2 text-sm text-slate-700 shadow-2xl"
          style={{
            left: Math.min(messageMenu.x, window.innerWidth - 272),
            top: Math.min(messageMenu.y, window.innerHeight - 360)
          }}
          onPointerDown={(event) => event.stopPropagation()}
        >
          {[
            { label: "Reply", icon: <Reply size={17} />, action: () => { setReplyingTo(messageMenu.message); setMessageMenu(null); } },
            { label: "Forward", icon: <Forward size={17} />, action: () => { setReplyingTo(messageMenu.message); setMessageMenu(null); } },
            { label: "Copy text", icon: <Copy size={17} />, action: () => copyMessageText(messageMenu.message) },
            { label: "Copy link", icon: <LinkIcon size={17} />, action: () => copyMessageLink(messageMenu.message) },
            { label: "Edit", icon: <Edit3 size={17} />, action: () => { if (messageMenu.message.sender_id === user?.id && !messageMenu.message.deleted_for_everyone) setBody(messageMenu.message.body); setMessageMenu(null); } },
            { label: "Delete for me", icon: <Trash2 size={17} />, action: () => { deleteMessage(messageMenu.message, "me"); setMessageMenu(null); } },
            ...(messageMenu.message.sender_id === user?.id && !messageMenu.message.deleted_for_everyone
              ? [{ label: "Delete for everyone", icon: <Trash2 size={17} />, action: () => { deleteMessage(messageMenu.message, "everyone"); setMessageMenu(null); } }]
              : []),
            { label: "Pin", icon: <Pin size={17} />, action: () => pinMessage(messageMenu.message) },
            { label: "Mark as unread", icon: <Bell size={17} />, action: () => markMessageUnread(messageMenu.message) },
            { label: "Translation", icon: <Languages size={17} />, action: () => setMessageMenu(null) }
          ].map((item) => (
            <button key={item.label} type="button" onClick={item.action} className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-[#f5f5fb]">
              {item.icon}
              <span className="flex-1">{item.label}</span>
              {item.label === "Translation" && <ChevronDown size={15} className="-rotate-90" />}
            </button>
          ))}
          <div className="mt-1 flex items-center justify-between border-t border-[#eeeef7] px-3 pt-2 text-lg">
            {["👍", "❤️", "😂", "😮", "😢"].map((reaction) => (
              <button key={reaction} type="button" onClick={() => { setBody((value) => `${value}${reaction}`); setMessageMenu(null); }} className="grid h-8 w-8 place-items-center rounded-md hover:bg-[#f5f5fb]">
                {reaction}
              </button>
            ))}
          </div>
        </div>
      )}
      {recordingPreview && (
        <div className="fixed inset-0 z-[90] grid place-items-center bg-slate-950/60 px-4">
          <section className="w-full max-w-lg overflow-hidden rounded-lg bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-[#ddddec] px-4 py-3">
              <h2 className="font-semibold">
                {recordingKind
                  ? `Recording ${recordingPreview.kind === "audio" ? "voice" : "video"} message`
                  : `Preview ${recordingPreview.kind === "audio" ? "voice" : "video"} message`}
              </h2>
              <button onClick={discardRecordingPreview} className="grid h-8 w-8 place-items-center rounded-md hover:bg-slate-100" title="Close">
                <X size={18} />
              </button>
            </div>
            <div className={recordingPreview.kind === "audio" ? "bg-white p-5" : "bg-slate-950"}>
              {recordingPreview.kind === "audio" ? (
                <div className="rounded-md border border-[#ddddec] bg-[#f8f8fd] p-4">
                  <div className="mb-3 flex items-center gap-3 text-sm font-medium text-slate-700">
                    <span className="grid h-10 w-10 place-items-center rounded-full bg-[#6264a7] text-white">
                      <Mic size={18} />
                    </span>
                    Voice message
                  </div>
                  {recordingPreview.blob ? (
                    <audio src={recordingPreview.url} controls className="w-full" />
                  ) : (
                    <p className="text-sm text-slate-500">Recording audio...</p>
                  )}
                </div>
              ) : recordingPreview.stream ? (
                <div className="relative">
                  <video ref={recordingPreviewVideo} muted autoPlay playsInline className="aspect-video w-full object-cover" />
                  <button
                    type="button"
                    onClick={switchVideoMessageCamera}
                    className="absolute right-3 top-3 rounded-md bg-slate-950/70 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-900"
                  >
                    {videoMessageFacingMode === "user" ? "Back camera" : "Front camera"}
                  </button>
                </div>
              ) : (
                <video key={recordingPreview.url} src={recordingPreview.url} controls playsInline className="aspect-video w-full object-cover" />
              )}
            </div>
            <div className="flex flex-wrap justify-end gap-2 p-4">
              {recordingKind ? (
                <button onClick={() => recorder.current?.stop()} className="flex items-center gap-2 rounded-md bg-[#c4314b] px-4 py-2 font-medium text-white">
                  <Square size={16} />Stop recording
                </button>
              ) : (
                <>
                  <button onClick={discardRecordingPreview} className="rounded-md border border-slate-300 px-4 py-2 font-medium">
                    Delete
                  </button>
                  <button onClick={rerecordMessage} className="rounded-md border border-[#6264a7] px-4 py-2 font-medium text-[#464775]">
                    Re-record
                  </button>
                  <button onClick={sendRecordingPreview} className="rounded-md bg-[#6264a7] px-4 py-2 font-medium text-white">
                    Send {recordingPreview.kind === "audio" ? "voice" : "video"}
                  </button>
                </>
              )}
            </div>
          </section>
        </div>
      )}
    </main>
  );
}
