// צוות הניהול — מה ש-team_members() / team_activity() / team_add_manager() מחזירות (מיגרציה 8)
import type { JsonObject } from "./domain";

export interface TeamMember {
  user_id: string;
  role: "owner" | "manager";
  display_name: string | null;
  username: string;
  email: string;
  is_blocked: boolean;
  added_at: string;
  last_sign_in_at: string | null;
}

export interface TeamView {
  members: TeamMember[];
  seats: { used: number; limit: number | null; active: boolean };
}

export interface ActivityEntry {
  at: string;
  actor_role: "owner" | "manager" | "platform" | "system";
  actor: string | null;
  action: string;
  target: string | null;
  changes: JsonObject;
}

export type AddManagerResult = {
  status: "added" | "already_member";
  user_id: string;
  account_created: boolean;
};
