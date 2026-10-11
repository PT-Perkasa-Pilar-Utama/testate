import { describe, expect, it } from "bun:test";
import { readingAdapterSchema } from "@testate/shared";
import * as v from "valibot";

import { isHostFile, readHost } from "./host.ts";
import type { HostIo, Pause, Statvfs } from "./host.ts";

/** A file that answers one text on the first read and another after the pause. */
type Twice = readonly [string, string];

/** USER_HZ ticks over two CPUs: one second later, 80 busy, 10 iowait, 110 idle. */
const STAT_FIRST =
  "cpu  10237528 0 6587233 164170188 453429 0 288437 0 0 0\ncpu0 5118764 0 3293616 82085094 226714 0 144218 0 0 0\ncpu1 5118764 0 3293617 82085094 226715 0 144219 0 0 0\nintr 1\n";
const STAT_SECOND =
  "cpu  10237578 0 6587263 164170298 453439 0 288437 0 0 0\ncpu0 5118789 0 3293631 82085149 226719 0 144218 0 0 0\ncpu1 5118789 0 3293632 82085149 226720 0 144219 0 0 0\nintr 1\n";
const NET = (rx: number, tx: number, loopback: number): string =>
  `Inter-|   Receive |  Transmit\n face |bytes packets errs drop fifo frame compressed multicast|bytes\n    lo: ${loopback} 10 0 0 0 0 0 0 ${loopback} 10 0 0 0 0 0 0\n  eth0: ${rx} 20 0 0 0 0 0 0 ${tx} 30 0 0 0 0 0 0\n`;
/** The command name holds a space and a `)`, as a real one may. */
const APP_STAT = (utime: number, stime: number): string =>
  `4242 (node /srv/a) b) S 1 4242 4242 0 -1 4194560 100 0 0 0 ${utime} ${stime} 0 0 20 0 11 0 91500000 1000 2000\n`;

/** What the Colima VM's OpenSSH answered on 2026-10-11 (decision log, "What was measured first"). */
const PROC: Map<string, string | Twice> = new Map<string, string | Twice>([
  ["/proc/loadavg", "0.20 0.26 0.27 1/527 3038012\n"],
  [
    "/proc/meminfo",
    "MemTotal:        2968356 kB\nMemFree:          112344 kB\nMemAvailable:    1820044 kB\nSwapTotal:             0 kB\nSwapFree:              0 kB\n",
  ],
  ["/proc/uptime", "915300.63 1641701.88\n"],
  ["/proc/stat", [STAT_FIRST, STAT_SECOND]],
  ["/proc/net/dev", [NET(1000, 2000, 99999), NET(1500, 2300, 199999)]],
  [".pm2/pids/shop-api-0.pid", "4242\n"],
  ["/proc/4242/stat", [APP_STAT(1000, 500), APP_STAT(1020, 505)]],
  ["/proc/4242/status", "Name:\tnode\nVmRSS:\t   51200 kB\n"],
]);
const DISK: Statvfs = { f_frsize: 4096, f_blocks: 4805312, f_bavail: 4470261 };

type FakeHost = { io: HostIo; pause: Pause };

/** A host whose files answer their second text once `pause` has run. */
function fakeHost(files: Map<string, string | Twice>, disk: Statvfs | Error = DISK): FakeHost {
  let round = 0;
  const io: HostIo = {
    async text(path) {
      const text = files.get(path);
      if (text === undefined) throw new Error(`No such file: ${path}`);
      return v.is(v.string(), text) ? text : text[round === 0 ? 0 : 1];
    },
    async statvfs() {
      if (disk instanceof Error) throw disk;
      return disk;
    },
    async names(dir) {
      const prefix = `${dir}/`;
      return [...files.keys()]
        .filter((path) => path.startsWith(prefix))
        .map((path) => path.slice(prefix.length));
    },
  };
  return {
    io,
    pause: async () => {
      round = 1;
    },
  };
}

async function readFake(
  files: Map<string, string | Twice>,
  disk?: Statvfs | Error
): ReturnType<typeof readHost> {
  const { io, pause } = fakeHost(files, disk);
  return readHost(io, "/data", pause);
}

const valueOf = (read: Awaited<ReturnType<typeof readHost>>, key: string): number | undefined =>
  read.values.find((item) => item.key === key)?.value;

describe("a host reading over SFTP (#38)", () => {
  it("reads load, CPUs, memory, uptime and disk from what a Linux host answers", async () => {
    const read = await readFake(PROC);
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
    const read = await readFake(PROC);
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
    const read = await readFake(noProc);
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
    const read = await readFake(broken);
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
    const read = await readFake(PROC, new Error("statvfs not supported"));
    expect(read.unavailable).toStrictEqual([
      { key: "disk_total", reason: "statvfs not supported" },
      { key: "disk_free", reason: "statvfs not supported" },
    ]);
  });
});

describe("a host's rates and pm2 apps (#101)", () => {
  it("reads CPU %, iowait and network throughput from two reads a second apart", async () => {
    const read = await readFake(PROC);
    expect(valueOf(read, "cpu_percent")).toBe(40);
    expect(valueOf(read, "cpu_iowait")).toBe(5);
    // Loopback moved 100000 bytes and is left out.
    expect(valueOf(read, "net_rx")).toBe(500);
    expect(valueOf(read, "net_tx")).toBe(300);
  });

  it("reads each pm2 app's CPU, memory and uptime from its pid file and /proc", async () => {
    const read = await readFake(PROC);
    expect(valueOf(read, "app_shop_api_0_cpu")).toBe(25);
    expect(valueOf(read, "app_shop_api_0_memory")).toBe(51200 * 1024);
    expect(valueOf(read, "app_shop_api_0_uptime")).toBe(301);
  });

  it("says an app whose process is gone is not running", async () => {
    const dead = new Map([...PROC].filter(([path]) => !path.startsWith("/proc/4242/")));
    const read = await readFake(dead);
    expect(read.unavailable).toStrictEqual(
      ["cpu", "memory", "uptime"].map((key) => ({
        key: `app_shop_api_0_${key}`,
        reason: "pm2 lists pid 4242, which is not running",
      }))
    );
  });

  it("reads no app on a host without pm2, and says nothing about it", async () => {
    const plain = new Map([...PROC].filter(([path]) => !path.startsWith(".pm2/")));
    const read = await readFake(plain);
    expect(read.unavailable).toStrictEqual([]);
    expect(read.values.some((item) => item.key.startsWith("app_"))).toBe(false);
  });

  it("opens only the fixed files, a process's stat and status, and pm2's pid files", () => {
    expect(
      ["/proc/net/dev", "/proc/12/stat", "/proc/12/status", ".pm2/pids/a-0.pid"].map(isHostFile)
    ).toStrictEqual([true, true, true, true]);
    expect(
      [
        "/etc/shadow",
        "/proc/self/environ",
        "/proc/12/environ",
        ".pm2/pids/../x.pid",
        "/proc/12/../../etc/shadow",
      ].map(isHostFile)
    ).toStrictEqual([false, false, false, false, false]);
  });
});
