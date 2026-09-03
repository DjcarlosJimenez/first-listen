"use client";

import Image from "next/image";
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
import { usePathname } from "next/navigation";
import { Download, Share2, Smartphone, X } from "lucide-react";
import type { InterfaceLocale } from "@/lib/catalog";
import { useInterfaceLocale } from "@/lib/use-interface-locale";

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
const DJ_CARLOS_DISMISS_KEY = `${DISMISS_KEY}:dj-carlos`;
const SESSION_PROMPT_KEY = "first-listen-install-shown-session";
const DJ_CARLOS_SESSION_PROMPT_KEY = `${SESSION_PROMPT_KEY}:dj-carlos`;
const DISMISS_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const INSTALL_INSTRUCTION_DELAY_MS = 45000;
const ARTIST_INSTALL_INSTRUCTION_DELAY_MS = 2500;
const UPDATE_REMINDER_MS = 10 * 60 * 1000;
const DJ_CARLOS_PATH_PREFIX = "/DJCarlosJimenez";
const DJ_CARLOS_ICON_URL = "/artist/dj-carlos-jimenez/icon-192.png";

type InstallPromptBrand = {
  actionLabel: string;
  cardClassName: string;
  iconUrl: string | null;
  iosInstruction: ReactNode;
  manualInstruction: string;
  nativeInstruction: string;
  title: string;
};

function isDjCarlosPath(pathname: string | null) {
  return (
    pathname?.toLocaleLowerCase("en-US").startsWith(
      DJ_CARLOS_PATH_PREFIX.toLocaleLowerCase("en-US"),
    ) ?? false
  );
}

function installPromptBrandFor(pathname: string | null, spanish: boolean): InstallPromptBrand {
  const artistPage = isDjCarlosPath(pathname);
  if (artistPage) {
    return {
      actionLabel: spanish ? "Instalar DJ Carlos" : "Install DJ Carlos",
      cardClassName: "pwa-install-card djcx-pwa-install-card",
      iconUrl: DJ_CARLOS_ICON_URL,
      iosInstruction: (
        <>
          {spanish ? "En iPhone o iPad, toca Compartir" : "On iPhone or iPad, tap Share"}{" "}
          <Share2 size={13} />{" "}
          {spanish
            ? "y luego Agregar a inicio para entrar facil y rapido a DJ Carlos."
            : "then Add to Home Screen for fast access to DJ Carlos."}
        </>
      ),
      manualInstruction: spanish
        ? "Instala un acceso directo para entrar facil y rapido a la pagina de DJ Carlos."
        : "Install a shortcut for fast access to the DJ Carlos page.",
      nativeInstruction: spanish
        ? "Instala un acceso directo con el logo de DJ Carlos para entrar facil y rapido a su pagina."
        : "Install a shortcut with your logo to open DJ Carlos quickly.",
      title: spanish ? "Instalar DJ Carlos" : "Install DJ Carlos",
    };
  }

  return {
    actionLabel: spanish ? "Instalar" : "Install",
    cardClassName: "pwa-install-card",
    iconUrl: null,
    iosInstruction: (
      <>
        {spanish ? "En iPhone o iPad, toca Compartir" : "On iPhone or iPad, tap Share"}{" "}
        <Share2 size={13} />{" "}
        {spanish ? "y luego Agregar a inicio." : "then Add to Home Screen."}
      </>
    ),
    manualInstruction: spanish
      ? "Usa el menú del navegador para instalar o agregar First Listen."
      : "Use your browser menu to install or add First Listen.",
    nativeInstruction: spanish
      ? "Agrega First Listen a tu pantalla de inicio para volver más rápido."
      : "Add First Listen to your home screen and return faster.",
    title: spanish ? "Instalar First Listen" : "Install First Listen",
  };
}

