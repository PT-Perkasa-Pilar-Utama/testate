/*
 * The homepage's motion: the hero scene, scroll parallax, reveals, and the section rail.
 * The scene is one loop that is the product: take a state, let a test run dirty the rows,
 * check the state out, watch every row go back. The HUD under the hero copy narrates it.
 */

const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
const hero = document.querySelector(".hero");
const canvas = document.getElementById("scene");
const hud = {
  phase: document.getElementById("phase"),
  detail: document.getElementById("detail"),
  ticks: [...document.querySelectorAll(".hud .ticks i")],
};

const PHASES = [
  { at: 0.0, name: "take state", detail: "seeded-baseline · 3 databases" },
  { at: 1.4, name: "test run", detail: "dirties {n} rows" },
  { at: 5.0, name: "checkout", detail: "seeded-baseline" },
  { at: 6.6, name: "restored", detail: "1.2 s · every row back where it was" },
];
const LOOP = 8.4;

const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

async function startScene() {
  const gl = canvas.getContext("webgl2");
  if (!gl) throw new Error("no webgl2");
  const THREE = await import("https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.min.js");

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setClearColor(0x000000, 0);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x05070a, 0.03);
  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 100);
  const rig = new THREE.Group();
  scene.add(rig);

  scene.add(new THREE.HemisphereLight(0xbfe9dd, 0x05070a, 0.9));
  const key = new THREE.DirectionalLight(0xffffff, 1.6);
  key.position.set(-4, 9, 6);
  scene.add(key);
  const rim = new THREE.PointLight(0x7dd3c0, 40, 30);
  rim.position.set(6, 5, -4);
  scene.add(rim);

  // The table: a field of rows whose height and colour are the data
  const COLS = 26;
  const ROWS = 16;
  const N = COLS * ROWS;
  const GAP = 0.5;
  const W = COLS * GAP;
  const D = ROWS * GAP;
  const geo = new THREE.BoxGeometry(0.34, 1, 0.34);
  geo.translate(0, 0.5, 0);
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.55, metalness: 0.15 });
  const field = new THREE.InstancedMesh(geo, mat, N);
  field.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  rig.add(field);

  const cells = [];
  const low = new THREE.Color(0x0f3b3a);
  const high = new THREE.Color(0x7dd3c0);
  const dirtyA = new THREE.Color(0xf0b35a);
  const dirtyB = new THREE.Color(0xf85149);
  for (let i = 0; i < N; i++) {
    const cx = i % COLS;
    const cz = Math.floor(i / COLS);
    const x = (cx - COLS / 2 + 0.5) * GAP;
    const z = (cz - ROWS / 2 + 0.5) * GAP;
    const wave = Math.sin(cx * 0.55) * Math.cos(cz * 0.7) + Math.sin((cx + cz) * 0.25);
    const base = 0.12 + (wave + 2) * 0.28 + Math.random() * 0.08;
    const dirty = Math.random() < 0.34;
    cells.push({
      x,
      z,
      base,
      color: low.clone().lerp(high, Math.min(1, base / 1.1)),
      dirty,
      target: dirty ? 0.08 + Math.random() * 1.5 : base,
      dirtyColor: Math.random() < 0.8 ? dirtyA : dirtyB,
      start: 1.5 + Math.random() * 2.6,
    });
  }
  const dirtyCount = cells.filter((c) => c.dirty).length;

  // The trunk from the logo: states on a line, HEAD filled, a branch off it
  const graph = new THREE.Group();
  graph.position.set(W / 2 + 1.1, 0, -0.5);
  rig.add(graph);
  const nodeMat = new THREE.MeshStandardMaterial({
    color: 0x7dd3c0,
    emissive: 0x7dd3c0,
    emissiveIntensity: 0.35,
    roughness: 0.4,
  });
  const headMat = new THREE.MeshStandardMaterial({
    color: 0x10b981,
    emissive: 0x10b981,
    emissiveIntensity: 0.9,
    roughness: 0.3,
  });
  const nodeGeo = new THREE.SphereGeometry(0.17, 24, 24);
  const trunkPts = [0, 1.1, 2.2, 3.3, 4.4].map((y) => new THREE.Vector3(0, y, 0));
  const trunk = new THREE.Mesh(
    new THREE.TubeGeometry(new THREE.CatmullRomCurve3(trunkPts), 8, 0.035, 8, false),
    nodeMat
  );
  graph.add(trunk);
  const branch = new THREE.Mesh(
    new THREE.TubeGeometry(
      new THREE.CatmullRomCurve3([
        new THREE.Vector3(0, 2.2, 0),
        new THREE.Vector3(-0.2, 2.9, 0.3),
        new THREE.Vector3(-1.2, 3.4, 0.6),
        new THREE.Vector3(-1.3, 4.1, 0.6),
      ]),
      12,
      0.035,
      8,
      false
    ),
    nodeMat
  );
  graph.add(branch);
  const nodes = trunkPts.map((p) => {
    const m = new THREE.Mesh(nodeGeo, nodeMat);
    m.position.copy(p);
    graph.add(m);
    return m;
  });
  const branchTip = new THREE.Mesh(nodeGeo, nodeMat);
  branchTip.position.set(-1.3, 4.1, 0.6);
  graph.add(branchTip);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.26, 32, 32), headMat);
  head.position.copy(trunkPts[4]);
  graph.add(head);
  const halo = new THREE.Mesh(
    new THREE.SphereGeometry(0.6, 24, 24),
    new THREE.MeshBasicMaterial({
      color: 0x10b981,
      transparent: true,
      opacity: 0.12,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    })
  );
  halo.position.copy(head.position);
  graph.add(halo);
  const fresh = nodes[4];

  // The sweep: a thin plane that reads the table on snapshot and writes it back on checkout
  const sweep = new THREE.Mesh(
    new THREE.PlaneGeometry(0.06, D + 1),
    new THREE.MeshBasicMaterial({
      color: 0x8dd6ff,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    })
  );
  sweep.rotation.x = -Math.PI / 2;
  sweep.position.y = 0.02;
  rig.add(sweep);

  const m4 = new THREE.Matrix4();
  const col = new THREE.Color();
  const white = new THREE.Color(0xffffff);
  const cyan = new THREE.Color(0x8dd6ff);

  function layout() {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    const wide = w > 900;
    if (wide) {
      camera.position.set(4, 11, 23);
      camera.lookAt(-2, 0.5, 0);
    } else {
      camera.position.set(0, 13, 30);
      camera.lookAt(0, 6.5, 0);
    }
    rig.scale.setScalar(wide ? 1 : 0.75);
  }
  layout();
  addEventListener("resize", layout);

  const pointer = { x: 0, y: 0, tx: 0, ty: 0 };
  if (!reduced) {
    hero.addEventListener("pointermove", (e) => {
      pointer.tx = (e.clientX / innerWidth - 0.5) * 2;
      pointer.ty = (e.clientY / innerHeight - 0.5) * 2;
    });
    hero.addEventListener("pointerleave", () => {
      pointer.tx = 0;
      pointer.ty = 0;
    });
  }

  let shown = -1;
  function narrate(t) {
    let i = PHASES.length - 1;
    while (i > 0 && t < PHASES[i].at) i--;
    if (i !== shown) {
      shown = i;
      hud.phase.textContent = PHASES[i].name;
      hud.detail.innerHTML = PHASES[i].detail.replace("{n}", `<span class="n">${dirtyCount}</span>`);
    }
    hud.ticks.forEach((el, k) => {
      const a = PHASES[k].at;
      const b = k + 1 < PHASES.length ? PHASES[k + 1].at : LOOP;
      el.style.setProperty("--p", ((t - a) / (b - a)).toFixed(3));
    });
  }

  function frame(t) {
    const snapX = -W / 2 - 1 + smooth(0.1, 1.3, t) * (W + 2);
    const outX = -W / 2 - 1 + smooth(5.0, 6.5, t) * (W + 2);
    const snapping = t > 0.05 && t < 1.35;
    const restoring = t > 4.95 && t < 6.55;
    sweep.position.x = snapping ? snapX : outX;
    sweep.material.opacity = snapping || restoring ? 0.9 : 0;
    sweep.material.color.set(snapping ? 0xffffff : 0x8dd6ff);

    for (let i = 0; i < N; i++) {
      const c = cells[i];
      let d = c.dirty ? smooth(c.start, c.start + 0.7, t) : 0;
      if (t >= 5) d *= 1 - smooth(outX - 0.5, outX + 0.1, c.x);
      const h = c.base + (c.target - c.base) * d;
      m4.makeScale(1, h, 1);
      m4.setPosition(c.x, 0, c.z);
      field.setMatrixAt(i, m4);
      col.copy(c.color).lerp(c.dirtyColor, d);
      const flash = snapping
        ? Math.exp(-Math.abs(c.x - snapX) * 1.6)
        : restoring
          ? Math.exp(-Math.abs(c.x - outX) * 1.6)
          : 0;
      col.lerp(snapping ? white : cyan, flash * 0.85);
      field.setColorAt(i, col);
    }
    field.instanceMatrix.needsUpdate = true;
    field.instanceColor.needsUpdate = true;

    const pop = smooth(1.0, 1.5, t);
    fresh.scale.setScalar(pop);
    head.scale.setScalar(pop * (1 + 0.12 * Math.sin(t * 6)));
    const pulse = 1 + 0.2 * Math.sin(t * 6) + (t > 5 && t < 6.6 ? 0.7 : 0);
    halo.scale.setScalar(pop * pulse);
    halo.material.opacity = 0.1 + (t > 5 && t < 6.6 ? 0.18 : 0);
    headMat.emissiveIntensity = 0.8 + (t > 5 && t < 6.6 ? 1.2 : 0);
  }

  const clock = new THREE.Clock();
  let running = true;
  let visible = true;
  let scrollY = 0;

  function tick() {
    if (!running || !visible) return;
    const t = clock.getElapsedTime() % LOOP;
    pointer.x += (pointer.tx - pointer.x) * 0.04;
    pointer.y += (pointer.ty - pointer.y) * 0.04;
    rig.rotation.y = pointer.x * 0.08 + Math.sin(clock.elapsedTime * 0.15) * 0.05;
    rig.rotation.x = pointer.y * 0.04;
    rig.position.y = -scrollY * 0.004;
    frame(t);
    narrate(t);
    renderer.render(scene, camera);
    requestAnimationFrame(tick);
  }

  if (reduced) {
    frame(7.5);
    narrate(7.5);
    renderer.render(scene, camera);
  } else {
    addEventListener("scroll", () => {
      scrollY = window.scrollY;
    }, { passive: true });
    new IntersectionObserver(([e]) => {
      visible = e.isIntersecting;
      if (visible) tick();
    }).observe(canvas);
    document.addEventListener("visibilitychange", () => {
      running = !document.hidden;
      if (running) tick();
    });
    tick();
  }
  canvas.classList.add("on");
}

