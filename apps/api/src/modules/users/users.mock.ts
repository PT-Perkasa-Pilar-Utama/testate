import type { User } from "@testate/shared";

import { EARLIER, NOW, USER_ID } from "../../lib/mock/fixtures.ts";

export const USER_MOCK: User = {
  id: USER_ID,
  username: "dina.qa",
  display_name: "Dina Putri",
  role: "qa",
  must_change_password: false,
  disabled_at: null,
  locked_until: null,
  last_login_at: NOW,
  created_at: EARLIER,
  updated_at: NOW,
};
