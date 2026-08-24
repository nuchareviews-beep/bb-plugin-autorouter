import { useEffect, useRef, useState, type CSSProperties } from "react";
import {
  definePluginApp,
  experimental_NewThreadComposer as NewThreadComposer,
  useBbContext,
  useBbNavigate,
  useRealtime,
  useRpc,
} from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import type { ModelCatalog, rpcContract } from "./server";
import type { RoutedThreadResult } from "./router";
import type { AutorouterSettings } from "./settings";
import { Input } from "@/components/ui/input";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Icon } from "@/components/ui/icon";
import {
  SELECTING_LABEL_BASE,
  SELECTING_LABEL_INTERVAL_MS,
  selectingLabel,
  toCssContentString,
} from "./selecting-label";
import "./autorouter.css";

const AUTO_ROUTER_COMPOSE_LAYOUT_CLASS =
  "mx-auto flex w-full max-w-[760px] flex-col px-4 pb-4 pt-14";

/**
 * Drives the picker label's dot cycle. Idle rounds hold no timer, so the page
 * is inert until a submission is actually being routed.
 */
function useSelectingLabel(active: boolean): string | null {
  const [tick, setTick] = useState(0);
  const reducedMotion = usePrefersReducedMotion();

  useEffect(() => {
    if (!active) {
      setTick(0);
      return;
    }
    if (reducedMotion) return;
    const timer = setInterval(
      () => setTick((previous) => previous + 1),
      SELECTING_LABEL_INTERVAL_MS,
    );
    return () => clearInterval(timer);
  }, [active, reducedMotion]);

  return active ? selectingLabel(tick, reducedMotion) : null;
}

function usePrefersReducedMotion(): boolean {
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReducedMotion(query.matches);
    const onChange = (event: MediaQueryListEvent) =>
      setReducedMotion(event.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  return reducedMotion;
}

function AutoRouterPage() {
  const { projectId } = useBbContext();
  const navigate = useBbNavigate();
  const rpc = useRpc<typeof rpcContract>();
  const [status, setStatus] = useState<
    | { kind: "idle" }
    | { kind: "selecting" }
    | { kind: "selected"; result: RoutedThreadResult }
    | { kind: "error"; message: string }
  >({ kind: "idle" });
  const selectingText = useSelectingLabel(status.kind === "selecting");

  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto">
      <div
        className={AUTO_ROUTER_COMPOSE_LAYOUT_CLASS}
        style={
          selectingText
            ? ({
                "--autorouter-picker-label": toCssContentString(selectingText),
              } as CSSProperties)
            : undefined
        }
      >
        <NewThreadComposer
          defaultProjectId={projectId ?? undefined}
          className="autorouter-composer"
          draftKey="autorouter-new-thread"
          layout="document"
          onSubmit={async (request) => {
            setStatus({ kind: "selecting" });
            try {
              const result = await rpc.call("createThread", { request });
              setStatus({ kind: "selected", result });
              navigate.toThread(result.threadId);
            } catch (error) {
              const message =
                error instanceof Error ? error.message : "Auto routing failed";
              setStatus({ kind: "error", message });
              toast.error(message);
              throw error;
            }
          }}
        />
        <div className="min-h-6 text-sm" aria-live="polite">
          {/*
            While routing, the visible status lives in the composer's picker
            button (see autorouter.css). The cycling dots would be read out on
            every frame, so assistive tech gets the announcement once, without
            them.
          */}
          {status.kind === "selecting" ? (
            <p className="sr-only">{`${SELECTING_LABEL_BASE}…`}</p>
          ) : null}
          {status.kind === "error" ? (
            <p className="mx-2 text-destructive">{status.message}</p>
          ) : null}
        </div>
      </div>
    </div>
  );
}

interface CatalogState {
  status: "loading" | "ready" | "failed";
  catalog: ModelCatalog | null;
}

