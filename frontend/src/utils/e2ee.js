const E2EE_PREFIX = "e2ee:v1:";
const STORAGE_PREFIX = "chatMessengerE2EE";
const encoder = new TextEncoder();
const decoder = new TextDecoder();

function browserCrypto() {
    return window.crypto?.subtle ? window.crypto : null;
}

function storageKey(userId, name) {
    return `${STORAGE_PREFIX}:${userId}:${name}`;
}

function bytesToBase64(bytes) {
    let binary = "";
    for (const byte of bytes) {
        binary += String.fromCharCode(byte);
    }
    return btoa(binary);
}

function base64ToBytes(value) {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
        bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
}

function jsonToBytes(value) {
    return encoder.encode(JSON.stringify(value));
}

function bytesToJson(bytes) {
    return JSON.parse(decoder.decode(bytes));
}

async function exportJwk(key) {
    return window.crypto.subtle.exportKey("jwk", key);
}

async function importPrivateKey(jwk) {
    return window.crypto.subtle.importKey("jwk", jwk, { name: "ECDH", namedCurve: "P-256" }, false, ["deriveKey"]);
}

async function importPublicKey(jwk) {
    return window.crypto.subtle.importKey("jwk", jwk, { name: "ECDH", namedCurve: "P-256" }, false, []);
}

async function importAesKey(rawBytes, usages = ["encrypt", "decrypt"]) {
    return window.crypto.subtle.importKey("raw", rawBytes, { name: "AES-GCM", length: 256 }, false, usages);
}

async function generateIdentity() {
    const keyPair = await window.crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveKey"]);
    const privateKey = await exportJwk(keyPair.privateKey);
    const publicKey = await exportJwk(keyPair.publicKey);
    return { privateKey, publicKey };
}

function readStoredIdentity(userId) {
    const privateValue = localStorage.getItem(storageKey(userId, "privateKey"));
    const publicValue = localStorage.getItem(storageKey(userId, "publicKey"));
    if (!privateValue || !publicValue)
        return null;
    try {
        return { privateKey: JSON.parse(privateValue), publicKey: JSON.parse(publicValue) };
    }
    catch {
        return null;
    }
}

function writeStoredIdentity(userId, identity) {
    localStorage.setItem(storageKey(userId, "privateKey"), JSON.stringify(identity.privateKey));
    localStorage.setItem(storageKey(userId, "publicKey"), JSON.stringify(identity.publicKey));
}

function publicKeyString(publicKey) {
    return JSON.stringify(publicKey);
}

function parsePublicKey(value) {
    if (!value)
        return null;
    try {
        return typeof value === "string" ? JSON.parse(value) : value;
    }
    catch {
        return null;
    }
}

async function getIdentity(user) {
    if (!browserCrypto() || !user?.id)
        return null;
    const existing = readStoredIdentity(user.id);
    if (existing)
        return existing;
    const identity = await generateIdentity();
    writeStoredIdentity(user.id, identity);
    return identity;
}

async function derivePeerKey(privateJwk, publicJwk) {
    const privateKey = await importPrivateKey(privateJwk);
    const publicKey = await importPublicKey(publicJwk);
    return window.crypto.subtle.deriveKey(
        { name: "ECDH", public: publicKey },
        privateKey,
        { name: "AES-GCM", length: 256 },
        false,
        ["encrypt", "decrypt"]
    );
}

async function encryptBytes(key, bytes) {
    const iv = window.crypto.getRandomValues(new Uint8Array(12));
    const data = await window.crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, bytes);
    return { iv: bytesToBase64(iv), data: bytesToBase64(new Uint8Array(data)) };
}

async function decryptBytes(key, encrypted) {
    const bytes = await window.crypto.subtle.decrypt(
        { name: "AES-GCM", iv: base64ToBytes(encrypted.iv) },
        key,
        base64ToBytes(encrypted.data)
    );
    return new Uint8Array(bytes);
}

function conversationParticipants(conversation, user) {
    const map = new Map();
    if (user?.id)
        map.set(Number(user.id), user);
    if (conversation?.peer?.id)
        map.set(Number(conversation.peer.id), conversation.peer);
    if (Array.isArray(conversation?.members)) {
        conversation.members.forEach((member) => {
            if (member?.id)
                map.set(Number(member.id), member);
        });
    }
    return [...map.values()];
}

export function isEncryptedBody(body) {
    return typeof body === "string" && body.startsWith(E2EE_PREFIX);
}

export async function ensureE2EEIdentity(user, updatePublicKey) {
    if (!user?.id || !browserCrypto())
        return null;
    const identity = await getIdentity(user);
    const publicValue = publicKeyString(identity.publicKey);
    if (user.e2ee_public_key !== publicValue) {
        return updatePublicKey(publicValue);
    }
    return user;
}

