import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

const chromePath = process.argv[2];
if (!chromePath) {
  throw new Error("Pass the Chrome executable path as the first argument.");
}

const browserPort = 9333;
const harnessPort = 3003;
const profileDirectory = await mkdtemp(join(tmpdir(), "first-listen-chrome-"));

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function youtubeHarness(embedUrl) {
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <title>First Listen provider diagnostic</title>
  </head>
  <body>
    <iframe
      id="provider-player"
      allow="autoplay; encrypted-media; fullscreen"
      src="${embedUrl.replaceAll("&", "&amp;")}"
      title="Provider diagnostic"
    ></iframe>
    <script>
      window.providerDiagnostic = {
        apiReady: false,
        currentTime: 0,
        duration: 0,
        error: null,
        muted: null,
        state: -99,
        volume: null
      };
      window.onYouTubeIframeAPIReady = function () {
        const player = new YT.Player("provider-player", {
          events: {
            onError: function (event) {
              window.providerDiagnostic.error = event.data;
            },
            onReady: function (event) {
              window.providerDiagnostic.apiReady = true;
              event.target.playVideo();
              setInterval(function () {
                window.providerDiagnostic.currentTime = event.target.getCurrentTime();
                window.providerDiagnostic.duration = event.target.getDuration();
                window.providerDiagnostic.muted = event.target.isMuted();
                window.providerDiagnostic.state = event.target.getPlayerState();
                window.providerDiagnostic.volume = event.target.getVolume();
              }, 250);
            },
            onStateChange: function (event) {
              window.providerDiagnostic.state = event.data;
            }
          }
        });
        window.providerPlayer = player;
      };
    </script>
    <script src="https://www.youtube.com/iframe_api"></script>
  </body>
</html>`;
}

const youtubeCases = new Map([
  [
    "/youtube-video",
    "https://www.youtube-nocookie.com/embed/Tl1YrfQ9bkY?controls=1&enablejsapi=1&playsinline=1&rel=0&modestbranding=1&origin=http%3A%2F%2F127.0.0.1%3A3003",
  ],
  [
    "/youtube-music-track",
    "https://www.youtube-nocookie.com/embed/Tl1YrfQ9bkY?controls=1&enablejsapi=1&playsinline=1&rel=0&modestbranding=1&origin=http%3A%2F%2F127.0.0.1%3A3003",
  ],
  [
    "/youtube-music-playlist",
    "https://www.youtube-nocookie.com/embed?controls=1&enablejsapi=1&playsinline=1&rel=0&modestbranding=1&origin=http%3A%2F%2F127.0.0.1%3A3003&listType=playlist&list=PL0ZUQXp9nO7WxNHiw5ObNTVjf5wTb1xim",
  ],
]);

const server = createServer((request, response) => {
  const embedUrl = youtubeCases.get(request.url ?? "");
  if (!embedUrl) {
    response.writeHead(404).end("Not found");
    return;
  }
  response.writeHead(200, {
    "Content-Security-Policy":
      "default-src 'self'; script-src 'self' 'unsafe-inline' https://www.youtube.com https://www.youtube-nocookie.com; frame-src https://www.youtube.com https://www.youtube-nocookie.com; connect-src https:; style-src 'unsafe-inline'",
    "Content-Type": "text/html; charset=utf-8",
    "Referrer-Policy": "strict-origin-when-cross-origin",
  });
  response.end(youtubeHarness(embedUrl));
});

await new Promise((resolve) => server.listen(harnessPort, "127.0.0.1", resolve));

const chrome = spawn(
  chromePath,
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
  { stdio: "ignore" },
);

async function waitForDebugger() {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${browserPort}/json/version`);
      if (response.ok) return;
    } catch {
      // Chrome is still starting.
    }
    await delay(200);
  }
  throw new Error("Chrome DevTools endpoint did not become available.");
}

await waitForDebugger();
const targetResponse = await fetch(
  `http://127.0.0.1:${browserPort}/json/new?${encodeURIComponent("about:blank")}`,
  { method: "PUT" },
);
const target = await targetResponse.json();
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener("open", resolve, { once: true });
  socket.addEventListener("error", reject, { once: true });
});

let commandId = 0;
const pendingCommands = new Map();
socket.addEventListener("message", (event) => {
  const message = JSON.parse(event.data);
  if (!message.id) return;
  const pending = pendingCommands.get(message.id);
  if (!pending) return;
  pendingCommands.delete(message.id);
  if (message.error) pending.reject(new Error(message.error.message));
  else pending.resolve(message.result);
});

function command(method, params = {}) {
  commandId += 1;
  const id = commandId;
  socket.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => {
    pendingCommands.set(id, { reject, resolve });
  });
}

async function evaluate(expression) {
  const result = await command("Runtime.evaluate", {
    awaitPromise: true,
    expression,
    returnByValue: true,
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.text ?? "Browser evaluation failed.");
  }
  return result.result.value;
}

