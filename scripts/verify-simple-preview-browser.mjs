import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const chromePath = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const baseUrl = process.env.FIRST_LISTEN_TEST_URL || "http://127.0.0.1:3012/guest";
const screenshotDirectory = process.env.FIRST_LISTEN_SCREENSHOT_DIR;
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
  await client.call("Network.enable");
  await client.call("Network.setBypassServiceWorker", { bypass: true });
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

  const captureScreenshot = async (name) => {
    if (!screenshotDirectory) return;
    await mkdir(screenshotDirectory, { recursive: true });
    const result = await client.call("Page.captureScreenshot", {
      captureBeyondViewport: false,
      format: "png",
    });
    await writeFile(join(screenshotDirectory, name), result.data, "base64");
  };

  try {
    await eventually(
      () => evaluate("Boolean(document.querySelector('.first-listen-simple-new-row'))"),
      "The First Listen guest experience did not finish loading.",
    );
  } catch (error) {
    const loadingDiagnostic = await evaluate(`(() => ({
      body: document.body?.innerText?.slice(0, 800) || '',
      title: document.title,
      url: location.href,
    }))()`);
    throw new Error(
      `The First Listen guest experience did not finish loading: ${JSON.stringify(loadingDiagnostic)}`,
      { cause: error },
    );
  }

  await eventually(
    () =>
      evaluate(`(() => {
        const publish = document.querySelector('.first-listen-simple-artist-link');
        const rotation = document.querySelector('.first-listen-simple-new-today');
        const continuous = document.querySelector('.first-listen-simple-listening-options button');
        return Boolean(
          publish &&
          rotation &&
          (publish.compareDocumentPosition(rotation) & Node.DOCUMENT_POSITION_FOLLOWING) &&
          continuous?.getAttribute('aria-pressed') === 'true'
        );
      })()`),
    "The publish callout was not above rotation or continuous play was not enabled by default.",
  );

  const styleTarget = await evaluate(`(() => {
    const buttons = [...document.querySelectorAll('.first-listen-simple-style-row button')];
    const firstCategory = document.querySelector('.first-listen-simple-new-row button small')?.textContent?.trim().toLowerCase();
    const button = buttons.slice(1).find((candidate) => candidate.textContent?.trim().toLowerCase() !== firstCategory) ?? buttons[1];
    button?.scrollIntoView({ block: 'center', inline: 'center' });
    const rect = button?.getBoundingClientRect();
    return rect && button?.textContent ? {
      label: button.textContent.trim(),
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
    } : null;
  })()`);
  if (!styleTarget) throw new Error("A music style filter was not available.");
  await client.call("Input.dispatchMouseEvent", {
    button: "left",
    clickCount: 1,
    type: "mousePressed",
    x: styleTarget.x,
    y: styleTarget.y,
  });
  await client.call("Input.dispatchMouseEvent", {
    button: "left",
    clickCount: 1,
    type: "mouseReleased",
    x: styleTarget.x,
    y: styleTarget.y,
  });
  await eventually(
    () =>
      evaluate(`(() => {
        const normalize = (value) => value?.trim().toLocaleLowerCase();
        const cards = [...document.querySelectorAll('.first-listen-simple-new-row button')];
        const firstTitle = cards[0]?.querySelector('strong')?.textContent?.trim();
        const activeTitle = document.querySelector('.first-listen-simple-song-heading strong')?.textContent?.trim();
        const categoriesMatch = cards.length > 0 && cards.every((card) =>
          normalize(card.querySelector('small')?.textContent) === normalize(${JSON.stringify(styleTarget.label)})
        );
        const autoplayRequested = document.querySelector('.first-listen-simple-player-frame iframe')?.src?.includes('autoplay=1');
        return categoriesMatch && activeTitle === firstTitle && autoplayRequested;
      })()`),
    `Selecting ${styleTarget.label} did not replace the covers and start its first fair-rotation song.`,
  );
  await evaluate("document.querySelector('.first-listen-simple-style-row button')?.click(); true");

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

  const initialCarouselPosition = await evaluate(
    "document.querySelector('.first-listen-simple-new-row')?.scrollLeft ?? 0",
  );
  await evaluate(
    "document.querySelector('.first-listen-simple-carousel-navigation button:last-child')?.click(); true",
  );
  await eventually(
    () =>
      evaluate(
        `document.querySelector('.first-listen-simple-new-row')?.scrollLeft > ${initialCarouselPosition + 20}`,
      ),
    "The desktop rotation arrows did not move the song carousel.",
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

  const fullscreenButtonReady = await evaluate(`(() => {
    const frame = document.querySelector('.first-listen-simple-player-frame');
    const button = frame?.querySelector('.first-listen-simple-fullscreen-exit');
    return Boolean(button && button.getAttribute('aria-label'));
  })()`);
  if (!fullscreenButtonReady) {
    throw new Error("The full-screen minimize button was not available inside the player.");
  }

  const fullscreenRequest = await client.call("Runtime.evaluate", {
    awaitPromise: true,
    expression: "document.querySelector('.first-listen-simple-player-frame')?.requestFullscreen()",
    returnByValue: true,
    userGesture: true,
  });
  const enteredFullscreen =
    !fullscreenRequest.exceptionDetails &&
    (await evaluate(
      "document.fullscreenElement?.classList.contains('first-listen-simple-player-frame')",
    ));

  if (enteredFullscreen) {
    await evaluate(
      "document.querySelector('.first-listen-simple-fullscreen-exit')?.click(); true",
    );
    await eventually(
      () => evaluate("!document.fullscreenElement"),
      "The custom minimize button did not leave full screen.",
    );
  } else {
    const fallbackExitWorks = await evaluate(`(() => {
      window.__firstListenExitFullscreenCalled = false;
      const originalExit = document.exitFullscreen;
      Object.defineProperty(document, 'exitFullscreen', {
        configurable: true,
        value: () => {
          window.__firstListenExitFullscreenCalled = true;
          return Promise.resolve();
        },
      });
      document.querySelector('.first-listen-simple-fullscreen-exit')?.click();
      const worked = window.__firstListenExitFullscreenCalled;
      Object.defineProperty(document, 'exitFullscreen', {
        configurable: true,
        value: originalExit,
      });
      return worked;
    })()`);
    if (!fallbackExitWorks) {
      throw new Error("The custom minimize button did not invoke the full-screen exit API.");
    }
  }

  await evaluate("window.scrollTo(0, 0); true");
  await eventually(
    () =>
      evaluate(
        "Boolean(document.querySelector('.first-listen-simple-player-card.is-docked'))",
      ),
    "The player did not remain visible in desktop mini-player mode.",
  );
  await evaluate(
    "document.querySelector('.first-listen-simple-player-card.is-docked .first-listen-simple-controls button:nth-child(2)')?.click(); true",
  );
  await eventually(
    () =>
      evaluate(
        "document.querySelector('.first-listen-simple-player-card.is-docked .first-listen-simple-controls button:nth-child(2)')?.getAttribute('aria-pressed') === 'true'",
      ),
    "Pause did not remain accessible in the desktop mini-player.",
  );
  await captureScreenshot("desktop-floating-player.png");

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
    () =>
      evaluate(
        "document.querySelectorAll('.first-listen-simple-new-row button').length > 0",
      ),
    "The mobile First Listen experience did not finish loading.",
  );
  const mobileNavigationState = await evaluate(`(() => {
    const navigation = document.querySelector('.first-listen-simple-carousel-navigation');
    const matchingRules = [];
    for (const sheet of document.styleSheets) {
      try {
        for (const rule of sheet.cssRules) {
          if (rule.cssText?.includes('first-listen-simple-carousel-navigation')) {
            matchingRules.push(rule.cssText);
          }
          if (rule.cssRules) {
            for (const nestedRule of rule.cssRules) {
              if (nestedRule.cssText?.includes('first-listen-simple-carousel-navigation')) {
                matchingRules.push(String(rule.conditionText || 'nested') + ' => ' + nestedRule.cssText);
              }
            }
          }
        }
      } catch {}
    }
    return {
      innerWidth: window.innerWidth,
      navigationDisplay: navigation ? getComputedStyle(navigation).display : 'absent',
      styleFilters: Boolean(document.querySelector('.first-listen-simple-rotation-styles')),
      matchingRules,
    };
  })()`);
  if (
    mobileNavigationState.navigationDisplay !== "none" &&
    mobileNavigationState.navigationDisplay !== "absent"
  ) {
    throw new Error(
      `Mobile still showed carousel arrows: ${JSON.stringify(mobileNavigationState)}`,
    );
  }
  if (!mobileNavigationState.styleFilters) {
    throw new Error(
      `Mobile did not show the relocated style filters: ${JSON.stringify(mobileNavigationState)}`,
    );
  }
  const mobileCardCount = await evaluate(
    "document.querySelectorAll('.first-listen-simple-new-row button').length",
  );
  const mobileSong = await clickRotationCard(Math.min(2, Math.max(0, mobileCardCount - 1)));
  await evaluate("window.scrollTo(0, 0); true");
  await eventually(
    () =>
      evaluate(`(() => {
        const player = document.querySelector('.first-listen-simple-player-card.is-docked');
        const navigation = document.querySelector('.first-listen-simple-mobile-nav');
        if (!player || !navigation) return false;
        const playerBounds = player.getBoundingClientRect();
        const navigationBounds = navigation.getBoundingClientRect();
        return playerBounds.bottom <= navigationBounds.top + 2;
      })()`),
    "The mobile mini-player was missing or overlapped the bottom navigation.",
  );
  await captureScreenshot("mobile-floating-player.png");

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