function AutoRouterSettings() {
  const rpc = useRpc<typeof rpcContract>();
  const [settings, setSettings] = useState<AutorouterSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const settingsRef = useRef<AutorouterSettings | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveVersionRef = useRef(0);

  // Decision-agent model picker: same pattern as bb-plugin-prompt-enhancer's
  // ModelSettingsSection — fetch the live provider/model catalog once, offer
  // a searchable list instead of a free-text "provider/model" box.
  const [picker, setPicker] = useState<CatalogState>({
    status: "loading",
    catalog: null,
  });

  useEffect(() => {
    let cancelled = false;
    void rpc
      .call("listModels")
      .then((catalog) => {
        if (!cancelled) setPicker({ status: "ready", catalog });
      })
      .catch(() => {
        if (!cancelled) setPicker({ status: "failed", catalog: null });
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const load = () => {
    void rpc
      .call("getSettings")
      .then((next) => {
        settingsRef.current = next;
        setSettings(next);
        setError(null);
      })
      .catch((loadError) => {
        setError(
          loadError instanceof Error
            ? loadError.message
            : "Unable to load Autorouter settings",
        );
      });
  };

  useEffect(load, []);
  useRealtime("settings-changed", load);

  useEffect(
    () => () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
    },
    [],
  );

  const persist = (next: AutorouterSettings) => {
    const version = ++saveVersionRef.current;
    void rpc
      .call("updateSettings", next)
      .then((saved) => {
        if (version !== saveVersionRef.current) return;
        settingsRef.current = saved;
        setSettings(saved);
        setError(null);
      })
      .catch((saveError) => {
        if (version !== saveVersionRef.current) return;
        setError(
          saveError instanceof Error
            ? saveError.message
            : "Unable to save Autorouter settings",
        );
      });
  };

  const update = (
    patch: Partial<AutorouterSettings>,
    options: { debounceMs?: number } = {},
  ) => {
    if (!settingsRef.current) return;
    const next = { ...settingsRef.current, ...patch };
    settingsRef.current = next;
    setSettings(next);
    if (timerRef.current !== null) clearTimeout(timerRef.current);
    if (options.debounceMs) {
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        persist(settingsRef.current ?? next);
      }, options.debounceMs);
    } else {
      timerRef.current = null;
      persist(next);
    }
  };

  const flush = () => {
    if (timerRef.current === null || !settingsRef.current) return;
    clearTimeout(timerRef.current);
    timerRef.current = null;
    persist(settingsRef.current);
  };

  if (!settings) {
    return (
      <p
        className={
          error ? "text-sm text-destructive" : "text-sm text-muted-foreground"
        }
      >
        {error ?? "Loading settings…"}
      </p>
    );
  }

  return (
    <div className="space-y-6">
      <label className="flex items-start justify-between gap-4">
        <span>
          <span className="block text-sm font-medium">Enable Auto Router</span>
          <span className="block text-xs text-muted-foreground">
            Allow the extension page and CLI to create routed threads.
          </span>
        </span>
        <input
          type="checkbox"
          className="mt-1 size-4 accent-primary"
          checked={settings.enabled}
          onChange={(event) => update({ enabled: event.target.checked })}
        />
      </label>

      <div className="space-y-2">
        <div>
          <label className="text-sm font-medium" htmlFor="autorouter-frugality">
            Frugality
          </label>
          <p className="text-xs text-muted-foreground">
            Controls how strongly cost per task influences model selection.
          </p>
        </div>
        <input
          id="autorouter-frugality"
          type="range"
          min={0}
          max={100}
          step={1}
          value={settings.frugality}
          className="w-full accent-primary"
          onChange={(event) =>
            update(
              { frugality: Number(event.target.value) },
              { debounceMs: 250 },
            )
          }
          onPointerUp={flush}
          onKeyUp={flush}
        />
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>$</span>
          <span>{settings.frugality}%</span>
          <span>$$$</span>
        </div>
      </div>

      <div className="space-y-2">
        <label className="text-sm font-medium" htmlFor="autorouter-decision-agent">
          Decision agent
        </label>
        <p className="text-xs text-muted-foreground">
          The model that rates each task's difficulty (0-100) before routing.
          Automatic picks the cheapest launchable model on the classifier's
          fixed fallback chain (Cursor gpt-5.6-sol-medium → Codex
          gpt-5.6-luna → any model supporting `none` reasoning effort). Pin a
          specific model instead if you want the classifier itself to run on
          a known, fixed model — e.g. Antigravity's free-tier Gemini instead
          of a paid-provider fallback.
        </p>
        <div className="overflow-hidden rounded-md border border-input" id="autorouter-decision-agent">
          <Command>
            <CommandInput placeholder="Search providers and models…" />
            <CommandList className="max-h-64">
              <CommandEmpty>
                {picker.status === "ready"
                  ? "No models match your search."
                  : picker.status === "failed"
                    ? "Couldn't load the model catalog."
                    : "Loading models…"}
              </CommandEmpty>
              <CommandGroup heading="General">
                <CommandItem
                  value="automatic"
                  keywords={["default", "automatic", "cheapest"]}
                  onSelect={() => update({ decisionAgent: "automatic" })}
                >
                  <Icon
                    name="Check"
                    className={settings.decisionAgent === "automatic" ? undefined : "invisible"}
                    aria-hidden
                  />
                  <span className="truncate">Automatic</span>
                  <span className="ml-auto text-xs text-muted-foreground">default</span>
                </CommandItem>
              </CommandGroup>
              {(picker.catalog?.providers ?? []).map((provider) => (
                <CommandGroup key={provider.id} heading={provider.displayName}>
                  {provider.models.map((model) => {
                    const value = `${provider.id}/${model.model}`;
                    const isSelected = settings.decisionAgent === value;
                    return (
                      <CommandItem
                        key={value}
                        value={value}
                        keywords={[model.displayName, provider.displayName]}
                        onSelect={() => update({ decisionAgent: value })}
                      >
                        <Icon name="Check" className={isSelected ? undefined : "invisible"} aria-hidden />
                        <span className="truncate">{model.displayName}</span>
                        {model.isDefault ? (
                          <span className="ml-auto text-xs text-muted-foreground">default</span>
                        ) : null}
                      </CommandItem>
                    );
                  })}
                </CommandGroup>
              ))}
            </CommandList>
          </Command>
        </div>
        <p className="text-xs text-muted-foreground">
          Current: <span className="font-medium text-foreground">{settings.decisionAgent}</span>
        </p>
      </div>

      <div className="space-y-2">
        <label
          className="text-sm font-medium"
          htmlFor="autorouter-instructions"
        >
          Custom instructions
        </label>
        <textarea
          id="autorouter-instructions"
          rows={6}
          maxLength={12_000}
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
          value={settings.customInstructions}
          placeholder="For example: rate authentication and production migrations at least 85. Route CSS-only changes to Composer 2.5."
          onChange={(event) =>
            update(
              { customInstructions: event.target.value },
              { debounceMs: 500 },
            )
          }
          onBlur={flush}
        />
        <p className="text-xs text-muted-foreground">
          These instructions may name a model override. The classifier cannot
          invent one; the requested name must also be grounded in the prompt or
          these instructions.
        </p>
      </div>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </div>
  );
}

export default definePluginApp((app) => {
  app.slots.navPanel({
    id: "autorouter",
    title: "New autorouter thread",
    icon: "Workflow",
    path: "autorouter",
    component: AutoRouterPage,
  });
  app.slots.settingsSection({
    id: "autorouter-settings",
    title: "Routing policy",
    description:
      "Configure task classification and the cost-to-capability tradeoff.",
    component: AutoRouterSettings,
  });
});
