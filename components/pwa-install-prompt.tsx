"use client";

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
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
  refreshing: boolean;
  updateAvailable: boolean;
  requestInstall: () => Promise<void>;
  dismissInstructions: () => void;
  dismissUpdate: () => void;
  refreshApp: () => void;
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
  const [refreshing, setRefreshing] = useState(false);
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const updateDismissedRef = useRef(false);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const standalone = isStandaloneMode();
    const serviceWorkerSupported = "serviceWorker" in navigator;
    const hadControllerOnLoad =
      serviceWorkerSupported && Boolean(navigator.serviceWorker.controller);
    let removeUpdateListener: (() => void) | undefined;
    let cancelled = false;

    const notifyUpdateAvailable = () => {
      if (!hadControllerOnLoad || updateDismissedRef.current || cancelled) return;
      setUpdateAvailable(true);
    };

    const watchRegistration = (registration: ServiceWorkerRegistration) => {
      const onUpdateFound = () => {
        const worker = registration.installing;
        if (!worker) return;
        worker.addEventListener("statechange", () => {
          if (
            (worker.state === "installed" || worker.state === "activated") &&
            navigator.serviceWorker.controller
          ) {
            notifyUpdateAvailable();
          }
        });
      };

      registration.addEventListener("updatefound", onUpdateFound);
      if (registration.waiting && navigator.serviceWorker.controller) {
        notifyUpdateAvailable();
      }
      return () => registration.removeEventListener("updatefound", onUpdateFound);
    };

    setInstalled(standalone);
    document.documentElement.dataset.pwaStandalone = String(standalone);
    setIosSafari(isIosSafari());

    if (
      serviceWorkerSupported &&
      (window.location.protocol === "https:" ||
        window.location.hostname === "localhost")
    ) {
      const register = () => {
        navigator.serviceWorker
          .register("/service-worker.js", { scope: "/" })
          .then((registration) => {
            if (cancelled) return;
            removeUpdateListener?.();
            removeUpdateListener = watchRegistration(registration);
            registration.update().catch(() => undefined);
          })
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
    const onControllerChange = () => {
      if (navigator.serviceWorker.controller) notifyUpdateAvailable();
    };

    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    window.addEventListener("appinstalled", onInstalled);
    if (serviceWorkerSupported) {
      navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);
    }
    const media = window.matchMedia("(display-mode: standalone)");
    media.addEventListener("change", onDisplayModeChange);

    const instructionTimer = window.setTimeout(() => {
      if (!recentlyDismissed() && !isStandaloneMode()) {
        setVisible(true);
      }
    }, 1600);

    return () => {
      cancelled = true;
      window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
      window.removeEventListener("appinstalled", onInstalled);
      if (serviceWorkerSupported) {
        navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
      }
      media.removeEventListener("change", onDisplayModeChange);
      window.clearTimeout(instructionTimer);
      removeUpdateListener?.();
    };
  }, []);

  const dismissInstructions = useCallback(() => {
    markDismissed();
    setVisible(false);
  }, []);

  const dismissUpdate = useCallback(() => {
    updateDismissedRef.current = true;
    setUpdateAvailable(false);
  }, []);

  const refreshApp = useCallback(() => {
    setRefreshing(true);
    window.location.reload();
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
      refreshing,
      updateAvailable,
      requestInstall,
      dismissInstructions,
      dismissUpdate,
      refreshApp,
    }),
    [
      dismissInstructions,
      dismissUpdate,
      installed,
      installing,
      iosSafari,
      promptEvent,
      refreshApp,
      refreshing,
      requestInstall,
      updateAvailable,
    ],
  );

  return (
    <PwaInstallContext.Provider value={value}>
      {children}
      <PwaInstallPrompt visible={visible} />
      <PwaUpdatePrompt visible={installed && updateAvailable} />
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
  iconOnly = false,
  locale = "en",
  onAfterRequest,
}: {
  className?: string;
  compact?: boolean;
  iconOnly?: boolean;
  locale?: InterfaceLocale;
  onAfterRequest?: () => void;
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
      onClick={() => {
        void requestInstall();
        onAfterRequest?.();
      }}
      title={hint}
      type="button"
    >
      <Smartphone size={compact ? 15 : 16} />
      {!iconOnly && (
        <span>{installing ? (spanish ? "Instalando..." : "Installing...") : label}</span>
      )}
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

function PwaUpdatePrompt({ visible }: { visible: boolean }) {
  const { dismissUpdate, refreshApp, refreshing } = usePwaInstall();

  if (!visible) return null;

  return (
    <aside className="pwa-update-card" aria-live="polite">
      <div className="pwa-install-icon" aria-hidden="true">
        <Download size={20} />
      </div>
      <div>
        <strong>Nueva versión disponible</strong>
        <span>Actualiza First Listen para obtener mejoras recientes.</span>
      </div>
      <div className="pwa-update-actions">
        <button disabled={refreshing} onClick={refreshApp} type="button">
          {refreshing ? "Actualizando..." : "Actualizar"}
        </button>
        <button onClick={dismissUpdate} type="button">
          Más tarde
        </button>
      </div>
    </aside>
  );
}