startScene().catch((err) => {
  console.warn("hero scene off:", err.message);
  hero.classList.add("static");
  hud.phase.textContent = "restored";
  hud.detail.textContent = "1.2 s · every row back where it was";
  hud.ticks.forEach((el) => el.style.setProperty("--p", "1"));
});

// Scroll: the masthead solidifies, the hero copy drifts, background layers lag
const masthead = document.querySelector(".masthead");
const copy = document.querySelector(".hero .copy");
const layers = [...document.querySelectorAll(".parallax")];
function onScroll() {
  const y = window.scrollY;
  masthead.classList.toggle("solid", y > 24);
  if (reduced) return;
  copy.style.transform = `translateY(${y * 0.22}px)`;
  copy.style.opacity = String(Math.max(0, 1 - y / (innerHeight * 0.7)));
  for (const el of layers) {
    const r = el.parentElement.getBoundingClientRect();
    const rel = (r.top + r.height / 2 - innerHeight / 2) / innerHeight;
    el.style.transform = `translateY(${rel * -Number(el.dataset.speed || 60)}px)`;
  }
}
addEventListener("scroll", onScroll, { passive: true });
onScroll();

// Reveal on entry
const io = new IntersectionObserver(
  (entries) => {
    for (const e of entries) {
      if (e.isIntersecting) {
        e.target.classList.add("in");
        io.unobserve(e.target);
      }
    }
  },
  { threshold: 0.18 }
);
document.querySelectorAll(".reveal, .loop").forEach((el) => io.observe(el));

