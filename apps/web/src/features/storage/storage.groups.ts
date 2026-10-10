import type { AdapterWithProject } from "@testate/shared";

/** Stores by project, each project once, Inspect first (#63, Q3), then by name. */
export type StoreGroup = {
  slug: string;
  name: string;
  inspect: boolean;
  stores: AdapterWithProject[];
};

/** `?project=<slug>` narrows the screen to one project: a project page's count links here. */
export function storeGroups(stores: AdapterWithProject[], only: string): StoreGroup[] {
  return byProject(stores.filter((store) => only === "" || store.project_slug === only)).sort(
    (a, b) => Number(b.inspect) - Number(a.inspect)
  );
}

function byProject(stores: AdapterWithProject[]): StoreGroup[] {
  const groups = new Map<string, StoreGroup>();
  for (const store of stores) {
    const group = groups.get(store.project_slug) ?? {
      slug: store.project_slug,
      name: store.project_name,
      inspect: store.project_kind === "inspect",
      stores: [],
    };
    group.stores.push(store);
    groups.set(store.project_slug, group);
  }
  return [...groups.values()];
}
