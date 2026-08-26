import {
  BrainCircuit,
  Check,
  Code2,
  Coins,
  Eye,
  Search,
  Sparkles,
  Star,
  Wrench,
  X,
} from "lucide-react";
import { useMemo, useState } from "react";
import { getCapabilityLabel, getModelDescription, translations, type Language } from "../i18n";
import { formatContextWindow, formatPrice, searchModels, sortModelsByPrice } from "../lib/models";
import type { ModelInfo } from "../types";

type Filter = "all" | "reasoning" | "vision" | "tools" | "paid" | "lora";

const filterItems: Filter[] = ["all", "reasoning", "vision", "tools", "paid", "lora"];

const capabilityIcon = {
  reasoning: BrainCircuit,
  vision: Eye,
  tools: Wrench,
  coding: Code2,
};

const providerLogos: Record<string, string> = {
  DeepSeek: "/model-logos/deepseek.svg",
  Google: "/model-logos/google.svg",
  IBM: "/model-logos/ibm.svg",
  Meta: "/model-logos/meta.svg",
  "Mistral AI": "/model-logos/mistral.svg",
  "Moonshot AI": "/model-logos/moonshot.svg",
  NVIDIA: "/model-logos/nvidia.svg",
  OpenAI: "/model-logos/openai.svg",
  Qwen: "/model-logos/qwen.svg",
  "Z.ai": "/model-logos/zai.svg",
};

interface ModelPickerProps {
  models: ModelInfo[];
  selectedId: string;
  favoriteIds: string[];
  syncedAt: string;
  language: Language;
  onSelect: (id: string) => void;
  onToggleFavorite: (id: string) => void;
  onClose: () => void;
}

export function ModelPicker({
  models,
  selectedId,
  favoriteIds,
  syncedAt,
  language,
  onSelect,
  onToggleFavorite,
  onClose,
}: ModelPickerProps) {
  const t = translations[language].picker;
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const visibleModels = useMemo(() => {
    const localizedModels = models.map((model) => ({
      ...model,
      description: getModelDescription(model, language),
    }));
    const filtered = searchModels(localizedModels, query, filter);
    return sortModelsByPrice(filtered, favoriteIds);
  }, [models, query, filter, favoriteIds, language]);

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        aria-label={t.dialogLabel}
        aria-modal="true"
        className="model-picker"
        role="dialog"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="picker-header">
          <div>
            <span className="eyebrow">{t.eyebrow}</span>
            <h2>{t.title}</h2>
          </div>
          <button className="icon-button" onClick={onClose} type="button" aria-label={t.close}>
            <X size={19} />
          </button>
        </header>

        <div className="model-search">
          <Search size={18} />
          <input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t.searchPlaceholder}
            aria-label={t.searchAria}
          />
          <kbd>⌘ K</kbd>
        </div>

        <div className="filter-row" aria-label={t.filtersAria}>
          {filterItems.map((item) => (
            <button
              className={filter === item ? "filter-pill active" : "filter-pill"}
              key={item}
              onClick={() => setFilter(item)}
              type="button"
            >
              {t.filters[item]}
            </button>
          ))}
        </div>

        <div className="model-grid">
          {visibleModels.map((model) => (
            <article
              className={selectedId === model.id ? "model-card selected" : "model-card"}
              key={model.id}
              onClick={() => onSelect(model.id)}
            >
              <div className="model-card-top">
                <div className="provider-mark" title={model.provider}>
                  {providerLogos[model.provider] ? (
                    <img alt="" aria-hidden="true" src={providerLogos[model.provider]} />
                  ) : (
                    <Sparkles aria-hidden="true" size={17} strokeWidth={1.6} />
                  )}
                </div>
                <div className="model-card-title">
                  <h3>{model.name}</h3>
                  <span>{model.provider}</span>
                </div>
                <button
                  type="button"
                  className={favoriteIds.includes(model.id) ? "favorite active" : "favorite"}
                  onClick={(event) => {
                    event.stopPropagation();
                    onToggleFavorite(model.id);
                  }}
                  aria-label={favoriteIds.includes(model.id) ? t.removeFavorite : t.addFavorite}
                >
                  <Star size={16} fill={favoriteIds.includes(model.id) ? "currentColor" : "none"} />
                </button>
              </div>
              <p>{getModelDescription(model, language)}</p>
              <div className="capability-row">
                <span className="capability"><Sparkles size={13} />{formatContextWindow(model.contextWindow, language)}</span>
                {model.capabilities.map((capability) => {
                  const Icon = capabilityIcon[capability];
                  return <span className="capability" key={capability}><Icon size={13} />{getCapabilityLabel(capability, language)}</span>;
                })}
                {model.paid && <span className="capability paid"><Coins size={13} />{translations[language].paid}</span>}
                {model.lora && <span className="capability">LoRA</span>}
              </div>
              <div className="price-row">
                <span>{t.input} {formatPrice(model.prices.input)} / M</span>
                <span>{t.output} {formatPrice(model.prices.output)} / M</span>
                {selectedId === model.id && <Check className="selected-check" size={17} />}
              </div>
            </article>
          ))}
          {visibleModels.length === 0 && (
            <div className="empty-results">
              <Search size={22} />
              <p>{t.noResults}</p>
            </div>
          )}
        </div>

        <footer className="picker-footer">
          <span>{t.modelCount(visibleModels.length, models.length)}</span>
          <span>{t.catalogSynced(new Date(syncedAt).toLocaleDateString(language === "zh" ? "zh-CN" : "en"))}</span>
        </footer>
      </section>
    </div>
  );
}
