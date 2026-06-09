import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";

const production = process.argv.includes("--production");
const edgePath =
  process.argv.slice(2).find((argument) => !argument.startsWith("--")) ??
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const appPort = 3002;
const browserPort = 9334;
const baseUrl = production
  ? "https://www.firstlisten.net"
  : `http://127.0.0.1:${appPort}`;

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function loadLocalEnvironment() {
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

await loadLocalEnvironment();
const projectRef = process.env.SUPABASE_PROJECT_REF;
const accessToken = process.env.SUPABASE_ACCESS_TOKEN;
if (!projectRef || !accessToken) {
  throw new Error("SUPABASE_PROJECT_REF and SUPABASE_ACCESS_TOKEN are required.");
}

const keyResponse = await fetch(
  `https://api.supabase.com/v1/projects/${projectRef}/api-keys?reveal=true`,
  { headers: { Authorization: `Bearer ${accessToken}` } },
);
if (!keyResponse.ok) {
  throw new Error(`Supabase API key lookup failed: ${keyResponse.status}`);
}
const keys = await keyResponse.json();
const keyList = Array.isArray(keys) ? keys : keys.api_keys ?? [];
const anonKey = keyList.find((key) => key.name === "anon")?.api_key;
const serviceRoleKey = keyList.find(
  (key) => key.name === "service_role" || key.name === "secret" || key.type === "secret",
)?.api_key;
if (!anonKey || !serviceRoleKey) {
  throw new Error("Supabase API keys are unavailable.");
}

const supabaseUrl = `https://${projectRef}.supabase.co`;
const supabaseOptions = {
  auth: {
    autoRefreshToken: false,
    detectSessionInUrl: false,
    persistSession: false,
  },
};
const service = createClient(supabaseUrl, serviceRoleKey, supabaseOptions);
const runId = randomUUID().replaceAll("-", "");
const email = `submission-ui-${runId}@example.com`;
const password = `Submission${runId.slice(0, 10)}Aa1`;
const profileDirectory = await mkdtemp(join(tmpdir(), "first-listen-ui-"));
let userId = null;
let app = null;
let browser = null;
let socket = null;

try {
  const { data: created, error: createError } = await service.auth.admin.createUser({
    email,
    email_confirm: true,
    password,
    user_metadata: {
      explicit_content_acknowledged: true,
      full_name: "Submission UI Check",
      legal_accepted: true,
      system_bootstrap: true,
    },
  });
  if (createError || !created.user) {
    throw createError ?? new Error("Disposable Auth user was not created.");
  }
  userId = created.user.id;

  for (let attempt = 0; attempt < 15; attempt += 1) {
    const { data: profile, error } = await service
      .from("profiles")
      .select("id")
      .eq("id", userId)
      .maybeSingle();
    if (error) throw error;
    if (profile) break;
    await delay(200);
  }
  const { error: profileError } = await service
    .from("profiles")
    .update({
      genre_preferences: ["Pop"],
      languages_understood: ["English"],
      onboarding_completed: true,
    })
    .eq("id", userId);
  if (profileError) throw profileError;

  const environment = {
    ...process.env,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: anonKey,
    NEXT_PUBLIC_SUPABASE_URL: supabaseUrl,
    SUPABASE_SERVICE_ROLE_KEY: serviceRoleKey,
  };
  if (!production) {
    await run(
      "C:\\Program Files\\nodejs\\node.exe",
      ["node_modules\\next\\dist\\bin\\next", "build"],
      environment,
    );

    app = spawn(
      "C:\\Program Files\\nodejs\\node.exe",
      ["node_modules\\next\\dist\\bin\\next", "start", "-p", String(appPort)],
      { env: environment, stdio: "ignore", windowsHide: true },
    );
    for (let attempt = 0; attempt < 40; attempt += 1) {
      try {
        const response = await fetch(`${baseUrl}/login`);
        if (response.ok) break;
      } catch {
        // The production server is still starting.
      }
      await delay(250);
    }
  }

  browser = spawn(
    edgePath,
    [
      "--headless=new",
      `--remote-debugging-port=${browserPort}`,
      `--user-data-dir=${profileDirectory}`,
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
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${browserPort}/json/version`);
      if (response.ok) break;
    } catch {
      // The browser is still starting.
    }
    await delay(200);
  }

  const targetResponse = await fetch(
    `http://127.0.0.1:${browserPort}/json/new?${encodeURIComponent("about:blank")}`,
    { method: "PUT" },
  );
  const target = await targetResponse.json();
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });

  let commandId = 0;
  const pendingCommands = new Map();
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
      } else if (message.method === "Log.entryAdded") {
        browserMessages.push(message.params.entry.text);
      }
      return;
    }
    const pending = pendingCommands.get(message.id);
    if (!pending) return;
    pendingCommands.delete(message.id);
    if (message.error) pending.reject(new Error(message.error.message));
    else pending.resolve(message.result);
  });
  const command = (method, params = {}) => {
    commandId += 1;
    const id = commandId;
    socket.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => {
      pendingCommands.set(id, { reject, resolve });
    });
  };
  const evaluate = async (expression) => {
    const result = await command("Runtime.evaluate", {
      awaitPromise: true,
      expression,
      returnByValue: true,
    });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.text ?? "Browser evaluation failed.");
    }
    return result.result.value;
  };
  const navigate = async (url) => {
    await command("Page.navigate", { url });
    await delay(1500);
  };
  const waitFor = async (expression, predicate, timeout = 15000) => {
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
  await command("Log.enable");
  await command("Runtime.enable");
  await navigate(`${baseUrl}/login`);
  await evaluate(`(() => {
    const setInput = (selector, value) => {
      const input = document.querySelector(selector);
      const setter = Object.getOwnPropertyDescriptor(
        input instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype,
        "value"
      ).set;
      setter.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    };
    setInput('input[name="email"]', ${JSON.stringify(email)});
    setInput('input[name="password"]', ${JSON.stringify(password)});
    document.querySelector("button.auth-submit").click();
  })()`);
  const loggedInUrl = await waitFor(
    "window.location.href",
    (value) => value.includes("/dashboard"),
  );
  if (!loggedInUrl.includes("/dashboard")) {
    throw new Error(`UI login did not reach the dashboard: ${loggedInUrl}`);
  }

  await navigate(`${baseUrl}/submit?debug=1`);
  const setField = async (selector, value) =>
    evaluate(`(() => {
      const input = document.querySelector(${JSON.stringify(selector)});
      if (!input) return false;
      const prototype = input instanceof HTMLSelectElement
        ? HTMLSelectElement.prototype
        : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(prototype, "value").set.call(input, ${JSON.stringify(value)});
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    })()`);

  const playlistUrl =
    "https://music.youtube.com/playlist?list=PL0ZUQXp9nO7WxNHiw5ObNTVjf5wTb1xim";
  await setField("#music-link", playlistUrl);
  await delay(700);
  const playlistState = await evaluate(`(() => ({
    buttonDisabled: document.querySelector('button[type="submit"].wide')?.disabled,
    debug: document.querySelector(".submission-debug")?.innerText ?? "",
    linkMessage: document.querySelector("#music-link")?.closest(".field")?.querySelector("small")?.innerText ?? "",
    validation: document.querySelector(".submission-validation")?.innerText ?? ""
  }))()`);

  await setField(
    "#music-link",
    "https://music.youtube.com/watch?v=Tl1YrfQ9bkY&list=PL0ZUQXp9nO7WxNHiw5ObNTVjf5wTb1xim",
  );
  await setField("#song-title", "Submission UI Check");
  await setField("#artist-name", "First Listen Diagnostics");
  await setField("#genre", "Pop");
  await setField("#song-language", "English");
  await setField("#country", "United States");
  await setField("#cover-url", "");
  await delay(1200);
  const trackState = await evaluate(`(() => ({
    buttonDisabled: document.querySelector('button[type="submit"].wide')?.disabled,
    coverRequired: document.querySelector("#cover-url")?.required,
    debug: document.querySelector(".submission-debug")?.innerText ?? "",
    validation: document.querySelector(".submission-validation")?.innerText ?? ""
  }))()`);

  if (
    playlistState.buttonDisabled !== true ||
    !playlistState.linkMessage.toLowerCase().includes("playlist") ||
    trackState.buttonDisabled !== false ||
    trackState.coverRequired !== false ||
    trackState.validation
  ) {
    throw new Error("Submission UI state did not match the expected validation behavior.");
  }

  await navigate(`${baseUrl}/dashboard?debug=1`);
  const listeningBankState = await evaluate(`(() => ({
    claimDisabled: document.querySelector(".listening-claim-button")?.disabled,
    exists: Boolean(document.querySelector(".listening-bank-panel")),
    text: document.querySelector(".listening-bank-panel")?.innerText ?? ""
  }))()`);
  if (
    !listeningBankState.exists ||
    listeningBankState.claimDisabled !== true ||
    !listeningBankState.text.toLowerCase().includes("listening bank") ||
    !listeningBankState.text.toLowerCase().includes("explorer")
  ) {
    throw new Error(
      `Listening Bank dashboard state is incorrect: ${JSON.stringify(listeningBankState)}`,
    );
  }

  await command("Emulation.setDeviceMetricsOverride", {
    deviceScaleFactor: 1,
    height: 844,
    mobile: true,
    screenHeight: 844,
    screenWidth: 390,
    width: 390,
  });
  await navigate(`${baseUrl}/dashboard?debug=1`);
  const mobileDashboardState = await evaluate(`(() => ({
    bankVisible: Boolean(document.querySelector(".listening-bank-panel")),
    hasHorizontalOverflow: document.documentElement.scrollWidth > window.innerWidth + 1,
    viewportWidth: window.innerWidth
  }))()`);
  if (
    !mobileDashboardState.bankVisible ||
    mobileDashboardState.hasHorizontalOverflow
  ) {
    throw new Error(
      `Mobile Listening Bank layout is incorrect: ${JSON.stringify(mobileDashboardState)}`,
    );
  }
  await command("Emulation.clearDeviceMetricsOverride");
  await navigate(`${baseUrl}/dashboard?debug=1`);

  const routeTransitionResults = [];
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const navigationStartedAt = Date.now();
    const clickedReview = await evaluate(`(() => {
      const button = document.querySelectorAll(".sidebar nav button")[0];
      button?.click();
      return Boolean(button);
    })()`);
    if (!clickedReview) throw new Error("Review Songs navigation button was not found.");

    const playerState = await waitFor(
      `(() => ({
        diagnostics: Object.fromEntries(
          [...document.querySelectorAll(".provider-player-debug > div")].map((row) => [
            row.querySelector("dt")?.textContent ?? "",
            row.querySelector("dd")?.textContent ?? ""
          ])
        ),
        iframeReady: Boolean(document.querySelector(".provider-player iframe.ready")),
        loading: document.querySelector(".provider-player-status")?.textContent ?? "",
        url: window.location.href
      }))()`,
      (value) => value.iframeReady,
      20000,
    );
    routeTransitionResults.push({
      attempt,
      readyMilliseconds: Date.now() - navigationStartedAt,
      ...playerState,
    });
    if (!playerState.iframeReady) {
      throw new Error(
        `Provider did not become ready after client navigation attempt ${attempt}: ${JSON.stringify(playerState)}`,
      );
    }
    if (
      !playerState.diagnostics["Song loaded"] ||
      !playerState.diagnostics["Embed generated"] ||
      !playerState.diagnostics["Player mounted"] ||
      !playerState.diagnostics["Provider ready"] ||
      playerState.diagnostics["Provider ready"] === "pending"
    ) {
      throw new Error(
        `Player lifecycle diagnostics were incomplete after attempt ${attempt}: ${JSON.stringify(playerState.diagnostics)}`,
      );
    }

    const clickedDashboard = await evaluate(`(() => {
      const button = document.querySelectorAll(".sidebar nav button")[1];
      button?.click();
      return Boolean(button);
    })()`);
    if (!clickedDashboard) throw new Error("Artist Dashboard navigation button was not found.");
    await waitFor(
      "window.location.pathname",
      (value) => value === "/dashboard",
    );
  }

  const hydrationMessages = browserMessages.filter((message) =>
    /hydration|did not match|server rendered html/i.test(message),
  );
  if (hydrationMessages.length > 0) {
    throw new Error(
      `Hydration errors were logged during route-transition testing: ${JSON.stringify(hydrationMessages)}`,
    );
  }

  console.log(
    JSON.stringify(
      {
        cover_url_optional: true,
        direct_track_submit_enabled: true,
        playlist_error_visible: playlistState.linkMessage,
        playlist_submit_disabled: true,
        route_transition_results: routeTransitionResults,
        runtime_message_count: browserMessages.length,
        hydration_messages: hydrationMessages,
        listening_bank_state: listeningBankState,
        mobile_dashboard_state: mobileDashboardState,
        status: "passed",
        target: production ? "production" : "local",
        track_debug: trackState.debug,
      },
      null,
      2,
    ),
  );
} finally {
  socket?.close();
  app?.kill();
  browser?.kill();
  await delay(500);
  if (userId) {
    const { error } = await service.auth.admin.deleteUser(userId);
    if (error) throw error;
  }
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      await rm(profileDirectory, { force: true, recursive: true });
      break;
    } catch {
      await delay(500);
    }
  }
}
