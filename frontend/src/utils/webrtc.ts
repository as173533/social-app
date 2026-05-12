export type SignalSender = (payload: Record<string, unknown>) => void;

export type MediaDeviceSelection = {
  audioInputId?: string;
  videoInputId?: string;
};

export class WebRTCClient {
  private peer: RTCPeerConnection | null = null;
  private localStream: MediaStream | null = null;
  private pendingIceCandidates: RTCIceCandidateInit[] = [];

  constructor(
    private readonly sendSignal: SignalSender,
    private readonly onRemoteStream: (stream: MediaStream) => void
  ) {}

  async startLocal(video: boolean, devices: MediaDeviceSelection = {}): Promise<MediaStream> {
    this.localStream?.getTracks().forEach((track) => track.stop());
    const constraints: MediaStreamConstraints = {
      audio: devices.audioInputId ? { deviceId: { exact: devices.audioInputId } } : true,
      video: video ? (devices.videoInputId ? { deviceId: { exact: devices.videoInputId } } : true) : false
    };
    try {
      this.localStream = await navigator.mediaDevices.getUserMedia(constraints);
    } catch (error) {
      if (video && error instanceof DOMException && error.name === "NotFoundError") {
        this.localStream = await navigator.mediaDevices.getUserMedia({ audio: constraints.audio, video: false });
      } else {
        throw error;
      }
    }
    if (this.peer) {
      const senders = this.peer.getSenders();
      for (const track of this.localStream.getTracks()) {
        const sender = senders.find((item) => item.track?.kind === track.kind);
        if (sender) {
          await sender.replaceTrack(track);
        } else {
          this.peer.addTrack(track, this.localStream);
        }
      }
    }
    return this.localStream;
  }

  async startScreenShare(): Promise<MediaStream> {
    const displayStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
    const screenTrack = displayStream.getVideoTracks()[0];
    if (!screenTrack) {
      throw new Error("Screen share did not provide a video track");
    }
    if (this.peer) {
      const sender = this.peer.getSenders().find((item) => item.track?.kind === "video");
      if (sender) {
        await sender.replaceTrack(screenTrack);
      } else {
        this.peer.addTrack(screenTrack, displayStream);
      }
    }
    return displayStream;
  }

  ensurePeer(peerId: number): RTCPeerConnection {
    if (this.peer) {
      return this.peer;
    }
    this.peer = new RTCPeerConnection({
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
    });
    this.peer.onicecandidate = (event) => {
      if (event.candidate) {
        this.sendSignal({ type: "webrtc:ice", peer_id: peerId, candidate: event.candidate });
      }
    };
    this.peer.ontrack = (event) => {
      this.onRemoteStream(event.streams[0]);
    };
    this.localStream?.getTracks().forEach((track) => this.peer?.addTrack(track, this.localStream!));
    return this.peer;
  }

  async createOffer(peerId: number) {
    const peer = this.ensurePeer(peerId);
    const offer = await peer.createOffer();
    await peer.setLocalDescription(offer);
    this.sendSignal({ type: "webrtc:offer", peer_id: peerId, sdp: offer });
  }

  async acceptOffer(peerId: number, offer: RTCSessionDescriptionInit) {
    const peer = this.ensurePeer(peerId);
    await peer.setRemoteDescription(offer);
    await this.flushPendingIceCandidates();
    const answer = await peer.createAnswer();
    await peer.setLocalDescription(answer);
    this.sendSignal({ type: "webrtc:answer", peer_id: peerId, sdp: answer });
  }

  async acceptAnswer(answer: RTCSessionDescriptionInit) {
    if (!this.peer) return;
    await this.peer.setRemoteDescription(answer);
    await this.flushPendingIceCandidates();
  }

  async addIce(candidate: RTCIceCandidateInit) {
    if (!this.peer || !this.peer.remoteDescription) {
      this.pendingIceCandidates.push(candidate);
      return;
    }
    await this.peer.addIceCandidate(candidate);
  }

  private async flushPendingIceCandidates() {
    if (!this.peer || !this.peer.remoteDescription) return;
    const candidates = [...this.pendingIceCandidates];
    this.pendingIceCandidates = [];
    for (const candidate of candidates) {
      await this.peer.addIceCandidate(candidate);
    }
  }

  close() {
    this.peer?.close();
    this.peer = null;
    this.localStream?.getTracks().forEach((track) => track.stop());
    this.localStream = null;
    this.pendingIceCandidates = [];
  }
}
