import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const chromePath = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const baseUrl = process.env.FIRST_LISTEN_TEST_URL || "http://127.0.0.1:3012/guest";
const port = 9300 + (process.pid % 500);
const profileDirectory = await mkdtemp(join(tmpdir(), "first-listen-browser-"));
const chrome = spawn(
  chromePath,
  [
    "--headless=new",
    "--disable-gpu",
    "--disable-background-networking",
    "--disable-component-update",
    "--disable-default-apps",
    "--disable-features=Translate",
    "--disable-sync",
    "--hide-scrollbars",
    "--lang=es-MX",
    "--mute-audio",
    "--no-first-run",
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profileDirectory}`,
    "about:blank",
  ],
  { stdio: "ignore", windowsHide: true },
);

const wait = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

async function eventually(task, message, timeout = 30_000) {
  const deadline = Date.now() + timeout;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const result = await task();
      if (result) return result;
    } catch (error) {
      lastError = error;
    }
    await wait(250);
  }
  throw new Error(message, lastError ? { cause: lastError } : undefined);
}

async function connect() {
  const pages = await eventually(async () => {
    const response = await fetch(`http://127.0.0.1:${port}/json/list`);
    if (!response.ok) return null;
    const targets = await response.json();
    return targets.filter((target) => target.type === "page");
  }, "Chrome DevTools did not become available.");
  const socket = new WebSocket(pages[0].webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });

  let commandId = 0;
  const pending = new Map();
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(String(event.data));
    if (!message.id || !pending.has(message.id)) return;
    const { resolve, reject } = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) reject(new Error(message.error.message));
    else resolve(message.result);
  });

  const call = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++commandId;
      pending.set(id, { resolve, reject });
      socket.send(JSON.stringify({ id, method, params }));
    });

  return { call, close: () => socket.close() };
}

let client;
try {
  client = await connect();
  await client.call("Page.enable");
  await client.call("Runtime.enable");
  await client.call("Emulation.setLocaleOverride", { locale: "es-MX" });
  await client.call("Page.navigate", { url: baseUrl });

  const evaluate = async (expression) => {
    const result = await client.call("Runtime.evaluate", {
      awaitPromise: true,
      expression,
      returnByValue: true,
    });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.text || "Browser evaluation failed.");
    }
    return result.result.value;
  };

  await eventually(
    () => evaluate("Boolean(document.querySelector('.first-listen-simple-new-row'))"),
    "The First Listen guest experience did not finish loading.",
  );

  await evaluate(`(() => {
    localStorage.removeItem('first-listen-locale-explicit');
    localStorage.setItem('first-listen-locale', 'en');
    location.reload();
    return true;
  })()`);

  await eventually(
    () =>
      evaluate(
        "document.querySelector('.first-listen-simple-stage h1')?.textContent?.includes('Tu próxima canción favorita')",
      ),
    "Spanish device detection did not override the stale non-explicit language.",
  );

  const clickRotationCard = async (index) => {
    await evaluate(`(() => {
      const card = document.querySelectorAll('.first-listen-simple-new-row button')[${index}];
      card?.scrollIntoView({ block: 'center', inline: 'center' });
      return Boolean(card);
    })()`);
    await wait(150);
    const target = await evaluate(`(() => {
      const card = document.querySelectorAll('.first-listen-simple-new-row button')[${index}];
      const title = card?.querySelector('strong')?.textContent?.trim();
      const rect = card?.getBoundingClientRect();
      return rect && title ? { title, x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } : null;
    })()`);
    if (!target) throw new Error(`Rotation card ${index} was not available.`);
    await client.call("Input.dispatchMouseEvent", {
      button: "left",
      clickCount: 1,
      type: "mousePressed",
      x: target.x,
      y: target.y,
    });
    await client.call("Input.dispatchMouseEvent", {
      button: "left",
      clickCount: 1,
      type: "mouseReleased",
      x: target.x,
      y: target.y,
    });
    await eventually(
      () =>
        evaluate(`(() => {
          const activeTitle = document.querySelector('.first-listen-simple-song-heading strong')?.textContent?.trim();
          const manualPlayOverlay = document.querySelector('.first-listen-simple-cover-action');
          const iframe = document.querySelector('.first-listen-simple-player-frame iframe');
          const autoplayRequested = iframe?.src?.includes('autoplay=1');
          return activeTitle === ${JSON.stringify(target.title)} && !manualPlayOverlay && autoplayRequested;
        })()`),
      `One-click playback did not start for ${target.title}.`,
    );
    return target.title;
  };

  const desktopSong = await clickRotationCard(1);

  await evaluate(`(() => {
    const selector = document.querySelector('.first-listen-simple-header .language-selector select');
    selector.value = 'en';
    selector.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`);
  await eventually(
    () =>
      evaluate(
        "document.querySelector('.first-listen-simple-stage h1')?.textContent?.includes('Your next favorite song') && localStorage.getItem('first-listen-locale-explicit') === 'en'",
      ),
    "The manual language selector did not switch and persist English.",
  );

  await evaluate("location.reload(); true");
  await eventually(
    () =>
      evaluate(
        "document.querySelector('.first-listen-simple-stage h1')?.textContent?.includes('Your next favorite song')",
      ),
    "The manually selected language did not survive reload.",
  );

  await client.call("Emulation.setDeviceMetricsOverride", {
    deviceScaleFactor: 1,
    height: 844,
    mobile: true,
    screenHeight: 844,
    screenWidth: 390,
    width: 390,
  });
  await client.call("Emulation.setTouchEmulationEnabled", {
    enabled: true,
    maxTouchPoints: 5,
  });
  await evaluate(`(() => {
    localStorage.setItem('first-listen-locale-explicit', 'es');
    localStorage.setItem('first-listen-locale', 'es');
    location.reload();
    return true;
  })()`);
  await eventually(
    () => evaluate("Boolean(document.querySelector('.first-listen-simple-new-row'))"),
    "The mobile First Listen experience did not finish loading.",
  );
  const mobileSong = await clickRotationCard(2);

  console.log(
    JSON.stringify(
      {
        desktop: { language: "es-MX detected; EN manual preference persisted", song: desktopSong },
        mobile: { language: "ES selected", song: mobileSong },
        status: "passed",
      },
      null,
      2,
    ),
  );
} finally {
  client?.close();
  chrome.kill();
  await wait(500);
  await rm(profileDirectory, { force: true, recursive: true }).catch(() => undefined);
}