// Cards: the hover wash follows the pointer
document.querySelectorAll(".card").forEach((card) => {
  card.addEventListener("pointermove", (e) => {
    const r = card.getBoundingClientRect();
    card.style.setProperty("--mx", `${e.clientX - r.left}px`);
    card.style.setProperty("--my", `${e.clientY - r.top}px`);
  });
});

// Rail: which band is on screen
const rail = document.querySelector(".rail");
const railLinks = [...rail.querySelectorAll("a")];
const bands = railLinks.map((a) => document.querySelector(a.getAttribute("href")));
const spy = new IntersectionObserver(
  (entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      const i = bands.indexOf(e.target);
      railLinks.forEach((a, k) => a.classList.toggle("active", k === i));
    }
  },
  { rootMargin: "-45% 0px -45% 0px" }
);
bands.forEach((b) => spy.observe(b));
new IntersectionObserver(([e]) => rail.classList.toggle("show", !e.isIntersecting), {
  threshold: 0.2,
}).observe(hero);

// Copy the install command
document.querySelectorAll(".terminal .copy").forEach((btn) => {
  btn.addEventListener("click", async () => {
    const text = btn.parentElement.dataset.cmd;
    try {
      await navigator.clipboard.writeText(text);
      btn.textContent = "copied";
      btn.classList.add("done");
      setTimeout(() => {
        btn.textContent = "copy";
        btn.classList.remove("done");
      }, 1600);
    } catch {
      btn.textContent = "select it";
    }
  });
});

