export type Role = "student" | "teacher" | "moderator" | "admin";
export type MemberRole = "owner" | "manager" | "member";
export type ChatKind = "self" | "dm" | "group";
export type MessageKind = "text" | "sticker" | "image" | "ai";
export type AiTag = "bot" | "likely_ai" | "self_tagged";

export type Settings = {
  theme?: string;
  accent?: string;
  font?: string;
  font_size?: number;
  compact?: boolean;
  enter_to_send?: boolean;
  show_ai_tags?: boolean;
  sounds?: boolean;
  custom_css?: string;
};

export type Profile = {
  id: string;
  email: string;
  name: string;
  avatar_url: string | null;
  role: Role;
  settings: Settings;
  created_at: string;
};

export type Person = Pick<Profile, "id" | "email" | "name" | "avatar_url" | "role">;

export type Member = Person & {
  member_role: MemberRole;
  last_read_at: string;
};

export type HomeChat = {
  chat_id: string;
  name: string | null;
  kind: ChatKind;
  my_role: MemberRole;
  last_message_at: string;
  unread_count: number;
  last_message: { id: number; user_id: string | null; kind: MessageKind; body: string; is_ai: boolean; created_at: string } | null;
  member_ids: string[];
};

export type Message = {
  id: number;
  chat_id: string;
  user_id: string | null;
  kind: MessageKind;
  body: string;
  sticker_id: string | null;
  image_path: string | null;
  is_ai: boolean;
  ai_tag: AiTag | null;
  status: "visible" | "hidden";
  created_at: string;
  sticker_url?: string | null;
  image_url?: string | null;
};

export type Sticker = {
  id: string;
  owner_id: string | null;
  name: string;
  path: string;
  is_gif: boolean;
  is_official: boolean;
  status: "pending" | "approved" | "rejected";
  reject_reason: string | null;
  created_at: string;
  url?: string;
};

export type Report = {
  id: number;
  reporter_id: string;
  target_type: "message" | "user";
  message_id: number | null;
  user_id: string | null;
  reason: string;
  status: "open" | "resolved" | "dismissed";
  resolved_by: string | null;
  resolved_at: string | null;
  created_at: string;
};
