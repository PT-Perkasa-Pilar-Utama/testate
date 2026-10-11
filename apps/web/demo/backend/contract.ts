/** What the page needs from the in-page API (#demo). Types only: the page's type-check reads this, not the API. */
export type DemoAccount = { username: string; password: string };

export type DemoStart = {
  fetch: (request: Request) => Promise<Response>;
  basePath: string;
  admin: DemoAccount;
  accounts: readonly DemoAccount[];
};

export type StartDemo = () => Promise<DemoStart>;
