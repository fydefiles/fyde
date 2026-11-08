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
};
export type Contact = {
  id: string;
  name: string;
  relationship: string;
  endpoint: string;
  email: string;
  phone: string;
  verified: boolean;
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
};
export type Turn = {
  id: string;
  message: string;
  reply: string;
  result: {
    kind: string;
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
