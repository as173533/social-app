const rtcConfiguration = {
    bundlePolicy: "max-bundle",
    iceCandidatePoolSize: 4,
    iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:stun1.l.google.com:19302" },
        { urls: "stun:stun2.l.google.com:19302" }
    ]
};
export class WebRTCClient {
    constructor(sendSignal, onRemoteStream) {
        Object.defineProperty(this, "sendSignal", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: sendSignal
        });
        Object.defineProperty(this, "onRemoteStream", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: onRemoteStream
        });
        Object.defineProperty(this, "peer", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: null
        });
        Object.defineProperty(this, "localStream", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: null
        });
        Object.defineProperty(this, "pendingIceCandidates", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: []
        });
        Object.defineProperty(this, "currentPeerId", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: null
        });
    }
    async startLocal(video, devices = {}) {
        this.localStream?.getTracks().forEach((track) => track.stop());
        const audioConstraints = devices.audioInputId
            ? { deviceId: { exact: devices.audioInputId }, echoCancellation: true, noiseSuppression: true, autoGainControl: true }
            : { echoCancellation: true, noiseSuppression: true, autoGainControl: true };
        const videoConstraints = {
            ...(devices.videoInputId ? { deviceId: { exact: devices.videoInputId } } : {}),
            width: { ideal: 640, max: 1280 },
            height: { ideal: 360, max: 720 },
            frameRate: { ideal: 24, max: 30 }
        };
        const constraints = {
            audio: devices.audioInputId
                ? audioConstraints
                : audioConstraints,
            video: video ? videoConstraints : false
        };
        try {
            this.localStream = await navigator.mediaDevices.getUserMedia(constraints);
        }
        catch (error) {
            if (video) {
                try {
                    this.localStream = await navigator.mediaDevices.getUserMedia({ audio: false, video: videoConstraints });
                }
                catch {
                    this.localStream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints, video: false });
                }
            }
            else {
                throw error;
            }
        }
        if (this.peer) {
            const senders = this.peer.getSenders();
            for (const track of this.localStream.getTracks()) {
                if (track.kind === "video") {
                    track.contentHint = "motion";
                }
                const sender = senders.find((item) => item.track?.kind === track.kind);
                if (sender) {
                    await sender.replaceTrack(track);
                    await this.tuneSender(sender);
                }
                else {
                    const nextSender = this.peer.addTrack(track, this.localStream);
                    await this.tuneSender(nextSender);
                }
            }
        }
        return this.localStream;
    }
    async startScreenShare() {
        const displayStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
        const screenTrack = displayStream.getVideoTracks()[0];
        if (!screenTrack) {
            throw new Error("Screen share did not provide a video track");
        }
        if (this.peer) {
            const sender = this.peer.getSenders().find((item) => item.track?.kind === "video");
            if (sender) {
                await sender.replaceTrack(screenTrack);
            }
            else {
                this.peer.addTrack(screenTrack, displayStream);
            }
        }
        return displayStream;
    }
    setAudioEnabled(enabled) {
        this.localStream?.getAudioTracks().forEach((track) => {
            track.enabled = enabled;
        });
    }
    setVideoEnabled(enabled) {
        this.localStream?.getVideoTracks().forEach((track) => {
            track.enabled = enabled;
        });
    }
    ensurePeer(peerId) {
        this.currentPeerId = peerId;
        if (this.peer) {
            return this.peer;
        }
        this.peer = new RTCPeerConnection(rtcConfiguration);
        this.peer.onicecandidate = (event) => {
            if (event.candidate) {
                this.sendSignal({ type: "webrtc:ice", peer_id: peerId, candidate: event.candidate });
            }
        };
        this.peer.oniceconnectionstatechange = () => {
            if (!this.peer || !this.currentPeerId)
                return;
            if (this.peer.iceConnectionState === "failed") {
                this.peer.restartIce();
                this.createOffer(this.currentPeerId, true).catch(() => undefined);
            }
        };
        this.peer.ontrack = (event) => {
            this.onRemoteStream(event.streams[0]);
        };
        this.localStream?.getTracks().forEach((track) => {
            if (track.kind === "video") {
                track.contentHint = "motion";
            }
            const sender = this.peer?.addTrack(track, this.localStream);
            if (sender)
                this.tuneSender(sender).catch(() => undefined);
        });
        return this.peer;
    }
    async tuneSender(sender) {
        if (sender.track?.kind !== "video")
            return;
        const parameters = sender.getParameters();
        parameters.encodings = parameters.encodings?.length ? parameters.encodings : [{}];
        parameters.encodings[0] = {
            ...parameters.encodings[0],
            maxBitrate: 900000,
            maxFramerate: 24,
            scaleResolutionDownBy: 1
        };
        await sender.setParameters(parameters);
    }
    async createOffer(peerId, iceRestart = false) {
        const peer = this.ensurePeer(peerId);
        const offer = await peer.createOffer({ iceRestart });
        await peer.setLocalDescription(offer);
        this.sendSignal({ type: "webrtc:offer", peer_id: peerId, sdp: offer });
    }
    async acceptOffer(peerId, offer) {
        const peer = this.ensurePeer(peerId);
        await peer.setRemoteDescription(offer);
        await this.flushPendingIceCandidates();
        const answer = await peer.createAnswer();
        await peer.setLocalDescription(answer);
        this.sendSignal({ type: "webrtc:answer", peer_id: peerId, sdp: answer });
    }
    async acceptAnswer(answer) {
        if (!this.peer)
            return;
        await this.peer.setRemoteDescription(answer);
        await this.flushPendingIceCandidates();
    }
    async addIce(candidate) {
        if (!this.peer || !this.peer.remoteDescription) {
            this.pendingIceCandidates.push(candidate);
            return;
        }
        await this.peer.addIceCandidate(candidate);
    }
    async flushPendingIceCandidates() {
        if (!this.peer || !this.peer.remoteDescription)
            return;
        const candidates = [...this.pendingIceCandidates];
        this.pendingIceCandidates = [];
        for (const candidate of candidates) {
            await this.peer.addIceCandidate(candidate);
        }
    }
    close() {
        this.peer?.close();
        this.peer = null;
        this.currentPeerId = null;
        this.localStream?.getTracks().forEach((track) => track.stop());
        this.localStream = null;
        this.pendingIceCandidates = [];
    }
}
