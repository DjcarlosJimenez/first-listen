import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";

const production = process.argv.includes("--production");
const baseUrl = production
  ? "https://www.firstlisten.net"
  : "http://127.0.0.1:3002";
const edgePath =
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const browserPort = production ? 9338 : 9337;
const newGuestIds = [];
const checks = [];
let service;
let browser;
let socket;
let profileDirectory;
let app;

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertNoError(error, context) {
  if (error) throw new Error(`${context}: ${error.message}`);
}

function record(name, details = true) {
  checks.push({ name, passed: true, details });
}

function run(command, args, environment) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env: environment,
      stdio: "ignore",
      windowsHide: true,
    });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} exited with code ${code}.`));
    });
  });
}

async function loadEnvironment() {
  const contents = await readFile(".env.local", "utf8");
  for (const line of contents.split(/\r?\n/)) {
    if (!line || line.trimStart().startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator < 1) continue;
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    if (!process.env[key]) process.env[key] = value;
  }
}

async function singleRpc(client, name, params, context) {
  const { data, error } = await client.rpc(name, params);
  assertNoError(error, context);
  return Array.isArray(data) ? data[0] : data;
}

async function listRpc(client, name, params, context) {
  const { data, error } = await client.rpc(name, params);
  assertNoError(error, context);
  return data ?? [];
}

async function startGuest(anon) {
  const nickname = `Listener ${Date.now().toString(36).slice(-6)}`;
  const row = await singleRpc(
    anon,
    "create_guest_identity",
    { guest_nickname: nickname, guest_language: "en" },
    "Create persistent guest identity",
  );
  assert(row?.guest_access_token, "Guest token was not returned");
  const guest = await service
    .from("guest_sessions")
    .select("id, nickname, guest_listener_id, recovery_code, expires_at")
    .eq("access_token", row.guest_access_token)
    .single();
  assertNoError(guest.error, "Resolve guest fixture");
  newGuestIds.push(guest.data.id);
  return {
    id: guest.data.id,
    token: String(row.guest_access_token),
    nickname: String(guest.data.nickname),
    listenerId: String(guest.data.guest_listener_id),
    recoveryCode: String(guest.data.recovery_code),
    expiresAt: guest.data.expires_at,
  };
}

async function trackBrowserGuest(token) {
  if (!token) return;
  const guest = await service
    .from("guest_sessions")
    .select("id")
    .eq("access_token", token)
    .maybeSingle();
  assertNoError(guest.error, "Resolve browser guest fixture");
  if (guest.data?.id && !newGuestIds.includes(guest.data.id)) {
    newGuestIds.push(guest.data.id);
  }
}

await loadEnvironment();
const projectRef = process.env.SUPABASE_PROJECT_REF;
const accessToken = process.env.SUPABASE_ACCESS_TOKEN;
assert(projectRef && accessToken, "Supabase project credentials are required");

const keyResponse = await fetch(
  `https://api.supabase.com/v1/projects/${projectRef}/api-keys?reveal=true`,
  { headers: { Authorization: `Bearer ${accessToken}` } },
);
assert(keyResponse.ok, `Supabase key lookup failed: ${keyResponse.status}`);
const keyPayload = await keyResponse.json();
const keyList = Array.isArray(keyPayload)
  ? keyPayload
  : keyPayload.api_keys ?? [];
const anonKey = keyList.find((key) => key.name === "anon")?.api_key;
const serviceRoleKey = keyList.find(
  (key) =>
    key.name === "service_role" ||
    key.name === "secret" ||
    key.type === "secret",
)?.api_key;
assert(anonKey && serviceRoleKey, "Supabase API keys are unavailable");

const supabaseUrl = `https://${projectRef}.supabase.co`;
const managementQueryUrl =
  `https://api.supabase.com/v1/projects/${projectRef}/database/query`;
const clientOptions = {
  auth: {
    autoRefreshToken: false,
    detectSessionInUrl: false,
    persistSession: false,
  },
};
service = createClient(supabaseUrl, serviceRoleKey, clientOptions);
const anon = createClient(supabaseUrl, anonKey, clientOptions);

async function managementQuery(query) {
  const response = await fetch(managementQueryUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query }),
  });
  if (!response.ok) {
    throw new Error(
      `Management cleanup failed (${response.status}): ${await response.text()}`,
    );
  }
}