async function navigate(url) {
  await command("Page.navigate", { url });
  await delay(2500);
}

async function poll(expression, predicate, timeout = 15000) {
  const startedAt = Date.now();
  let value;
  while (Date.now() - startedAt < timeout) {
    value = await evaluate(expression);
    if (predicate(value)) return value;
    await delay(500);
  }
  return value;
}

await command("Page.enable");
await command("Runtime.enable");

const results = [];
for (const [path, embedUrl] of youtubeCases) {
  await navigate(`http://127.0.0.1:${harnessPort}${path}`);
  const telemetry = await poll(
    "window.providerDiagnostic",
    (value) => value?.state === 1 && value?.currentTime > 0.5,
    20000,
  );
  results.push({
    actualPlaybackConfirmed:
      telemetry?.state === 1 && telemetry?.currentTime > 0.5,
    audioOutput:
      telemetry?.state === 1 && telemetry?.muted === false && telemetry?.volume > 0
        ? "provider playing, unmuted, volume above zero; physical output not observable"
        : "not verified",
    embedUrl,
    name: path.slice(1),
    telemetry,
  });
}

const externalCases = [
  {
    name: "spotify-track",
    url: "https://open.spotify.com/embed/track/4uLU6hMCjMI75M1A2tKUQC?utm_source=generator&theme=0",
  },
  {
    name: "soundcloud-track",
    url: "https://w.soundcloud.com/player/?url=https%3A%2F%2Fsoundcloud.com%2Fforss%2Fflickermood&color=%23c8ff4f&auto_play=false&hide_related=true&show_comments=false&show_user=true&show_reposts=false&visual=true",
  },
];

for (const providerCase of externalCases) {
  await navigate(providerCase.url);
  const before = await evaluate(`(() => ({
    audio: [...document.querySelectorAll("audio")].map((item) => ({
      currentTime: item.currentTime,
      duration: item.duration,
      muted: item.muted,
      paused: item.paused,
      volume: item.volume
    })),
    bodyText: document.body?.innerText?.slice(0, 500) ?? "",
    buttons: [...document.querySelectorAll("button, [role=button]")].map((item) => ({
      ariaLabel: item.getAttribute("aria-label"),
      className: String(item.className),
      text: item.textContent?.trim().slice(0, 80) ?? "",
      title: item.getAttribute("title")
    })).slice(0, 30)
  }))()`);

  const clickResult = await evaluate(`(() => {
    const controls = [...document.querySelectorAll("button, [role=button], .playButton")];
    const describe = (item) => [
      item.getAttribute("aria-label"),
      item.getAttribute("title"),
      item.textContent,
      String(item.className)
    ].filter(Boolean).join(" ").trim().toLowerCase();
    const control = controls.find((item) => {
      const label = [
        item.getAttribute("aria-label"),
        item.getAttribute("title"),
        item.textContent
      ].filter(Boolean).join(" ").trim().toLowerCase();
      return label === "play";
    }) || controls.find((item) => {
      const label = describe(item);
      return label.includes("play") && !label.includes("playlist");
    });
    if (!control) return { clicked: false, label: null };
    control.click();
    return {
      clicked: true,
      label: control.getAttribute("aria-label") || control.getAttribute("title") || control.textContent || String(control.className)
    };
  })()`);
  await delay(5000);
  const after = await evaluate(`(() => ({
    audio: [...document.querySelectorAll("audio")].map((item) => ({
      currentTime: item.currentTime,
      duration: item.duration,
      muted: item.muted,
      paused: item.paused,
      volume: item.volume
    })),
    bodyText: document.body?.innerText?.slice(0, 500) ?? "",
    buttons: [...document.querySelectorAll("button, [role=button]")].map((item) => ({
      ariaLabel: item.getAttribute("aria-label"),
      className: String(item.className),
      text: item.textContent?.trim().slice(0, 80) ?? "",
      title: item.getAttribute("title")
    })).slice(0, 30),
    mediaSessionPlaybackState: navigator.mediaSession?.playbackState ?? "unavailable",
    progress: [...document.querySelectorAll("[role=progressbar], [aria-valuenow]")].map((item) => ({
      ariaValueNow: item.getAttribute("aria-valuenow"),
      ariaValueText: item.getAttribute("aria-valuetext")
    })).slice(0, 10)
  }))()`);
  results.push({
    after,
    before,
    clickResult,
    name: providerCase.name,
    url: providerCase.url,
  });
}

console.log(JSON.stringify(results, null, 2));

socket.close();
chrome.kill();
await Promise.race([
  new Promise((resolve) => chrome.once("exit", resolve)),
  delay(3000),
]);
await new Promise((resolve) => server.close(resolve));
for (let attempt = 0; attempt < 5; attempt += 1) {
  try {
    await rm(profileDirectory, { force: true, recursive: true });
    break;
  } catch (error) {
    if (attempt === 4) {
      console.warn(`Could not remove temporary Chrome profile: ${error.message}`);
      break;
    }
    await delay(500);
  }
}
