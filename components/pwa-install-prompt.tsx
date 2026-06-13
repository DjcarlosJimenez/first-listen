"use client";

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { Download, Share2, Smartphone, X } from "lucide-react";
import type { InterfaceLocale } from "@/lib/catalog";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};

type PwaInstallContextValue = {
  installed: boolean;
  installing: boolean;
  iosSafari: boolean;
  nativePromptAvailable: boolean;
  requestInstall: () => Promise<void>;
  dismissInstructions: () => void;
};

const PwaInstallContext = createContext<PwaInstallContextValue | null>(null);

const DISMISS_KEY = "first-listen-install-dismissed-at";
const DISMISS_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

function isStandaloneMode() {
  if (typeof window === "undefined") return false;
  const navigatorWithStandalone = window.navigator as Navigator & {
    standalone?: boolean;
  };
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    navigatorWithStandalone.standalone === true
  );
}

function isIosSafari() {
  if (typeof window === "undefined") return false;
  const userAgent = window.navigator.userAgent;
  const platform = window.navigator.platform;
  const touchPoints = window.navigator.maxTouchPoints;
  const isiOS =
    /iPad|iPhone|iPod/.test(userAgent) ||
    (platform === "MacIntel" && touchPoints > 1);
  const isSafari =
    /Safari/.test(userAgent) &&
    !/CriOS|FxiOS|EdgiOS|OPiOS/.test(userAgent);
  return isiOS && isSafari;
}

function recentlyDismissed() {
  try {
    const value = window.localStorage.getItem(DISMISS_KEY);
    if (!value) return false;
    const dismissedAt = Number(value);
    return Number.isFinite(dismissedAt) && Date.now() - dismissedAt < DISMISS_WINDOW_MS;
  } catch {
    return false;
  }
}

function markDismissed() {
  try {
    window.localStorage.setItem(DISMISS_KEY, String(Date.now()));
  } catch {
    // Some private browsing modes can block localStorage. The prompt can still hide for this session.
  }
}

export function PwaInstallProvider({ children }: { children: ReactNode }) {
  const [promptEvent, setPromptEvent] =
    useState<BeforeInstallPromptEvent | null>(null);
  const [visible, setVisible] = useState(false);
  const [iosSafari, setIosSafari] = useState(false);
  const [installed, setInstalled] = useState(false);
  const [installing, setInstalling] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const standalone = isStandaloneMode();
    setInstalled(standalone);
    document.documentElement.dataset.pwaStandalone = String(standalone);
    setIosSafari(isIosSafari());

    if (
      "serviceWorker" in navigator &&
      (window.location.protocol === "https:" ||
        window.location.hostname === "localhost")
    ) {
      const register = () => {
        navigator.serviceWorker
          .register("/service-worker.js", { scope: "/" })
          .catch(() => undefined);
      };
      if (document.readyState === "complete") register();
      else window.addEventListener("load", register, { once: true });
    }

    const onBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setPromptEvent(event as BeforeInstallPromptEvent);
      if (!recentlyDismissed() && !isStandaloneMode()) setVisible(true);
    };
    const onInstalled = () => {
      setInstalled(true);
      setVisible(false);
      setPromptEvent(null);
      document.documentElement.dataset.pwaStandalone = "true";
    };
    const onDisplayModeChange = (event: MediaQueryListEvent) => {
      setInstalled(event.matches);
      document.documentElement.dataset.pwaStandalone = String(event.matches);
      if (event.matches) setVisible(false);
    };

    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    window.addEventListener("appinstalled", onInstalled);
    const media = window.matchMedia("(display-mode: standalone)");
    media.addEventListener("change", onDisplayModeChange);

    const instructionTimer = window.setTimeout(() => {
      if (!recentlyDismissed() && !isStandaloneMode()) {
        setVisible(true);
      }
    }, 1600);

    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
      window.removeEventListener("appinstalled", onInstalled);
      media.removeEventListener("change", onDisplayModeChange);
      window.clearTimeout(instructionTimer);
    };
  }, []);

  const dismissInstructions = useCallback(() => {
    markDismissed();
    setVisible(false);
  }, []);

  const requestInstall = useCallback(async () => {
    if (installed) return;
    if (!promptEvent) {
      setVisible(true);
      return;
    }
    setInstalling(true);
    await promptEvent.prompt();
    const choice = await promptEvent.userChoice;
    setInstalling(false);
    setPromptEvent(null);
    if (choice.outcome === "accepted") {
      setInstalled(true);
      setVisible(false);
      document.documentElement.dataset.pwaStandalone = "true";
      return;
    }
    setVisible(true);
  }, [installed, promptEvent]);

  const value = useMemo<PwaInstallContextValue>(
    () => ({
      installed,
      installing,
      iosSafari,
      nativePromptAvailable: Boolean(promptEvent),
      requestInstall,
      dismissInstructions,
    }),
    [dismissInstructions, installed, installing, iosSafari, promptEvent, requestInstall],
  );

  return (
    <PwaInstallContext.Provider value={value}>
      {children}
      <PwaInstallPrompt visible={visible} />
    </PwaInstallContext.Provider>
  );
}

