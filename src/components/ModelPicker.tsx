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
import { formatContextWindow, formatPrice, searchModels } from "../lib/models";
import type { ModelInfo } from "../types";

type Filter = "all" | "reasoning" | "vision" | "tools" | "paid" | "lora";

const filterItems: Array<{ id: Filter; label: string }> = [
  { id: "all", label: "All" },
  { id: "reasoning", label: "Reasoning" },
  { id: "vision", label: "Vision" },
  { id: "tools", label: "Tools" },
  { id: "paid", label: "Paid" },
  { id: "lora", label: "LoRA" },
];

const capabilityIcon = {
  reasoning: BrainCircuit,
  vision: Eye,
  tools: Wrench,
  coding: Code2,
};

interface ModelPickerProps {
  models: ModelInfo[];
  selectedId: string;
  favoriteIds: string[];
  syncedAt: string;
  onSelect: (id: string) => void;
  onToggleFavorite: (id: string) => void;
  onClose: () => void;
}

export function ModelPicker({
  models,
  selectedId,
  favoriteIds,
  syncedAt,
  onSelect,
  onToggleFavorite,
  onClose,
}: ModelPickerProps) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const visibleModels = useMemo(() => {
    const filtered = searchModels(models, query, filter);
    return [...filtered].sort((a, b) => {
      const favoriteDifference = Number(favoriteIds.includes(b.id)) - Number(favoriteIds.includes(a.id));
      return favoriteDifference || a.provider.localeCompare(b.provider) || a.name.localeCompare(b.name);
    });
  }, [models, query, filter, favoriteIds]);

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        aria-label="Choose a model"
        aria-modal="true"
        className="model-picker"
        role="dialog"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="picker-header">
          <div>
            <span className="eyebrow">Cloudflare-hosted</span>
            <h2>Choose your model</h2>
          </div>
          <button className="icon-button" onClick={onClose} type="button" aria-label="Close model picker">
            <X size={19} />
          </button>
        </header>

        <div className="model-search">
          <Search size={18} />
          <input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search models, providers or capabilities"
            aria-label="Search models"
          />
          <kbd>⌘ K</kbd>
        </div>

        <div className="filter-row" aria-label="Model filters">
          {filterItems.map((item) => (
            <button
              className={filter === item.id ? "filter-pill active" : "filter-pill"}
              key={item.id}
              onClick={() => setFilter(item.id)}
              type="button"
            >
              {item.label}
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
                <div className="provider-mark">{model.provider.slice(0, 1)}</div>
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
                  aria-label={favoriteIds.includes(model.id) ? "Remove from favorites" : "Add to favorites"}
                >
                  <Star size={16} fill={favoriteIds.includes(model.id) ? "currentColor" : "none"} />
                </button>
              </div>
              <p>{model.description}</p>
              <div className="capability-row">
                <span className="capability"><Sparkles size={13} />{formatContextWindow(model.contextWindow)}</span>
                {model.capabilities.map((capability) => {
                  const Icon = capabilityIcon[capability];
                  return <span className="capability" key={capability}><Icon size={13} />{capability}</span>;
                })}
                {model.paid && <span className="capability paid"><Coins size={13} />paid</span>}
                {model.lora && <span className="capability">LoRA</span>}
              </div>
              <div className="price-row">
                <span>In {formatPrice(model.prices.input)} / M</span>
                <span>Out {formatPrice(model.prices.output)} / M</span>
                {selectedId === model.id && <Check className="selected-check" size={17} />}
              </div>
            </article>
          ))}
          {visibleModels.length === 0 && (
            <div className="empty-results">
              <Search size={22} />
              <p>No models match this search.</p>
            </div>
          )}
        </div>

        <footer className="picker-footer">
          <span>{visibleModels.length} of {models.length} chat models</span>
          <span>Catalog synced {new Date(syncedAt).toLocaleDateString()}</span>
        </footer>
      </section>
    </div>
  );
}
