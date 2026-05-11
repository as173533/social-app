import { Check, MessageSquare, Mic, Phone, PhoneOff, Search, Send, SlidersHorizontal, Speaker, UserPlus, Users, Video, X } from "lucide-react";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { API_URL, WS_URL } from "../api/client";
import { chatApi, friendApi, userApi } from "../api/services";
import { useAuthStore } from "../stores/authStore";
import type { CallLog, Conversation, Friend, FriendRequest, Message, User } from "../types";
import { RingtonePlayer } from "../utils/ringtone";
import { WebRTCClient } from "../utils/webrtc";

type ChatEvent =
  | { type: "message"; message: Message }
  | { type: "typing"; conversation_id: number; user_id: number; is_typing: boolean }
  | { type: "read"; conversation_id: number; user_id: number; message_ids: number[] }
  | { type: "presence"; user_id: number; online: boolean };

type CallEvent =
  | { type: "call:ringing"; call: CallLog }
  | { type: "call:state"; call: CallLog }
  | { type: "webrtc:offer"; from_user_id: number; sdp: RTCSessionDescriptionInit }
  | { type: "webrtc:answer"; from_user_id: number; sdp: RTCSessionDescriptionInit }
  | { type: "webrtc:ice"; from_user_id: number; candidate: RTCIceCandidateInit };

