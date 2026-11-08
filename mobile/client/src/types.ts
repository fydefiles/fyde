export type Channel = "in_app" | "email" | "phone";
export type Profile = {
  id: number;
  name: string;
  email: string;
  email_verified: boolean;
  data_mode: string;
  onboarding_complete: boolean;
  default_channel: Channel;
  sharing_paused: boolean;
  chat_context_enabled: boolean;
};
export type FileCard = {
  id: string;
  document_id: string;
  title: string;
  name: string;
  number: number;
  size: number;
  state: string;
  document_type: string;
  matter: string;
  matter_id?: string;
  sensitive?: boolean;
  item_id?: string;
  available?: boolean;
  from?: string;
  download_url?: string;
  api_download_url?: string;
  // Search results from the API carry where the match was found.
  // exact/reason are optional extras the client shows when supplied.
  match?: {
    kind?: "keyword" | "semantic";
    excerpt?: string;
    page?: number | null;
    start?: number;
    end?: number;
    exact?: boolean;
    reason?: string;
  };
  // Optional fields the redesigned client can show when the API supplies them.
  modified_at?: string;
  starred?: boolean;
  snippet?: string;
};
export type Contact = {
  id: string;
  name: string;
  relationship: string;
  endpoint: string;
  email: string;
  phone: string;
  verified: boolean;
  aliases?: string;
};
export type Permission = {
  id: string;
  case: string;
  contact: string;
  owner: string;
  types: string[];
  future_files: boolean;
  future_versions: boolean;
  sensitive: boolean;
  used: number;
  limit: number;
  revoked: boolean;
  recipient_changed?: boolean;
  expires_at: string;
};
export type Workspace = {
  user: Profile;
  files: FileCard[];
  contacts: Contact[];
  matters: { id: string; name: string }[];
  document_types: { id: string; name: string }[];
  policies: Permission[];
  received_permissions: Permission[];
  plan: { sends: number | null; file_mib: number; storage_mib: number };
  consumed: number;
};
export type Choice = {
  turn_id: string;
  version_id?: string;
  contact_id?: string;
  policy_id?: string;
  remaining?: boolean;
  // Sent when the person approves a "confirm" turn's proposed file.
  confirmed?: boolean;
};
export type Turn = {
  id: string;
  message: string;
  reply: string;
  result: {
    // "confirm": Fyde matched a described file and waits for approval before
    // sending. files[0] is the proposal, the rest are alternatives.
    kind: string;
    channel?: Channel;
    section?: "files" | "people" | "permissions" | "classify";
    action_label?: string;
    files?: FileCard[];
    contacts?: Contact[];
    policies?: { id: string; name: string; from: string }[];
    transfers?: {
      id?: string;
      title: string;
      state: string;
      message?: string;
      url?: string;
    }[];
    remaining_versions?: string[];
    contact_id?: string;
    matter_id?: string;
  };
};