// The terminal: one agent session over MCP, typed out when it scrolls into view
const term = document.getElementById("term");
const replay = document.querySelector(".mac .replay");
const SESSION = [
  { k: "cmd", t: "claude mcp add --transport http testate https://testate.internal/api/v1/mcp \\" },
  { k: "cmd", t: '  --header "Authorization: Bearer tst_g7…"', ps: false },
  { k: "out", t: "Added HTTP MCP server testate with URL: https://testate.internal/api/v1/mcp to local config", wait: 500 },
  { k: "gap" },
  { k: "cmd", t: "claude", wait: 300 },
  { k: "out", t: "Claude Code · MCP servers: testate ✔", wait: 400 },
  { k: "gap" },
  { k: "ask", t: "show me the last 10 transactions in the shop project", type: true, wait: 900 },
  { k: "gap" },
  { k: "tool", t: "testate · help", wait: 500 },
  { k: "res", t: "guide: projects → adapters → tables → rows · reads only · 200 rows a page", wait: 500 },
  { k: "tool", t: 'testate · list_adapters <i>(project: "shop")</i>', wait: 500 },
  { k: "res", t: "shop-postgres · postgresql 16.3 · tabular · sandbox", wait: 500 },
  { k: "tool", t: 'testate · describe_table <i>(adapter: "shop-postgres", table: "public.transactions")</i>', wait: 500 },
  { k: "res", t: "7 columns · pk id · fk customer_id → public.customers · policy: card_last4 masked", wait: 600 },
  { k: "tool", t: 'testate · run_readonly_query <i>(adapter: "shop-postgres", sql: "SELECT … ORDER BY created_at DESC LIMIT 10")</i>', wait: 900 },
  { k: "res", t: "10 rows · 38 ms · read-only transaction · masked_columns: [card_last4]", wait: 400 },
  { k: "gap" },
  { k: "th", t: "  id     customer  amount    status     card  created_at" },
  { k: "td", t: "  88213  c_4471    129.00    <b class=\"bad\">failed</b>     <b class=\"mask\">***</b>   2026-09-01 14:02:11" },
  { k: "td", t: "  88212  c_4471    129.00    <b class=\"bad\">failed</b>     <b class=\"mask\">***</b>   2026-09-01 14:01:48" },
  { k: "td", t: "  88211  c_1120     42.50    settled    <b class=\"mask\">***</b>   2026-09-01 13:58:03" },
  { k: "td", t: "  88210  c_0093    310.00    settled    <b class=\"mask\">***</b>   2026-09-01 13:57:40" },
  { k: "td", t: "  88209  c_4471    129.00    <b class=\"bad\">failed</b>     <b class=\"mask\">***</b>   2026-09-01 13:55:19" },
  { k: "td", t: "  88208  c_2207     18.90    settled    <b class=\"mask\">***</b>   2026-09-01 13:52:02" },
  { k: "td", t: "  88207  c_0512     77.00    refunded   <b class=\"mask\">***</b>   2026-09-01 13:49:31" },
  { k: "td", t: "  88206  c_1120     42.50    settled    <b class=\"mask\">***</b>   2026-09-01 13:44:57" },
  { k: "td", t: "  88205  c_3388    205.00    settled    <b class=\"mask\">***</b>   2026-09-01 13:41:10" },
  { k: "td", t: "  88204  c_0093     12.00    settled    <b class=\"mask\">***</b>   2026-09-01 13:38:26", wait: 700 },
  { k: "gap" },
  {
    k: "say",
    t: "Ten transactions, newest first. Three are failed, all from customer c_4471, same amount, seven minutes apart: that looks like a retry loop on one order. card_last4 is masked by a column policy, so I cannot see the card. Want me to pull the customer row and the order it belongs to?",
    wait: 0,
  },
  { k: "gap" },
  { k: "ask", t: "", cursor: true },
];