function normalizeMessage(message: Message): Message {
  return { ...message, read_by: Array.isArray(message.read_by) ? message.read_by : [] };
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

function callEventText(body: string): string {
  const [, callType, action] = body.split(":");
  const label = callType === "video" ? "Video call" : "Audio call";
  return action === "start" ? `${label} started` : `${label} ended`;
}

function messagePreview(message?: Message, currentUserId?: number): string {
  if (!message) return "No messages yet";
  if (isCallEvent(message)) return callEventText(message.body);
  return `${message.sender_id === currentUserId ? "You: " : ""}${message.body}`;
}

function messageUnread(message: Message | undefined, currentUserId?: number): boolean {
  return Boolean(message && message.sender_id !== currentUserId && !includesNumber(message.read_by, currentUserId ?? 0));
}

export function MessengerPage() {
  const { user, accessToken } = useAuthStore();
  const [friends, setFriends] = useState<Friend[]>([]);
  const [requests, setRequests] = useState<FriendRequest[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [lastMessages, setLastMessages] = useState<Record<number, Message | undefined>>({});
  const [messages, setMessages] = useState<Message[]>([]);
  const [selected, setSelected] = useState<Conversation | null>(null);
  const [body, setBody] = useState("");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<User[]>([]);
  const [searchError, setSearchError] = useState("");
  const [activeView, setActiveView] = useState<"chat" | "people">("chat");
  const [showMobileDevices, setShowMobileDevices] = useState(false);
  const [typingUserId, setTypingUserId] = useState<number | null>(null);
  const [activeCall, setActiveCall] = useState<CallLog | null>(null);
  const [callError, setCallError] = useState("");
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
  const messagesContainer = useRef<HTMLDivElement | null>(null);
  const messagesEnd = useRef<HTMLDivElement | null>(null);
  const typingTimer = useRef<number | null>(null);

  const peer = selected?.peer ?? null;
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

  const loadAll = async () => {
    if (!accessToken) return;
    const [friendRows, requestRows, conversationRows] = await Promise.all([
      friendApi.list(),
      friendApi.requests(),
      chatApi.conversations()
    ]);
    setFriends(friendRows);
    setRequests(requestRows);
    setConversations(conversationRows);
    const lastEntries = await Promise.all(
      conversationRows.map(async (conversation) => {
        const items = await chatApi.messages(conversation.id).catch(() => []);
        return [conversation.id, items.length ? normalizeMessage(items[items.length - 1]) : undefined] as const;
      })
    );
    setLastMessages(Object.fromEntries(lastEntries));
  };

  const showChatView = () => {
    setActiveView("chat");
  };

  const showPeopleView = () => {
    setActiveView("people");
    setSelected(null);
    loadAll().catch(() => undefined);
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
          ? "No camera was found. Choose another camera or start an audio call."
          : "No microphone was found. Choose another microphone and try again.";
      }
      if (error.name === "NotAllowedError") {
        return "Browser permission is blocked. Allow camera/microphone access and try again.";
      }
    }
    return "Could not start the call. Check your selected devices and browser permissions.";
  };

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
    if (!accessToken) return;
    chatSocket.current = new WebSocket(`${WS_URL}/ws/chat?token=${accessToken}`);
    callSocket.current = new WebSocket(`${WS_URL}/ws/call?token=${accessToken}`);
    rtc.current = new WebRTCClient(
      (payload) => callSocket.current?.send(JSON.stringify(payload)),
      (stream) => setRemoteStream(stream)
    );

    chatSocket.current.onmessage = (event) => {
      const payload = JSON.parse(event.data) as ChatEvent;
      if (payload.type === "message") {
        const nextMessage = normalizeMessage(payload.message);
        setMessages((current) =>
          current.some((message) => message.id === nextMessage.id) ? current : [...current, nextMessage]
        );
        setLastMessages((current) => ({ ...current, [nextMessage.conversation_id]: nextMessage }));
        loadAll().catch(() => undefined);
        scrollMessagesToBottom();
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

    callSocket.current.onmessage = async (event) => {
      const payload = JSON.parse(event.data) as CallEvent;
      if (payload.type === "call:ringing" || payload.type === "call:state") {
        const callFinished = payload.call.state === "ended" || payload.call.state === "rejected" || payload.call.state === "missed";
        setActiveCall(callFinished ? null : payload.call);
        if (callFinished) {
          ringtone.current.stop();
          rtc.current?.close();
          setLocalStream(null);
          setRemoteStream(null);
          setPendingOffer(null);
        }
        const isIncomingRinging = payload.call.state === "ringing" && payload.call.callee_id === user?.id;
        if (isIncomingRinging) {
          ringtone.current
            .setOutputDevice(audioOutputId)
            .then(() => ringtone.current.start())
            .catch(() => setCallError("Incoming call sound is blocked. Click Enable call sound once."));
        } else {
          ringtone.current.stop();
        }
      }
      if (payload.type === "webrtc:offer") {
        setPendingOffer({ fromUserId: payload.from_user_id, sdp: payload.sdp });
      }
      if (payload.type === "webrtc:answer") {
        await rtc.current?.acceptAnswer(payload.sdp);
      }
      if (payload.type === "webrtc:ice") {
        await rtc.current?.addIce(payload.candidate);
      }
    };

    return () => {
      chatSocket.current?.close();
      callSocket.current?.close();
      ringtone.current.stop();
      rtc.current?.close();
    };
  }, [accessToken, user?.id, audioOutputId]);

  useEffect(() => {
    if (selected) {
      chatApi.messages(selected.id).then((items) => setMessages(items.map(normalizeMessage)));
    }
  }, [selected]);

  useEffect(() => {
    scrollMessagesToBottom();
  }, [messages.length, selected?.id]);

  useEffect(() => {
    if (!selected || !user) return;
    const unreadPeerMessages = messages
      .filter((message) => message.sender_id !== user.id && !includesNumber(message.read_by, user.id))
      .map((message) => message.id);
    if (unreadPeerMessages.length) {
      chatSocket.current?.send(JSON.stringify({ type: "read", conversation_id: selected.id, message_ids: unreadPeerMessages }));
    }
  }, [messages, selected, user]);

  useEffect(() => {
    if (localVideo.current && localStream) localVideo.current.srcObject = localStream;
    if (remoteVideo.current && remoteStream) remoteVideo.current.srcObject = remoteStream;
    if (remoteStream) {
      scrollMessagesToBottom("auto");
    }
  }, [localStream, remoteStream, activeCall?.state, activeCall?.call_type]);

  useEffect(() => {
    const applyOutput = async () => {
      const remote = remoteVideo.current as HTMLVideoElement & { setSinkId?: (sinkId: string) => Promise<void> };
      const local = localVideo.current as HTMLVideoElement & { setSinkId?: (sinkId: string) => Promise<void> };
      if (remote?.setSinkId) await remote.setSinkId(audioOutputId || "");
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
    setActiveView("chat");
    setSelected(merged);
    setConversations((current) => [merged, ...current.filter((item) => item.id !== merged.id)]);
  };

  const sendMessage = async (event: FormEvent) => {
    event.preventDefault();
    if (!selected || !body.trim()) return;
    chatSocket.current?.send(JSON.stringify({ type: "message", conversation_id: selected.id, body }));
    setBody("");
    scrollMessagesToBottom();
  };

  const sendCallEventMessage = (callType: "audio" | "video", action: "start" | "end") => {
    if (!selected) return;
    chatSocket.current?.send(
      JSON.stringify({ type: "message", conversation_id: selected.id, body: `__call__:${callType}:${action}` })
    );
  };

  const startCall = async (callType: "audio" | "video") => {
    if (!peer) return;
    setCallError("");
    try {
      await loadDevices();
      const stream = await rtc.current?.startLocal(callType === "video", { audioInputId, videoInputId });
      if (stream) setLocalStream(stream);
      callSocket.current?.send(JSON.stringify({ type: "call:start", callee_id: peer.id, call_type: callType }));
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
      if (state === "ended") {
        sendCallEventMessage(activeCall.call_type, "end");
      }
      ringtone.current.stop();
      rtc.current?.close();
      setLocalStream(null);
      setRemoteStream(null);
      setPendingOffer(null);
      callSocket.current?.send(JSON.stringify({ type: "call:state", call_id: activeCall.id, state }));
    }
    if (state === "accepted" && peerId) {
      setCallError("");
      try {
        ringtone.current.stop();
        await loadDevices();
        const wantsVideo = activeCall.call_type === "video";
        const stream = await rtc.current?.startLocal(wantsVideo, { audioInputId, videoInputId });
        if (stream) setLocalStream(stream);
        if (pendingOffer) {
          await rtc.current?.acceptOffer(pendingOffer.fromUserId, pendingOffer.sdp);
          setPendingOffer(null);
        } else {
          rtc.current?.ensurePeer(peerId);
        }
        callSocket.current?.send(JSON.stringify({ type: "call:state", call_id: activeCall.id, state }));
      } catch (error) {
        setCallError(mediaErrorMessage(error, activeCall.call_type));
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
    <div className="rounded-lg border border-[#d1d1e0] bg-white p-3 shadow-2xl shadow-slate-900/20">
      <div className="flex items-center gap-3">
        <div className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-[#6264a7] font-semibold text-white">
          {(friends.find((friend) => friend.user.id === (activeCall.caller_id === user?.id ? activeCall.callee_id : activeCall.caller_id))?.user.name ?? "C").slice(0, 1).toUpperCase()}
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="truncate font-semibold">
            {friends.find((friend) => friend.user.id === (activeCall.caller_id === user?.id ? activeCall.callee_id : activeCall.caller_id))?.user.name ?? "Call"}
          </h2>
          <p className="text-sm text-slate-500">
            {activeCall.state === "ringing" && activeCall.callee_id === user?.id
              ? `Incoming ${activeCall.call_type} call`
              : activeCall.state === "ringing"
                ? `Calling ${activeCall.call_type}...`
                : activeCall.state === "accepted"
                  ? `${activeCall.call_type} call ongoing`
                  : activeCall.state}
          </p>
        </div>
        <span className="rounded-md bg-[#ededfa] px-2.5 py-1 text-xs font-semibold capitalize text-[#464775]">
          {activeCall.state}
        </span>
      </div>
      {activeCall.state === "accepted" && activeCall.call_type === "video" && (
        <div className="mt-3 grid grid-cols-2 gap-2">
          <video ref={localVideo} muted autoPlay playsInline className="aspect-video min-h-16 rounded-md bg-slate-950 object-cover" />
          <video ref={remoteVideo} autoPlay playsInline className="aspect-video min-h-16 rounded-md bg-slate-950 object-cover" />
        </div>
      )}
      {activeCall.call_type === "audio" && (
        <div className="hidden">
          <video ref={localVideo} muted autoPlay playsInline />
          <video ref={remoteVideo} autoPlay playsInline />
        </div>
      )}
      <div className="mt-3 flex gap-2">
        {activeCall.state === "ringing" && activeCall.callee_id === user?.id && (
          <button onClick={() => setCallState("accepted")} className="flex flex-1 items-center justify-center gap-2 rounded-md bg-[#13a10e] py-2.5 font-medium text-white">
            <Phone size={16} />Accept
          </button>
        )}
        <button onClick={() => setCallState(activeCall.state === "ringing" ? "rejected" : "ended")} className="flex flex-1 items-center justify-center gap-2 rounded-md bg-[#c4314b] py-2.5 font-medium text-white">
          <PhoneOff size={16} />{activeCall.state === "ringing" && activeCall.callee_id === user?.id ? "Reject" : "End"}
        </button>
      </div>
    </div>
  ) : null;

  return (
    <main className="relative grid h-[calc(100dvh-3.5rem)] grid-cols-1 overflow-hidden bg-[#f5f5fb] md:grid-cols-[64px_300px_minmax(0,1fr)] xl:grid-cols-[64px_310px_minmax(0,1fr)_320px]">
      <nav className="hidden border-r border-[#ddddec] bg-[#ebebf5] py-3 md:flex md:flex-col md:items-center md:gap-2">
        <button
          onClick={showChatView}
          className={`grid h-12 w-12 place-items-center rounded-md ${activeView === "chat" ? "bg-[#6264a7] text-white" : "text-[#464775] hover:bg-white"}`}
          title="Chat"
        >
          <MessageSquare size={21} />
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
          <h2 className="text-xl font-semibold tracking-tight">{activeView === "chat" ? "Chat" : "People"}</h2>
          <span className="grid h-9 w-9 place-items-center rounded-md bg-white text-[#464775] shadow-sm">
            {activeView === "chat" ? <MessageSquare size={17} /> : <UserPlus size={17} />}
          </span>
        </div>
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
        <h2 className="mt-6 px-1 text-sm font-semibold text-slate-500">{activeView === "chat" ? "Friends" : "Your Friends"}</h2>
        <div className="mt-3 space-y-2">
          {friends.map((friend) => {
            const conversation = conversations.find((item) => item.peer?.id === friend.user.id || item.user1_id === friend.user.id || item.user2_id === friend.user.id);
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
        ) : selected && peer ? (
          <>
            <div className="flex items-center justify-between border-b border-[#ddddec] bg-white px-3 py-2 sm:px-4">
              <div className="min-w-0">
                <h2 className="font-semibold">{peer.name}</h2>
                <p className="truncate text-xs text-slate-500">{callError || (typingUserId === peer.id ? "Typing..." : peer.online ? "Online" : "Offline")}</p>
              </div>
              <div className="flex shrink-0 gap-1 sm:gap-2">
                <button onClick={() => startCall("audio")} className="grid h-9 w-9 place-items-center rounded-md text-[#464775] hover:bg-[#ededfa]" title="Audio call"><Phone size={18} /></button>
                <button onClick={() => startCall("video")} className="grid h-9 w-9 place-items-center rounded-md text-[#464775] hover:bg-[#ededfa]" title="Video call"><Video size={18} /></button>
                <button onClick={() => setShowMobileDevices((value) => !value)} className="grid h-9 w-9 place-items-center rounded-md text-[#464775] hover:bg-[#ededfa] xl:hidden" title="Call devices"><SlidersHorizontal size={18} /></button>
              </div>
            </div>
            {showMobileDevices && (
              <div className="max-h-[42dvh] overflow-y-auto border-b border-[#ddddec] bg-[#f7f7fc] p-3 xl:hidden">
                {deviceControls}
              </div>
            )}
            <div ref={messagesContainer} className="flex-1 space-y-3 overflow-y-auto bg-[#f5f5fb] p-4">
              {messages.map((rawMessage) => {
                const message = normalizeMessage(rawMessage);
                if (isCallEvent(message)) {
                  return (
                    <div key={message.id} className="flex justify-center">
                      <span className="rounded-md bg-white px-3 py-1.5 text-xs font-medium text-slate-600 shadow-sm">
                        {callEventText(message.body)}
                      </span>
                    </div>
                  );
                }
                const mine = message.sender_id === user?.id;
                return (
                  <div key={message.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                    <div className={`max-w-[78%] rounded-md px-3.5 py-2 text-sm shadow-sm ${mine ? "bg-[#6264a7] text-white" : "bg-white text-slate-900"}`}>
                      <p>{message.body}</p>
                      <p className={`mt-1 text-[11px] ${mine ? "text-blue-100" : "text-slate-400"}`}>{mine && includesNumber(message.read_by, peer.id) ? "Read" : "Sent"}</p>
                    </div>
                  </div>
                );
              })}
              <div ref={messagesEnd} />
            </div>
            <form onSubmit={sendMessage} className="flex gap-2 border-t border-[#ddddec] bg-white p-3 sm:p-4">
              <input
                value={body}
                onChange={(event) => {
                  setBody(event.target.value);
                  chatSocket.current?.send(JSON.stringify({ type: "typing", conversation_id: selected.id, is_typing: true }));
                  if (typingTimer.current) window.clearTimeout(typingTimer.current);
                  typingTimer.current = window.setTimeout(() => {
                    chatSocket.current?.send(JSON.stringify({ type: "typing", conversation_id: selected.id, is_typing: false }));
                  }, 900);
                }}
                className="min-w-0 flex-1 rounded-md border border-[#d1d1e0] bg-white px-4 py-3 outline-none focus:border-[#6264a7]"
                placeholder="Type a new message"
              />
              <button className="grid h-12 w-12 place-items-center rounded-md bg-[#6264a7] text-white" title="Send"><Send size={18} /></button>
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
            <button key={conversation.id} onClick={() => setSelected(conversation)} className="w-full rounded-md border border-[#d1d1e0] bg-white p-3 text-left text-sm hover:bg-[#ededfa]">
              <span className="block font-medium">{conversation.peer?.name ?? `Conversation ${conversation.id}`}</span>
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
        <div className="fixed right-4 top-20 z-50 w-[calc(100vw-2rem)] max-w-[380px] overflow-y-auto">
          {callPanel}
        </div>
      )}
    </main>
  );
}
