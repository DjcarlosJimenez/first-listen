import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const valueAfter = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const baseUrl = valueAfter("--base-url", "https://www.firstlisten.net").replace(/\/$/, "");
const outputDir = path.resolve(
  valueAfter(
    "--output-dir",
    path.join(root, "android", "play-store", "assets", "screenshots"),
  ),
);
const chromePath = valueAfter(
  "--chrome",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
);
const port = 9330 + Math.floor(Math.random() * 60);
const profileDir = await fs.mkdtemp(path.join(os.tmpdir(), "first-listen-play-store-"));

if (typeof WebSocket !== "function") {
  throw new Error("This script requires the WebSocket client included with Node 22 or newer.");
}

await fs.mkdir(outputDir, { recursive: true });

const chrome = spawn(
  chromePath,
  [
    "--headless=new",
    "--disable-gpu",
    "--hide-scrollbars",
    "--no-first-run",
    "--no-default-browser-check",
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profileDir}`,
    "about:blank",
  ],
  { stdio: "ignore" },
);

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function waitForJson(url, attempts = 80) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) return response.json();
    } catch {}
    await sleep(125);
  }
  throw new Error(`Chrome DevTools did not start at ${url}`);
}

function createCdpClient(webSocketUrl) {
  const socket = new WebSocket(webSocketUrl);
  let nextId = 1;
  const pending = new Map();

  const ready = new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });

  socket.addEventListener("message", (event) => {
    const message = JSON.parse(String(event.data));
    if (!message.id || !pending.has(message.id)) return;
    const { resolve, reject } = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) reject(new Error(message.error.message));
    else resolve(message.result ?? {});
  });

  return {
    ready,
    close: () => socket.close(),
    send(method, params = {}) {
      const id = nextId;
      nextId += 1;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        socket.send(JSON.stringify({ id, method, params }));
      });
    },
  };
}

async function evaluate(client, expression) {
  const result = await client.send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  return result.result?.value;
}

async function waitFor(client, expression, timeout = 20000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeout) {
    if (await evaluate(client, expression)) return;
    await sleep(250);
  }
  throw new Error(`Timed out waiting for: ${expression}`);
}

async function navigate(client, url) {
  await client.send("Page.navigate", { url });
  await waitFor(client, "document.readyState === 'complete'");
  await sleep(1200);
}

async function screenshot(client, filename) {
  const result = await client.send("Page.captureScreenshot", {
    format: "jpeg",
    quality: 94,
    fromSurface: true,
    captureBeyondViewport: false,
  });
  await fs.writeFile(path.join(outputDir, filename), Buffer.from(result.data, "base64"));
}

let client;
try {
  await waitForJson(`http://127.0.0.1:${port}/json/version`);
  const page = await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, {
    method: "PUT",
  }).then((response) => response.json());
  client = createCdpClient(page.webSocketDebuggerUrl);
  await client.ready;

  await client.send("Page.enable");
  await client.send("Runtime.enable");
  await client.send("Network.enable");
  await client.send("Emulation.setDeviceMetricsOverride", {
    width: 360,
    height: 640,
    deviceScaleFactor: 3,
    mobile: true,
    screenWidth: 360,
    screenHeight: 640,
    screenOrientation: { type: "portraitPrimary", angle: 0 },
  });
  await client.send("Emulation.setTouchEmulationEnabled", {
    enabled: true,
    maxTouchPoints: 5,
  });
  await client.send("Network.setUserAgentOverride", {
    userAgent:
      "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Mobile Safari/537.36",
    platform: "Android",
  });

  await navigate(client, `${baseUrl}/guest?source=android-app`);
  await waitFor(
    client,
    "document.querySelector('.first-listen-simple-discovery-prompt') && !document.body.innerText.includes('Preparando música nueva')",
  );
  await evaluate(client, "window.scrollTo(0, 0); true");
  await sleep(500);
  await screenshot(client, "01-discover-new-music.jpg");

  await evaluate(
    client,
    "([...document.querySelectorAll('button')].find((button) => button.textContent.includes('Ahora no'))?.click(), true)",
  );
  await sleep(600);
  await evaluate(
    client,
    "document.querySelector('.first-listen-simple-player-card')?.scrollIntoView({block:'start'}); window.scrollBy(0,-8); true",
  );
  await sleep(500);
  await screenshot(client, "02-listen-your-way.jpg");

  await evaluate(
    client,
    "document.querySelector('.first-listen-simple-styles')?.scrollIntoView({block:'start'}); window.scrollBy(0,-8); true",
  );
  await sleep(500);
  await screenshot(client, "03-choose-your-style.jpg");

  await navigate(client, `${baseUrl}/first-publish?source=android-app`);
  await waitFor(client, "Boolean(document.querySelector('.first-publish-page'))");
  await evaluate(client, "window.scrollTo(0, 0); true");
  await sleep(500);
  await screenshot(client, "04-publish-your-song.jpg");

  console.log(`Play Store screenshots captured from ${baseUrl}.`);
} finally {
  client?.close();
  if (chrome.exitCode === null) {
    const exited = new Promise((resolve) => chrome.once("exit", resolve));
    chrome.kill();
    await Promise.race([exited, sleep(3000)]);
  }
  await fs.rm(profileDir, {
    recursive: true,
    force: true,
    maxRetries: 12,
    retryDelay: 250,
  });
}
