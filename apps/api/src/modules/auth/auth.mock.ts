import type { ApiToken, Me, LoginResponse } from "@testate/shared";

import { ADMIN_ID, EARLIER, NOW, QA_ACTOR, SESSION_ID, TOKEN_ID } from "../../lib/mock/fixtures.ts";

export const LOGIN_RESPONSE_MOCK: LoginResponse = {
  user: { id: QA_ACTOR.id, username: "dina.qa", display_name: "Dina Putri", role: "qa" },
  must_change_password: false,
};

export const ME_MOCK: Me = {
  actor: { ...QA_ACTOR },
  must_change_password: false,
  project_scope: null,
};

export const SESSION_MOCK = {
  id: SESSION_ID,
  created_at: EARLIER,
  last_seen_at: NOW,
  ip: "10.0.4.7",
  user_agent: "Mozilla/5.0",
  current: true,
} as const;

export const TOKEN_MOCK: ApiToken = {
  id: TOKEN_ID,
  name: "ci-shop",
  kind: "standard",
  role: "qa",
  project_ids: null,
  prefix: "5Gk8x2Qp",
  created_by: ADMIN_ID,
  created_at: EARLIER,
  last_used_at: NOW,
  expires_at: null,
  revoked_at: null,
};

export const CREATE_TOKEN_RESPONSE_MOCK = {
  token: "tst_5Gk8x2QpScaffoldTokenNotARealSecret000000000",
  record: TOKEN_MOCK,
} as const;