try {
  if (!production) {
    const environment = {
      ...process.env,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: anonKey,
      NEXT_PUBLIC_SUPABASE_URL: supabaseUrl,
      SUPABASE_SERVICE_ROLE_KEY: serviceRoleKey,
    };
    await run(
      "C:\\Program Files\\nodejs\\node.exe",
      ["node_modules\\next\\dist\\bin\\next", "build"],
      environment,
    );
    app = spawn(
      "C:\\Program Files\\nodejs\\node.exe",
      ["node_modules\\next\\dist\\bin\\next", "start", "-p", "3002"],
      { env: environment, stdio: "ignore", windowsHide: true },
    );
    for (let attempt = 0; attempt < 60; attempt += 1) {
      try {
        const response = await fetch(baseUrl);
        if (response.ok) break;
      } catch {
        // The isolated local app is still starting.
      }
      await delay(200);
    }
  }

  const usersBefore = await service.auth.admin.listUsers({
    page: 1,
    perPage: 1000,
  });
  assertNoError(usersBefore.error, "Count Auth users before guest test");
  const founderBefore = await service
    .from("founder_program")
    .select("claimed_count")
    .single();
  assertNoError(founderBefore.error, "Read Founder count before guest test");

  const blockedRead = await anon.from("guest_sessions").select("id").limit(1);
  assert(blockedRead.error, "Anonymous caller could read guest session rows");
  record("Backing guest tables are not directly readable");

  const databaseGuest = await startGuest(anon);
  assert(
    databaseGuest.expiresAt === null &&
      databaseGuest.listenerId.startsWith("FL-") &&
      databaseGuest.recoveryCode.startsWith("MUSIC-"),
    "Guest identity was not created as a permanent recoverable profile",
  );
  const recoveredGuest = await singleRpc(
    anon,
    "recover_guest_identity",
    { submitted_recovery_code: databaseGuest.recoveryCode },
    "Recover persistent guest identity",
  );
  assert(
    recoveredGuest.guest_access_token === databaseGuest.token &&
      recoveredGuest.nickname === databaseGuest.nickname,
    "Recovery code did not restore the existing guest identity",
  );
  const databaseQueue = await listRpc(
    anon,
    "get_guest_song_queue",
    { guest_access_token: databaseGuest.token, queue_limit: 24 },
    "Read guest queue",
  );
  const eligibleSong = databaseQueue.find((song) =>
    ["youtube", "youtube_music", "soundcloud"].includes(song.platform),
  );
  assert(eligibleSong, "Guest queue has no telemetry-supported song");

  const liked = await singleRpc(
    anon,
    "toggle_song_like",
    {
      target_song_id: eligibleSong.song_id,
      guest_access_token: databaseGuest.token,
    },
    "Like song as guest",
  );
  const saved = await singleRpc(
    anon,
    "toggle_save_song",
    {
      target_song_id: eligibleSong.song_id,
      guest_access_token: databaseGuest.token,
    },
    "Save song as guest",
  );
  const followed = await singleRpc(
    anon,
    "toggle_follow_artist",
    {
      target_artist_id: eligibleSong.artist_id,
      guest_access_token: databaseGuest.token,
    },
    "Follow artist as guest",
  );
  const commentId = await singleRpc(
    anon,
    "add_song_comment",
    {
      target_song_id: eligibleSong.song_id,
      comment_body: "Production guest community action verification.",
      guest_access_token: databaseGuest.token,
    },
    "Comment as guest",
  );
  assert(commentId, "Guest comment ID was not returned");
  await singleRpc(
    anon,
    "record_song_share",
    {
      target_song_id: eligibleSong.song_id,
      share_kind_value: "community",
      share_platform: null,
      guest_access_token: databaseGuest.token,
    },
    "Record community share",
  );
  await singleRpc(
    anon,
    "record_song_share",
    {
      target_song_id: eligibleSong.song_id,
      share_kind_value: "original_platform",
      share_platform: eligibleSong.platform,
      guest_access_token: databaseGuest.token,
    },
    "Record original-platform share",
  );
  await singleRpc(
    anon,
    "record_song_view",
    {
      target_song_id: eligibleSong.song_id,
      guest_access_token: databaseGuest.token,
    },
    "Record guest song view",
  );
  const engagement = await singleRpc(
    anon,
    "get_song_engagement",
    {
      target_song_id: eligibleSong.song_id,
      guest_access_token: databaseGuest.token,
    },
    "Read guest song engagement",
  );
  assert(
    liked === true &&
      saved === true &&
      followed === true &&
      engagement.liked === true &&
      engagement.saved === true &&
      engagement.following === true &&
      Number(engagement.comment_count) >= 1 &&
      Number(engagement.community_share_count) >= 1 &&
      Number(engagement.original_share_count) >= 1,
    "Guest social actions were not stored or reported correctly",
  );
  record("Guest social action layer persists and reports engagement", {
    liked: engagement.liked,
    saved: engagement.saved,
    following: engagement.following,
    comments: engagement.comment_count,
    communityShares: engagement.community_share_count,
    originalShares: engagement.original_share_count,
  });

  const profileBefore = await singleRpc(
    anon,
    "get_public_artist_profile",
    { target_artist_id: eligibleSong.artist_id },
    "Read artist metrics before guest listen",
  );
  const started = await singleRpc(
    anon,
    "start_guest_listening_session",
    {
      guest_access_token: databaseGuest.token,
      target_song_id: eligibleSong.song_id,
    },
    "Start guest listening",
  );
  const heartbeatParams = {
    guest_access_token: databaseGuest.token,
    target_session_id: started.listening_session_id,
    playback_duration_seconds: 120,
    playback_state: "playing",
    playback_muted: false,
    playback_volume: 100,
    page_visible: true,
    page_focused: true,
    interaction_recent: true,
  };
  await singleRpc(
    anon,
    "record_guest_listening_heartbeat",
    { ...heartbeatParams, playback_position_seconds: 1 },
    "Initialize guest heartbeat",
  );
  for (const position of [12, 23, 34, 45]) {
    const prepared = await service
      .from("guest_listening_sessions")
      .update({
        last_heartbeat_at: new Date(Date.now() - 10_000).toISOString(),
      })
      .eq("id", started.listening_session_id);
    assertNoError(prepared.error, "Prepare guest heartbeat interval");
    await singleRpc(
      anon,
      "record_guest_listening_heartbeat",
      { ...heartbeatParams, playback_position_seconds: position },
      "Record guest heartbeat",
    );
  }

  const verifiedGuestListen = await service
    .from("guest_listening_sessions")
    .select("verified_seconds, valid_listen_at")
    .eq("id", started.listening_session_id)
    .single();
  assertNoError(verifiedGuestListen.error, "Read verified guest listen");
  assert(
    verifiedGuestListen.data.valid_listen_at &&
      verifiedGuestListen.data.verified_seconds >= 30,
    "Guest listen did not become valid",
  );
  const notification = await service
    .from("community_notifications")
    .select("actor_id, actor_visibility, actor_display_name, event_type, recipient_id")
    .eq("source_id", started.listening_session_id)
    .single();
  assertNoError(notification.error, "Read guest support notification");
  assert(
    notification.data.actor_id === null &&
      notification.data.actor_visibility === "public" &&
      notification.data.actor_display_name === databaseGuest.nickname &&
      notification.data.event_type === "valid_listen" &&
      notification.data.recipient_id === eligibleSong.artist_id,
    "Guest support notification did not preserve the public nickname",
  );
  const profileAfter = await singleRpc(
    anon,
    "get_public_artist_profile",
    { target_artist_id: eligibleSong.artist_id },
    "Read artist metrics after guest listen",
  );
  assert(
    Number(profileAfter.valid_listens_received) ===
      Number(profileBefore.valid_listens_received) + 1,
    "Guest valid listen was not reflected in artist metrics",
  );
  record("Guest listening creates nickname-attributed verified artist support", {
    artistId: eligibleSong.artist_id,
    verifiedSeconds: verifiedGuestListen.data.verified_seconds,
  });

  const uiGuest = await startGuest(anon);
  const uiQueue = await listRpc(
    anon,
    "get_guest_song_queue",
    { guest_access_token: uiGuest.token, queue_limit: 24 },
    "Read browser guest queue",
  );
  const supportedIndex = uiQueue.findIndex((song) =>
    ["youtube", "youtube_music", "soundcloud"].includes(song.platform),
  );
  assert(supportedIndex >= 0, "Browser guest queue has no playable provider");
  if (supportedIndex > 0) {
    const skipped = uiQueue.slice(0, supportedIndex).map((song) => ({
      guest_session_id: uiGuest.id,
      song_id: song.song_id,
      platform: song.platform,
      status: "finished",
      telemetry_supported: false,
      valid_listen_at: new Date().toISOString(),
    }));
    const skipResult = await service
      .from("guest_listening_sessions")
      .insert(skipped);
    assertNoError(skipResult.error, "Prepare deterministic browser guest queue");
  }
  const expectedFirstTitle = uiQueue[supportedIndex].title;

  profileDirectory = await mkdtemp(join(tmpdir(), "first-listen-guest-ui-"));
  browser = spawn(
    edgePath,
    [
      "--headless=new",
      `--remote-debugging-port=${browserPort}`,
      `--user-data-dir=${profileDirectory}`,
      "--autoplay-policy=no-user-gesture-required",
      "--disable-background-networking",
      "--disable-default-apps",
      "--disable-extensions",
      "--disable-gpu",
      "--no-first-run",
      "--no-sandbox",
      "about:blank",
    ],
    { stdio: "ignore", windowsHide: true },
  );
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(
        `http://127.0.0.1:${browserPort}/json/version`,
      );
      if (response.ok) break;
    } catch {
      // Edge is still starting.
    }
    await delay(200);
  }
  const targetResponse = await fetch(
    `http://127.0.0.1:${browserPort}/json/new?${encodeURIComponent(
      "about:blank",
    )}`,
    { method: "PUT" },
  );
  assert(targetResponse.ok, "Could not create Edge guest test target");
  const target = await targetResponse.json();
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });

  let commandId = 0;
  const pending = new Map();
  const browserMessages = [];
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (!message.id) {
      if (message.method === "Runtime.consoleAPICalled") {
        browserMessages.push(
          message.params.args
            .map((argument) => argument.value ?? argument.description ?? "")
            .join(" "),
        );
      } else if (message.method === "Runtime.exceptionThrown") {
        browserMessages.push(
          message.params.exceptionDetails.exception?.description ??
            message.params.exceptionDetails.text ??
            "Runtime exception",
        );
      }
      return;
    }
    const waiter = pending.get(message.id);
    if (!waiter) return;
    pending.delete(message.id);
    if (message.error) waiter.reject(new Error(message.error.message));
    else waiter.resolve(message.result);
  });
  const command = (method, params = {}) => {
    commandId += 1;
    socket.send(JSON.stringify({ id: commandId, method, params }));
    return new Promise((resolve, reject) => {
      pending.set(commandId, { reject, resolve });
    });
  };
  const evaluate = async (expression) => {
    const result = await command("Runtime.evaluate", {
      awaitPromise: true,
      expression,
      returnByValue: true,
    });
    if (result.exceptionDetails) {
      throw new Error(
        result.exceptionDetails.exception?.description ??
          result.exceptionDetails.text ??
          "Browser evaluation failed",
      );
    }
    return result.result.value;
  };
  const navigate = async (url) => {
    await command("Page.navigate", { url });
    await delay(1200);
  };
  const waitFor = async (expression, predicate, timeout = 20000) => {
    const startedAt = Date.now();
    let value;
    while (Date.now() - startedAt < timeout) {
      value = await evaluate(expression);
      if (predicate(value)) return value;
      await delay(300);
    }
    return value;
  };
  await command("Page.enable");
  await command("Runtime.enable");
  await navigate(baseUrl);
  const landing = await waitFor(
    `(() => ({
      guest: [...document.querySelectorAll("button")].some((button) => button.innerText.includes("Enter Now")),
      join: document.body.innerText.includes("Create Account"),
      paths: document.querySelectorAll(".landing-path-card").length
    }))()`,
    (value) => value.guest && value.join && value.paths === 2,
  );
  assert(landing.guest && landing.join, "Landing guest choices did not render");
  await evaluate(`(() => {
    localStorage.setItem("first-listen-guest-token", ${JSON.stringify(
      uiGuest.token,
    )});
    sessionStorage.setItem("first-listen-player-debug", "1");
    const button = [...document.querySelectorAll("button")]
      .find((item) => item.innerText.includes("Enter Now"));
    button?.click();
  })()`);
  const guestUrl = await waitFor(
    "window.location.href",
    (value) => value.includes("/guest"),
  );
  assert(guestUrl.includes("/guest"), "Guest CTA did not open guest experience");
  const guestUi = await waitFor(
    `(() => ({
      body: document.body.innerText,
      listen: document.querySelector(".guest-listen-button")?.innerText ?? "",
      title: document.querySelector(".guest-now-playing h2")?.innerText ?? "",
      text: document.querySelector(".guest-page")?.innerText ?? "",
      url: window.location.href
    }))()`,
    (value) =>
      value.listen.includes("Listen Now") &&
      value.title === expectedFirstTitle &&
      value.text.includes("Permanent guest access"),
    25000,
  );
  assert(
    guestUi.title === expectedFirstTitle,
    `Guest queue rendered an unexpected state: ${JSON.stringify(guestUi)}`,
  );
  await trackBrowserGuest(
    await evaluate(`localStorage.getItem("first-listen-guest-token")`),
  );

  await evaluate(`document.querySelector(".guest-listen-button")?.click()`);
  const playback = await waitFor(
    `(() => {
      const diagnostics = Object.fromEntries(
        [...document.querySelectorAll(".provider-player-debug > div")].map((row) => [
          row.querySelector("dt")?.textContent ?? "",
          row.querySelector("dd")?.textContent ?? ""
        ])
      );
      const player = document.querySelector(".guest-player-wrap");
      const rect = player?.getBoundingClientRect();
      return {
        diagnostics,
        progress: Boolean(document.querySelector(".guest-listening-progress")),
        visible: Boolean(rect && rect.top < window.innerHeight && rect.bottom > 0)
      };
    })()`,
    (value) =>
      value.progress &&
      value.visible &&
      value.diagnostics["Provider ready"] !== "pending" &&
      value.diagnostics["Embed URL"]?.includes("autoplay=1") &&
      value.diagnostics["Play state"] === "playing",
    30000,
  );
  assert(
    playback.diagnostics["Play state"] === "playing",
    `One-click playback did not reach playing: ${JSON.stringify(playback)}`,
  );
  record("One-click guest playback", {
    autoplayUrl: playback.diagnostics["Embed URL"],
    playState: playback.diagnostics["Play state"],
    playerVisible: playback.visible,
  });

  await command("Emulation.setDeviceMetricsOverride", {
    deviceScaleFactor: 1,
    height: 844,
    mobile: true,
    screenHeight: 844,
    screenWidth: 390,
    width: 390,
  });
  await navigate(`${baseUrl}/guest`);
  const mobile = await waitFor(
    `(() => ({
      guestPage: Boolean(document.querySelector(".guest-page")),
      overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
      width: window.innerWidth
    }))()`,
    (value) => value.guestPage,
  );
  assert(!mobile.overflow, `Guest mobile page overflows: ${JSON.stringify(mobile)}`);
  await trackBrowserGuest(
    await evaluate(`localStorage.getItem("first-listen-guest-token")`),
  );
  record("Guest mobile layout", mobile);

  const hydrationErrors = browserMessages.filter((message) =>
    /hydration|did not match|server rendered html/i.test(message),
  );
  assert(
    hydrationErrors.length === 0,
    `Guest browser logged hydration errors: ${JSON.stringify(hydrationErrors)}`,
  );

  const usersAfter = await service.auth.admin.listUsers({
    page: 1,
    perPage: 1000,
  });
  assertNoError(usersAfter.error, "Count Auth users after guest test");
  const founderAfter = await service
    .from("founder_program")
    .select("claimed_count")
    .single();
  assertNoError(founderAfter.error, "Read Founder count after guest test");
  assert(
    usersAfter.data.users.length === usersBefore.data.users.length,
    "Guest experience created an Auth account",
  );
  assert(
    founderAfter.data.claimed_count === founderBefore.data.claimed_count,
    "Guest experience claimed a Founder spot",
  );
  record("Guest restrictions", {
    authUsersUnchanged: true,
    founderCountUnchanged: true,
    tableReadBlocked: true,
  });

  console.log(
    JSON.stringify(
      {
        checks,
        status: "passed",
        target: production ? "production" : "local",
      },
      null,
      2,
    ),
  );
} finally {
  socket?.close();
  app?.kill();
  browser?.kill();
  await delay(400);
  if (newGuestIds.length) {
    const guestIds = newGuestIds
      .map((id) => `'${id.replaceAll("'", "''")}'::uuid`)
      .join(", ");
    await managementQuery(`
      begin;
      delete from public.song_comments
      where guest_session_id in (${guestIds});
      delete from public.song_shares
      where guest_session_id in (${guestIds});
      delete from public.song_views
      where guest_session_id in (${guestIds});
      delete from public.community_notifications
      where source_id in (
        select id
        from public.guest_listening_sessions
        where guest_session_id in (${guestIds})
      );
      delete from public.guest_sessions
      where id in (${guestIds});
      commit;
    `);
  }
  if (profileDirectory) {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        await rm(profileDirectory, { force: true, recursive: true });
        break;
      } catch {
        await delay(400);
      }
    }
  }
}