async function readServiceWorkerVersion() {
  try {
    const response = await fetch(`/service-worker.js?version-check=${Date.now()}`, {
      cache: "no-store",
    });
    if (!response.ok) return null;
    const source = await response.text();
    const match = source.match(/CACHE_VERSION\s*=\s*["']([^"']+)["']/);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

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

function recentlyDismissed(key = DISMISS_KEY) {
  try {
    const value = window.localStorage.getItem(key);
    if (!value) return false;
    const dismissedAt = Number(value);
    return Number.isFinite(dismissedAt) && Date.now() - dismissedAt < DISMISS_WINDOW_MS;
  } catch {
    return false;
  }
}

function markDismissed(key = DISMISS_KEY) {
  try {
    window.localStorage.setItem(key, String(Date.now()));
  } catch {
    // Some private browsing modes can block localStorage. The prompt can still hide for this session.
  }
}

function alreadyShownThisSession(key: string) {
  try {
    return window.sessionStorage.getItem(key) === "true";
  } catch {
    return false;
  }
}

function markShownThisSession(key: string) {
  try {
    window.sessionStorage.setItem(key, "true");
  } catch {
    // sessionStorage can be blocked; the visible state still prevents repeated prompts.
  }
}

export function PwaInstallProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [promptEvent, setPromptEvent] =
    useState<BeforeInstallPromptEvent | null>(null);
  const [visible, setVisible] = useState(false);
  const [iosSafari, setIosSafari] = useState(false);
  const [installed, setInstalled] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const updateVersionRef = useRef<string | null>(null);
  const updateReminderTimerRef = useRef<number | null>(null);

  const clearUpdateReminder = useCallback(() => {
    if (updateReminderTimerRef.current === null) return;
    window.clearTimeout(updateReminderTimerRef.current);
    updateReminderTimerRef.current = null;
  }, []);

  const showUpdateAvailable = useCallback(
    (version: string | null = null) => {
      if (version && version !== updateVersionRef.current) {
        updateVersionRef.current = version;
      }
      clearUpdateReminder();
      setUpdateAvailable(true);
    },
    [clearUpdateReminder],
  );

  useEffect(() => {
    if (typeof window === "undefined") return;

    const standalone = isStandaloneMode();
    const serviceWorkerSupported = "serviceWorker" in navigator;
    const hadControllerOnLoad =
      serviceWorkerSupported && Boolean(navigator.serviceWorker.controller);
    let removeUpdateListener: (() => void) | undefined;
    let cancelled = false;

    const notifyUpdateAvailable = () => {
      if (!hadControllerOnLoad || cancelled) return;
      void readServiceWorkerVersion().then((version) => {
        if (cancelled) return;
        showUpdateAvailable(version);
      });
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
    const onFocus = () => {
      if (updateVersionRef.current && !document.hidden) {
        showUpdateAvailable(updateVersionRef.current);
      }
    };

    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    window.addEventListener("appinstalled", onInstalled);
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    if (serviceWorkerSupported) {
      navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);
    }
    const media = window.matchMedia("(display-mode: standalone)");
    media.addEventListener("change", onDisplayModeChange);

    return () => {
      cancelled = true;
      clearUpdateReminder();
      window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
      window.removeEventListener("appinstalled", onInstalled);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
      if (serviceWorkerSupported) {
        navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
      }
      media.removeEventListener("change", onDisplayModeChange);
      removeUpdateListener?.();
    };
  }, [clearUpdateReminder, showUpdateAvailable]);

  useEffect(() => {
    if (typeof window === "undefined" || isStandaloneMode()) return;

    const artistPage = isDjCarlosPath(pathname);
    const dismissKey = artistPage ? DJ_CARLOS_DISMISS_KEY : DISMISS_KEY;
    if (
      recentlyDismissed(dismissKey) ||
      (artistPage && alreadyShownThisSession(DJ_CARLOS_SESSION_PROMPT_KEY))
    ) {
      return;
    }

    if (artistPage) {
      markShownThisSession(DJ_CARLOS_SESSION_PROMPT_KEY);
    }

    const delay = artistPage
      ? ARTIST_INSTALL_INSTRUCTION_DELAY_MS
      : INSTALL_INSTRUCTION_DELAY_MS;
    const instructionTimer = window.setTimeout(() => {
      if (!recentlyDismissed(dismissKey) && !isStandaloneMode()) {
        setVisible(true);
      }
    }, delay);

    return () => window.clearTimeout(instructionTimer);
  }, [pathname]);

  const dismissInstructions = useCallback(() => {
    markDismissed(isDjCarlosPath(pathname) ? DJ_CARLOS_DISMISS_KEY : DISMISS_KEY);
    setVisible(false);
  }, [pathname]);

  const dismissUpdate = useCallback(() => {
    setUpdateAvailable(false);
    clearUpdateReminder();
    updateReminderTimerRef.current = window.setTimeout(() => {
      setUpdateAvailable(true);
      updateReminderTimerRef.current = null;
    }, UPDATE_REMINDER_MS);
  }, [clearUpdateReminder]);

  const refreshApp = useCallback(() => {
    clearUpdateReminder();
    setRefreshing(true);
    window.location.reload();
  }, [clearUpdateReminder]);

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
  label,
  locale = "en",
  onAfterRequest,
}: {
  className?: string;
  compact?: boolean;
  iconOnly?: boolean;
  label?: string;
  locale?: InterfaceLocale;
  onAfterRequest?: () => void;
}) {
  const { installed, installing, nativePromptAvailable, requestInstall } =
    usePwaInstall();
  const pathname = usePathname();
  if (installed) return null;

  const spanish = locale === "es" || isDjCarlosPath(pathname);
  const buttonLabel = label ?? (spanish ? "Instalar First Listen" : "Install First Listen");
  const hint = nativePromptAvailable
    ? spanish
      ? "Abrir instalación de la app"
      : "Open app install prompt"
    : spanish
      ? "Mostrar instrucciones para instalar"
      : "Show install instructions";

  return (
    <button
      aria-label={buttonLabel}
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
        <span>{installing ? (spanish ? "Instalando..." : "Installing...") : buttonLabel}</span>
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
  const locale = useInterfaceLocale();
  const pathname = usePathname();
  const spanish = locale === "es" || isDjCarlosPath(pathname);
  const brand = installPromptBrandFor(pathname, spanish);

  if (installed || !visible) return null;

  return (
    <aside className={brand.cardClassName} aria-live="polite">
      <div className="pwa-install-icon" aria-hidden="true">
        {brand.iconUrl ? (
          <Image alt="" height={40} src={brand.iconUrl} unoptimized width={40} />
        ) : (
          <Smartphone size={20} />
        )}
      </div>
      <div>
        <strong>{brand.title}</strong>
        {nativePromptAvailable ? (
          <span>{brand.nativeInstruction}</span>
        ) : iosSafari ? (
          <span>{brand.iosInstruction}</span>
        ) : (
          <span>{brand.manualInstruction}</span>
        )}
      </div>
      <div className="pwa-install-actions">
        {nativePromptAvailable ? (
          <button disabled={installing} onClick={() => void requestInstall()} type="button">
            <Download size={14} />{" "}
            {installing
              ? spanish
                ? "Instalando..."
                : "Installing..."
              : brand.actionLabel}
          </button>
        ) : (
          <button onClick={dismissInstructions} type="button">
            {spanish ? "Entendido" : "Got it"}
          </button>
        )}
        <button
          aria-label={spanish ? "Cerrar aviso de instalación" : "Dismiss install prompt"}
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
        <strong>🚀 Nueva versión disponible</strong>
        <span>Actualiza First Listen para obtener mejoras recientes.</span>
      </div>
      <div className="pwa-update-actions">
        <button disabled={refreshing} onClick={refreshApp} type="button">
          {refreshing ? "Actualizando..." : "Actualizar ahora"}
        </button>
        <button onClick={dismissUpdate} type="button">
          Más tarde
        </button>
      </div>
    </aside>
  );
}
