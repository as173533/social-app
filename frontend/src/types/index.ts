export type User = {
  id: number;
  name: string;
  email: string;
  phone: string;
  avatar?: string | null;
  bio?: string | null;
  created_at: string;
  online?: boolean;
};

export type AuthResponse = {
  access_token: string;
  refresh_token: string;
  token_type: string;
  user: User;
};

export type FriendRequest = {
  id: number;
  sender_id: number;
  receiver_id: number;
  status: "pending" | "accepted" | "rejected";
  created_at: string;
  responded_at?: string | null;
  sender?: User | null;
  receiver?: User | null;
};

export type Friend = {
  friendship_id: number;
  user: User;
};

export type Conversation = {
  id: number;
  user1_id: number;
  user2_id: number;
  created_at: string;
  peer?: User | null;
};

export type Message = {
  id: number;
  conversation_id: number;
  sender_id: number;
  body: string;
  created_at: string;
  read_by: number[];
};

export type CallLog = {
  id: number;
  caller_id: number;
  callee_id: number;
  call_type: "audio" | "video";
  state: "ringing" | "accepted" | "rejected" | "ended" | "missed";
  started_at: string;
  answered_at?: string | null;
  ended_at?: string | null;
};