export async function encryptOutgoingMessage(conversation, user, payload) {
    if (!payload?.body && !payload?.attachment_url)
        return payload;
    if (String(payload.body ?? "").startsWith("__call__:"))
        return payload;
    if (!browserCrypto() || !user?.id)
        return payload;
    const identity = await getIdentity(user);
    const senderPublic = identity.publicKey;
    const participants = conversationParticipants(conversation, { ...user, e2ee_public_key: publicKeyString(senderPublic) })
        .map((participant) => Number(participant.id) === Number(user.id) ? { ...participant, e2ee_public_key: publicKeyString(senderPublic) } : participant);
    const missingKeys = participants.filter((participant) => !parsePublicKey(participant.e2ee_public_key));
    if (missingKeys.length) {
        throw new Error("A conversation participant has not published an encryption key yet.");
    }
    const recipients = {};
    const messageKeyBytes = window.crypto.getRandomValues(new Uint8Array(32));
    const messageKey = await importAesKey(messageKeyBytes);
    const encryptedPayload = await encryptBytes(messageKey, jsonToBytes({
        body: payload.body ?? "",
        message_type: payload.message_type ?? "text",
        attachment_name: payload.attachment_name ?? null,
        attachment_mime: payload.attachment_mime ?? null,
        attachment_size: payload.attachment_size ?? null
    }));
    await Promise.all(participants.map(async (participant) => {
        const peerPublic = parsePublicKey(participant.e2ee_public_key);
        if (!peerPublic)
            return;
        const pairKey = await derivePeerKey(identity.privateKey, peerPublic);
        recipients[String(participant.id)] = await encryptBytes(pairKey, messageKeyBytes);
    }));
    if (!recipients[String(user.id)]) {
        const pairKey = await derivePeerKey(identity.privateKey, senderPublic);
        recipients[String(user.id)] = await encryptBytes(pairKey, messageKeyBytes);
    }
    const envelope = {
        v: 1,
        alg: "ECDH-P256+A256GCM",
        sender_public_key: senderPublic,
        recipients,
        payload: encryptedPayload
    };
    return {
        ...payload,
        body: `${E2EE_PREFIX}${JSON.stringify(envelope)}`,
        attachment_name: payload.attachment_url ? "Encrypted attachment" : payload.attachment_name ?? null,
        attachment_mime: payload.attachment_url ? "application/octet-stream" : payload.attachment_mime ?? null
    };
}

export async function decryptIncomingMessage(message, user) {
    if (!isEncryptedBody(message?.body) || !browserCrypto() || !user?.id)
        return null;
    const identity = readStoredIdentity(user.id);
    if (!identity)
        return {
            ...message,
            body: "Encrypted message. Import your recovery key on this device to read it.",
            message_type: "text",
            attachment_name: null,
            attachment_mime: null,
            attachment_size: null,
            e2ee_failed: true
        };
    try {
        const envelope = JSON.parse(message.body.slice(E2EE_PREFIX.length));
        const recipient = envelope.recipients?.[String(user.id)];
        if (!recipient)
            throw new Error("Missing recipient key");
        const pairKey = await derivePeerKey(identity.privateKey, envelope.sender_public_key);
        const messageKeyBytes = await decryptBytes(pairKey, recipient);
        const messageKey = await importAesKey(messageKeyBytes);
        const decrypted = bytesToJson(await decryptBytes(messageKey, envelope.payload));
        return {
            ...message,
            body: decrypted.body ?? "",
            message_type: decrypted.message_type ?? message.message_type,
            attachment_name: decrypted.attachment_name ?? message.attachment_name,
            attachment_mime: decrypted.attachment_mime ?? message.attachment_mime,
            attachment_size: decrypted.attachment_size ?? message.attachment_size,
            e2ee_decrypted: true
        };
    }
    catch {
        return {
            ...message,
            body: "Encrypted message could not be decrypted on this device.",
            message_type: "text",
            attachment_name: null,
            attachment_mime: null,
            attachment_size: null,
            e2ee_failed: true
        };
    }
}

export async function exportE2EERecoveryKey(user) {
    if (!user?.id)
        throw new Error("Missing user");
    const identity = await getIdentity(user);
    const bundle = {
        version: 1,
        user_id: user.id,
        exported_at: new Date().toISOString(),
        private_key: identity.privateKey,
        public_key: identity.publicKey
    };
    const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `chat-messenger-recovery-${user.id}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
}

export async function importE2EERecoveryKey(user, file, updatePublicKey) {
    if (!user?.id || !file)
        return null;
    const bundle = JSON.parse(await file.text());
    if (Number(bundle.user_id) !== Number(user.id) || !bundle.private_key || !bundle.public_key) {
        throw new Error("Recovery key does not match this account.");
    }
    await importPrivateKey(bundle.private_key);
    await importPublicKey(bundle.public_key);
    const identity = { privateKey: bundle.private_key, publicKey: bundle.public_key };
    writeStoredIdentity(user.id, identity);
    return updatePublicKey(publicKeyString(identity.publicKey));
}
