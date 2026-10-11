import { describe, expect, it } from "bun:test";
import { readingAdapterSchema } from "@testate/shared";
import * as v from "valibot";

import { readHost } from "./host.ts";
import type { HostIo, Statvfs } from "./host.ts";

/** What the Colima VM's OpenSSH answered on 2026-10-11 (decision log, "What was measured first"). */
const PROC: Map<string, string> = new Map([
  ["/proc/loadavg", "0.20 0.26 0.27 1/527 3038012\n"],
  [
    "/proc/meminfo",
    "MemTotal:        2968356 kB\nMemFree:          112344 kB\nMemAvailable:    1820044 kB\nSwapTotal:             0 kB\nSwapFree:              0 kB\n",
  ],
  ["/proc/uptime", "915300.63 1641701.88\n"],
  [
    "/proc/stat",
    "cpu  10237528 0 6587233 164170188 453429 0 288437 0 0 0\ncpu0 5118764 0 3293616 82085094 226714 0 144218 0 0 0\ncpu1 5118764 0 3293617 82085094 226715 0 144219 0 0 0\nintr 1\n",
  ],
]);
const DISK: Statvfs = { f_frsize: 4096, f_blocks: 4805312, f_bavail: 4470261 };

function fakeHost(files: Map<string, string>, disk: Statvfs | Error = DISK): HostIo {
  return {
    async text(path) {
      const text = files.get(path);
      if (text === undefined) throw new Error(`No such file: ${path}`);
      return text;
    },
    async statvfs() {
      if (disk instanceof Error) throw disk;
      return disk;
    },
  };
}

const valueOf = (read: Awaited<ReturnType<typeof readHost>>, key: string): number | undefined =>
  read.values.find((item) => item.key === key)?.value;

describe("a host reading over SFTP (#38)", () => {
  it("reads load, CPUs, memory, uptime and disk from what a Linux host answers", async () => {
    const read = await readHost(fakeHost(PROC), "/data");
    expect(read.unavailable).toStrictEqual([]);
    expect(valueOf(read, "load_1m")).toBe(0.2);
    expect(valueOf(read, "load_15m")).toBe(0.27);
    expect(valueOf(read, "cpu_count")).toBe(2);
    expect(valueOf(read, "memory_total")).toBe(2968356 * 1024);
    expect(valueOf(read, "memory_available")).toBe(1820044 * 1024);
    expect(valueOf(read, "uptime")).toBe(915301);
    expect(valueOf(read, "disk_total")).toBe(4805312 * 4096);
    expect(valueOf(read, "disk_free")).toBe(4470261 * 4096);
  });

  it("answers the reading contract", async () => {
    const read = await readHost(fakeHost(PROC), "/data");
    const adapter = {
      adapter_id: "01991f00-0000-7000-8000-000000000020",
      name: "uploads",
      engine: "sftp",
      source: "host",
      ...read,
    };
    expect(v.safeParse(readingAdapterSchema, adapter).success).toBe(true);
  });

  it("marks only the missing file's values unavailable, with why", async () => {
    const noProc = new Map([...PROC].filter(([path]) => path !== "/proc/meminfo"));
    const read = await readHost(fakeHost(noProc), "/data");
    expect(read.unavailable.map((gap) => gap.key)).toStrictEqual([
      "memory_total",
      "memory_available",
      "swap_total",
      "swap_free",
    ]);
    expect(read.unavailable[0]?.reason).toContain("/proc/meminfo");
    expect(valueOf(read, "load_1m")).toBe(0.2);
  });

  it("says a line that does not parse is unavailable instead of failing the reading", async () => {
    const broken = new Map(PROC);
    broken.set("/proc/loadavg", "garbage\n");
    broken.set("/proc/meminfo", "MemTotal:        2968356 kB\n");
    const read = await readHost(fakeHost(broken), "/data");
    expect(read.unavailable.map((gap) => gap.key)).toStrictEqual([
      "load_1m",
      "load_5m",
      "load_15m",
      "memory_available",
      "swap_total",
      "swap_free",
    ]);
    expect(valueOf(read, "memory_total")).toBe(2968356 * 1024);
  });

  it("names a server without statvfs as the disk's reason", async () => {
    const read = await readHost(fakeHost(PROC, new Error("statvfs not supported")), "/data");
    expect(read.unavailable).toStrictEqual([
      { key: "disk_total", reason: "statvfs not supported" },
      { key: "disk_free", reason: "statvfs not supported" },
    ]);
  });
});