const pause = (ms) => new Promise((r) => setTimeout(r, ms));
let playing = 0;

async function typeInto(el, text, speed) {
  for (const ch of text) {
    el.textContent += ch;
    await pause(speed + Math.random() * speed);
  }
}

async function playTerminal() {
  const run = ++playing;
  term.textContent = "";
  replay.hidden = true;
  let cursor = document.createElement("span");
  cursor.className = "cur";
  for (const line of SESSION) {
    if (run !== playing) return;
    cursor.remove();
    const el = document.createElement("div");
    el.className = line.k === "gap" ? "gap" : line.k;
    if (line.k === "gap") {
      el.textContent = " ";
      term.append(el);
      continue;
    }
    if (line.k === "cmd" && line.ps !== false) {
      const ps = document.createElement("span");
      ps.className = "ps";
      ps.textContent = "~/shop $ ";
      el.append(ps);
    }
    const body = document.createElement("span");
    el.append(body);
    term.append(el);
    const typed = (line.k === "cmd" || line.type) && !reduced;
    if (typed) {
      el.append(cursor);
      await typeInto(body, line.t, 22);
    } else {
      body.innerHTML = line.t;
    }
    if (line.cursor) el.append(cursor);
    term.scrollTop = term.scrollHeight;
    if (!reduced) await pause(line.wait ?? (line.k === "td" ? 70 : 250));
  }
  replay.hidden = false;
}

new IntersectionObserver(
  ([e], obs) => {
    if (!e.isIntersecting) return;
    obs.disconnect();
    playTerminal();
  },
  { threshold: 0.35 }
).observe(term);
replay.addEventListener("click", playTerminal);