function usePwaInstall() {
  const value = useContext(PwaInstallContext);
  if (!value) {
    throw new Error("PwaInstall components must be used inside PwaInstallProvider.");
  }
  return value;
}

export function PwaInstallButton({
  className = "pwa-header-install-button",
  compact = false,
  locale = "en",
}: {
  className?: string;
  compact?: boolean;
  locale?: InterfaceLocale;
}) {
  const { installed, installing, nativePromptAvailable, requestInstall } =
    usePwaInstall();
  if (installed) return null;

  const spanish = locale === "es";
  const label = spanish ? "Instalar First Listen" : "Install First Listen";
  const hint = nativePromptAvailable
    ? spanish
      ? "Abrir instalacion de la app"
      : "Open app install prompt"
    : spanish
      ? "Mostrar instrucciones para instalar"
      : "Show install instructions";

  return (
    <button
      aria-label={label}
      className={className}
      disabled={installing}
      onClick={() => void requestInstall()}
      title={hint}
      type="button"
    >
      <Smartphone size={compact ? 15 : 16} />
      <span>{installing ? (spanish ? "Instalando..." : "Installing...") : label}</span>
    </button>
  );
}

function PwaInstallPrompt({ visible }: { visible: boolean }) {
  const {
    dismissInstructions,
    installed,
    installing,
    iosSafari,
    nativePromptAvailable,
    requestInstall,
  } = usePwaInstall();

  if (installed || !visible) return null;

  return (
    <aside className="pwa-install-card" aria-live="polite">
      <div className="pwa-install-icon" aria-hidden="true">
        <Smartphone size={20} />
      </div>
      <div>
        <strong>Install First Listen</strong>
        {nativePromptAvailable ? (
          <span>
            Add the First Listen icon to your home screen and reopen the app
            without searching for the website.
          </span>
        ) : iosSafari ? (
          <span>
            On iPhone or iPad, tap Share <Share2 size={13} /> then Add to Home
            Screen.
          </span>
        ) : (
          <span>
            Use your browser menu to install First Listen or add it to your
            home screen. Chrome and Samsung Internet may also show an Install
            button here.
          </span>
        )}
      </div>
      <div className="pwa-install-actions">
        {nativePromptAvailable ? (
          <button disabled={installing} onClick={() => void requestInstall()} type="button">
            <Download size={14} /> {installing ? "Installing..." : "Install"}
          </button>
        ) : (
          <button onClick={dismissInstructions} type="button">
            Got it
          </button>
        )}
        <button
          aria-label="Dismiss install prompt"
          onClick={dismissInstructions}
          type="button"
        >
          <X size={14} />
        </button>
      </div>
    </aside>
  );
}
