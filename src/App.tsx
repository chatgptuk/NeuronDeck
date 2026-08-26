import {
  Archive,
  Check,
  ChevronDown,
  Copy,
  Download,
  Menu,
  MessageSquareText,
  Moon,
  PanelRight,
  Pencil,
  Plus,
  RefreshCw,
  Send,
  Settings2,
  Sparkles,
  Square,
  Sun,
  Trash2,
  X,
} from "lucide-react";
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CATALOG_SYNCED_AT,
  DEFAULT_MODEL_ID,
  FALLBACK_MODELS,
  formatContextWindow,
  formatPrice,
  getModel,
} from "./lib/models";
import { consumeChatStream } from "./lib/stream";
import { loadWorkspace, saveWorkspace } from "./lib/storage";
import type { ChatMessage, Conversation, ModelInfo, WorkspaceState } from "./types";

const MarkdownMessage = lazy(() =>
  import("./components/MarkdownMessage").then((module) => ({ default: module.MarkdownMessage })),
);
const ModelPicker = lazy(() =>
  import("./components/ModelPicker").then((module) => ({ default: module.ModelPicker })),
);

const id = (): string => crypto.randomUUID();
const now = (): string => new Date().toISOString();

const createConversation = (modelId = DEFAULT_MODEL_ID): Conversation => {
  const timestamp = now();
  return {
    id: id(),
    title: "New conversation",
    modelId,
    systemPrompt: "You are a precise, thoughtful assistant. Be candid about uncertainty and use clear formatting.",
    temperature: 0.6,
    maxTokens: 2048,
    messages: [],
    createdAt: timestamp,
    updatedAt: timestamp,
  };
};

const createWorkspace = (): WorkspaceState => {
  const conversation = createConversation();
  return {
    conversations: [conversation],
    activeConversationId: conversation.id,
    favoriteModelIds: ["@cf/zai-org/glm-4.7-flash", "@cf/openai/gpt-oss-120b"],
  };
};

const getClientId = (): string => {
  const key = "neurondeck-client-id";
  const existing = localStorage.getItem(key);
  if (existing) return existing;
  const value = crypto.randomUUID().replaceAll("-", "");
  localStorage.setItem(key, value);
  return value;
};

const titleFromPrompt = (prompt: string): string => {
  const compact = prompt.replace(/\s+/g, " ").trim();
  return compact.length > 42 ? `${compact.slice(0, 42)}…` : compact;
};

const starterPrompts = [
  {
    label: "Explore an idea",
    prompt: "Help me pressure-test a new product idea. Ask the three most important questions first.",
  },
  {
    label: "Review some code",
    prompt: "Review this code for correctness, security, and maintainability. Explain the highest-risk issue first.",
  },
  {
    label: "Think it through",
    prompt: "Analyze this problem from three different perspectives, then give me a concrete recommendation.",
  },
];

function App() {
  const [workspace, setWorkspace] = useState<WorkspaceState>(createWorkspace);
  const [models, setModels] = useState<ModelInfo[]>(FALLBACK_MODELS);
  const [catalogSyncedAt, setCatalogSyncedAt] = useState(CATALOG_SYNCED_AT);
  const [hydrated, setHydrated] = useState(false);
  const [composer, setComposer] = useState("");
  const [generating, setGenerating] = useState(false);
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const [theme, setTheme] = useState<"dark" | "light">(
    () => (localStorage.getItem("neurondeck-theme") as "dark" | "light" | null) ?? "dark",
  );
  const abortRef = useRef<AbortController | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const messageEndRef = useRef<HTMLDivElement | null>(null);

  const activeConversation =
    workspace.conversations.find((conversation) => conversation.id === workspace.activeConversationId) ??
    workspace.conversations[0];
  const activeModel = getModel(models, activeConversation.modelId);

  useEffect(() => {
    let active = true;
    void loadWorkspace().then((saved) => {
      if (!active) return;
      if (saved?.conversations?.length) {
        const validIds = new Set(FALLBACK_MODELS.map((model) => model.id));
        const conversations = saved.conversations.map((conversation) => ({
          ...conversation,
          modelId: validIds.has(conversation.modelId) ? conversation.modelId : DEFAULT_MODEL_ID,
        }));
        setWorkspace({ ...saved, conversations });
      }
      setHydrated(true);
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    const timeout = window.setTimeout(() => void saveWorkspace(workspace), 250);
    return () => window.clearTimeout(timeout);
  }, [workspace, hydrated]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("neurondeck-theme", theme);
  }, [theme]);

  useEffect(() => {
    void fetch("/api/models")
      .then(async (response) => {
        if (!response.ok) throw new Error("Model catalog unavailable");
        return response.json() as Promise<{ models: ModelInfo[]; syncedAt: string }>;
      })
      .then((data) => {
        if (data.models.length) {
          setModels(data.models);
          setCatalogSyncedAt(data.syncedAt);
        }
      })
      .catch(() => {
        // The committed catalog keeps local development and transient outages usable.
      });
  }, []);

  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setModelPickerOpen(true);
      }
      if (event.key === "Escape") {
        setModelPickerOpen(false);
        setSidebarOpen(false);
      }
    };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, []);

  useEffect(() => {
    messageEndRef.current?.scrollIntoView({ behavior: generating ? "auto" : "smooth" });
  }, [activeConversation.messages, generating]);

  const updateConversation = useCallback((conversationId: string, update: (value: Conversation) => Conversation) => {
    setWorkspace((current) => ({
      ...current,
      conversations: current.conversations.map((conversation) =>
        conversation.id === conversationId ? update(conversation) : conversation,
      ),
    }));
  }, []);

  const updateMessage = useCallback(
    (conversationId: string, messageId: string, update: (value: ChatMessage) => ChatMessage) => {
      updateConversation(conversationId, (conversation) => ({
        ...conversation,
        updatedAt: now(),
        messages: conversation.messages.map((message) => (message.id === messageId ? update(message) : message)),
      }));
    },
    [updateConversation],
  );

  const generateResponse = useCallback(
    async (conversation: Conversation, contextMessages: ChatMessage[], assistantId: string) => {
      const controller = new AbortController();
      abortRef.current = controller;
      setGenerating(true);
      const startedAt = performance.now();
      let content = "";
      let reasoning = "";

      const apiMessages = [
        ...(conversation.systemPrompt.trim()
          ? [{ role: "system" as const, content: conversation.systemPrompt.trim() }]
          : []),
        ...contextMessages.map((message) => ({ role: message.role, content: message.content })),
      ];

      try {
        const response = await fetch("/api/chat", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-neurondeck-client": getClientId(),
          },
          body: JSON.stringify({
            model: conversation.modelId,
            messages: apiMessages,
            temperature: conversation.temperature,
            maxTokens: conversation.maxTokens,
          }),
          signal: controller.signal,
        });

        if (!response.ok) {
          const data = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
          throw new Error(data?.error?.message || `Request failed with status ${response.status}.`);
        }

        await consumeChatStream(response, (event) => {
          if (event.error) throw new Error(event.error);
          if (event.content) content += event.content;
          if (event.reasoning) reasoning += event.reasoning;
          if (event.content || event.reasoning) {
            updateMessage(conversation.id, assistantId, (message) => ({
              ...message,
              content,
              reasoning,
              status: "streaming",
            }));
          }
        });

        updateMessage(conversation.id, assistantId, (message) => ({
          ...message,
          content: content || "The model completed without returning text.",
          reasoning,
          status: "complete",
          elapsedMs: Math.round(performance.now() - startedAt),
        }));
      } catch (error) {
        const stopped = error instanceof DOMException && error.name === "AbortError";
        const message = stopped
          ? content || "Generation stopped."
          : error instanceof Error
            ? error.message
            : "The model could not complete this request.";
        updateMessage(conversation.id, assistantId, (current) => ({
          ...current,
          content: message,
          reasoning,
          status: stopped ? "complete" : "error",
          elapsedMs: Math.round(performance.now() - startedAt),
        }));
      } finally {
        abortRef.current = null;
        setGenerating(false);
      }
    },
    [updateMessage],
  );

  const sendMessage = useCallback(async () => {
    const prompt = composer.trim();
    if (!prompt || generating) return;

    const timestamp = now();
    const userMessage: ChatMessage = {
      id: id(),
      role: "user",
      content: prompt,
      createdAt: timestamp,
      status: "complete",
    };
    const assistantMessage: ChatMessage = {
      id: id(),
      role: "assistant",
      content: "",
      createdAt: timestamp,
      modelId: activeConversation.modelId,
      status: "streaming",
    };
    const contextMessages = [...activeConversation.messages, userMessage];
    const snapshot: Conversation = { ...activeConversation, messages: contextMessages };

    updateConversation(activeConversation.id, (conversation) => ({
      ...conversation,
      title: conversation.messages.length === 0 ? titleFromPrompt(prompt) : conversation.title,
      updatedAt: timestamp,
      messages: [...contextMessages, assistantMessage],
    }));
    setComposer("");
    await generateResponse(snapshot, contextMessages, assistantMessage.id);
  }, [activeConversation, composer, generateResponse, generating, updateConversation]);

  const regenerate = useCallback(
    (messageId: string) => {
      if (generating) return;
      const index = activeConversation.messages.findIndex((message) => message.id === messageId);
      if (index < 0) return;
      const contextMessages = activeConversation.messages.slice(0, index);
      if (!contextMessages.some((message) => message.role === "user")) return;
      const assistantMessage: ChatMessage = {
        id: id(),
        role: "assistant",
        content: "",
        createdAt: now(),
        modelId: activeConversation.modelId,
        status: "streaming",
      };
      updateConversation(activeConversation.id, (conversation) => ({
        ...conversation,
        updatedAt: now(),
        messages: [...contextMessages, assistantMessage],
      }));
      void generateResponse(activeConversation, contextMessages, assistantMessage.id);
    },
    [activeConversation, generateResponse, generating, updateConversation],
  );

  const editMessage = (messageId: string) => {
    if (generating) return;
    const index = activeConversation.messages.findIndex((message) => message.id === messageId);
    const message = activeConversation.messages[index];
    if (!message || message.role !== "user") return;
    setComposer(message.content);
    updateConversation(activeConversation.id, (conversation) => ({
      ...conversation,
      messages: conversation.messages.slice(0, index),
      updatedAt: now(),
    }));
    window.setTimeout(() => textareaRef.current?.focus(), 0);
  };

  const copyMessage = async (message: ChatMessage) => {
    await navigator.clipboard.writeText(message.content);
    setCopiedMessageId(message.id);
    window.setTimeout(() => setCopiedMessageId(null), 1400);
  };

  const newConversation = () => {
    const conversation = createConversation(activeConversation.modelId);
    setWorkspace((current) => ({
      ...current,
      conversations: [conversation, ...current.conversations],
      activeConversationId: conversation.id,
    }));
    setSidebarOpen(false);
    setComposer("");
  };

  const deleteConversation = (conversationId: string) => {
    if (generating) return;
    setWorkspace((current) => {
      const remaining = current.conversations.filter((conversation) => conversation.id !== conversationId);
      if (remaining.length) {
        return {
          ...current,
          conversations: remaining,
          activeConversationId:
            current.activeConversationId === conversationId ? remaining[0].id : current.activeConversationId,
        };
      }
      const replacement = createConversation();
      return { ...current, conversations: [replacement], activeConversationId: replacement.id };
    });
  };

  const exportConversation = () => {
    const markdown = [
      `# ${activeConversation.title}`,
      "",
      `Model: ${activeModel.name} (${activeModel.id})`,
      "",
      ...activeConversation.messages.flatMap((message) => [
        `## ${message.role === "user" ? "You" : activeModel.name}`,
        "",
        message.content,
        "",
      ]),
    ].join("\n");
    const url = URL.createObjectURL(new Blob([markdown], { type: "text/markdown" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${activeConversation.title.replace(/[^a-z0-9]+/gi, "-").toLowerCase() || "conversation"}.md`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const selectModel = (modelId: string) => {
    updateConversation(activeConversation.id, (conversation) => ({ ...conversation, modelId, updatedAt: now() }));
    setModelPickerOpen(false);
  };

  const toggleFavorite = (modelId: string) => {
    setWorkspace((current) => ({
      ...current,
      favoriteModelIds: current.favoriteModelIds.includes(modelId)
        ? current.favoriteModelIds.filter((idValue) => idValue !== modelId)
        : [...current.favoriteModelIds, modelId],
    }));
  };

  const groupedConversations = useMemo(
    () => [...workspace.conversations].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    [workspace.conversations],
  );

  return (
    <div className="app-shell">
      {sidebarOpen && <button className="mobile-scrim" aria-label="Close sidebar" onClick={() => setSidebarOpen(false)} />}
      <aside className={sidebarOpen ? "sidebar open" : "sidebar"}>
        <div className="brand-row">
          <div className="brand-mark"><span /><span /><span /></div>
          <div className="brand-copy">
            <strong>NeuronDeck</strong>
            <span>Edge model workspace</span>
          </div>
          <button className="icon-button sidebar-close" onClick={() => setSidebarOpen(false)} aria-label="Close sidebar">
            <X size={18} />
          </button>
        </div>

        <button className="new-chat-button" onClick={newConversation} type="button">
          <Plus size={17} />
          New conversation
          <span>⌘ N</span>
        </button>

        <div className="sidebar-label"><MessageSquareText size={13} />Conversations</div>
        <nav className="conversation-list" aria-label="Conversations">
          {groupedConversations.map((conversation) => (
            <button
              key={conversation.id}
              type="button"
              className={conversation.id === activeConversation.id ? "conversation-item active" : "conversation-item"}
              onClick={() => {
                setWorkspace((current) => ({ ...current, activeConversationId: conversation.id }));
                setSidebarOpen(false);
              }}
            >
              <span className="conversation-title">{conversation.title}</span>
              <span className="conversation-meta">
                {getModel(models, conversation.modelId).name}
                <Trash2
                  size={14}
                  role="button"
                  aria-label={`Delete ${conversation.title}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    deleteConversation(conversation.id);
                  }}
                />
              </span>
            </button>
          ))}
        </nav>

        <div className="sidebar-footer">
          <div className="storage-card">
            <Archive size={16} />
            <div><strong>Local-first</strong><span>Chats stay in this browser</span></div>
          </div>
          <button className="sidebar-action" onClick={exportConversation} type="button">
            <Download size={16} />Export conversation
          </button>
        </div>
      </aside>

      <main className="main-panel">
        <header className="topbar">
          <button className="icon-button mobile-menu" onClick={() => setSidebarOpen(true)} aria-label="Open sidebar">
            <Menu size={20} />
          </button>
          <button className="model-trigger" onClick={() => setModelPickerOpen(true)} type="button">
            <span className="model-dot" />
            <span><small>{activeModel.provider}</small>{activeModel.name}</span>
            <ChevronDown size={16} />
          </button>
          <div className="topbar-actions">
            <button
              className="icon-button"
              onClick={() => setTheme((current) => (current === "dark" ? "light" : "dark"))}
              aria-label="Toggle theme"
              type="button"
            >
              {theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
            </button>
            <button
              className={inspectorOpen ? "icon-button active" : "icon-button"}
              onClick={() => setInspectorOpen((current) => !current)}
              aria-label="Toggle model inspector"
              type="button"
            >
              <PanelRight size={18} />
            </button>
          </div>
        </header>

        <div className="workspace-row">
          <section className="chat-panel">
            <div className="message-scroll">
              {activeConversation.messages.length === 0 ? (
                <div className="welcome-state">
                  <div className="welcome-orbit"><span /><span /><span /></div>
                  <span className="eyebrow">Every Cloudflare-hosted chat model</span>
                  <h1>What are we working on?</h1>
                  <p>Switch models without switching context. Your conversations remain on this device.</p>
                  <div className="starter-grid">
                    {starterPrompts.map((item) => (
                      <button key={item.label} type="button" onClick={() => {
                        setComposer(item.prompt);
                        textareaRef.current?.focus();
                      }}>
                        <Sparkles size={16} />
                        <strong>{item.label}</strong>
                        <span>{item.prompt}</span>
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="messages">
                  {activeConversation.messages.map((message) => (
                    <article className={`message ${message.role}`} key={message.id}>
                      <div className="message-identity">
                        {message.role === "user" ? (
                          <div className="avatar user-avatar">Y</div>
                        ) : (
                          <div className="avatar ai-avatar"><span /></div>
                        )}
                        <div>
                          <strong>{message.role === "user" ? "You" : getModel(models, message.modelId ?? activeModel.id).name}</strong>
                          <span>{message.elapsedMs ? `${(message.elapsedMs / 1000).toFixed(1)}s` : message.status === "streaming" ? "Generating" : ""}</span>
                        </div>
                      </div>
                      <div className={message.status === "error" ? "message-content error" : "message-content"}>
                        {message.reasoning && (
                          <details className="reasoning-block">
                            <summary>Reasoning trace</summary>
                            <p>{message.reasoning}</p>
                          </details>
                        )}
                        {message.content ? (
                          <Suspense fallback={<p>{message.content}</p>}>
                            <MarkdownMessage content={message.content} />
                          </Suspense>
                        ) : <div className="typing"><span /><span /><span /></div>}
                      </div>
                      {message.content && message.status !== "streaming" && (
                        <div className="message-actions">
                          <button onClick={() => void copyMessage(message)} type="button">
                            {copiedMessageId === message.id ? <Check size={14} /> : <Copy size={14} />}
                            {copiedMessageId === message.id ? "Copied" : "Copy"}
                          </button>
                          {message.role === "assistant" ? (
                            <button onClick={() => regenerate(message.id)} type="button"><RefreshCw size={14} />Regenerate</button>
                          ) : (
                            <button onClick={() => editMessage(message.id)} type="button"><Pencil size={14} />Edit from here</button>
                          )}
                        </div>
                      )}
                    </article>
                  ))}
                  <div ref={messageEndRef} />
                </div>
              )}
            </div>

            <div className="composer-wrap">
              <div className="composer">
                <textarea
                  ref={textareaRef}
                  rows={1}
                  value={composer}
                  onChange={(event) => setComposer(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      void sendMessage();
                    }
                  }}
                  placeholder={`Message ${activeModel.name}`}
                  aria-label="Message"
                  disabled={generating}
                />
                <div className="composer-bottom">
                  <div className="composer-badges">
                    <button onClick={() => setModelPickerOpen(true)} type="button"><span className="model-dot" />{activeModel.name}</button>
                    <span>{formatContextWindow(activeModel.contextWindow)}</span>
                  </div>
                  {generating ? (
                    <button className="send-button stop" onClick={() => abortRef.current?.abort()} type="button" aria-label="Stop generating"><Square size={15} fill="currentColor" /></button>
                  ) : (
                    <button className="send-button" onClick={() => void sendMessage()} disabled={!composer.trim()} type="button" aria-label="Send message"><Send size={17} /></button>
                  )}
                </div>
              </div>
              <p className="composer-note">Models can make mistakes. 10 generations per minute per visitor.</p>
            </div>
          </section>

          <aside className={inspectorOpen ? "inspector open" : "inspector"}>
            <div className="inspector-header">
              <div><span className="eyebrow">Model inspector</span><h2>{activeModel.name}</h2></div>
              <button className="icon-button" onClick={() => setInspectorOpen(false)} aria-label="Close inspector"><X size={17} /></button>
            </div>
            <p className="inspector-description">{activeModel.description}</p>
            <div className="inspector-stats">
              <div><span>Context</span><strong>{formatContextWindow(activeModel.contextWindow).replace(" context", "")}</strong></div>
              <div><span>Input / M</span><strong>{formatPrice(activeModel.prices.input)}</strong></div>
              <div><span>Output / M</span><strong>{formatPrice(activeModel.prices.output)}</strong></div>
            </div>
            <div className="inspector-section">
              <label htmlFor="system-prompt"><Settings2 size={14} />System prompt</label>
              <textarea
                id="system-prompt"
                rows={6}
                value={activeConversation.systemPrompt}
                onChange={(event) => updateConversation(activeConversation.id, (conversation) => ({ ...conversation, systemPrompt: event.target.value, updatedAt: now() }))}
              />
            </div>
            <div className="inspector-section">
              <div className="range-label"><label htmlFor="temperature">Temperature</label><output>{activeConversation.temperature.toFixed(1)}</output></div>
              <input
                id="temperature"
                type="range"
                min="0"
                max="2"
                step="0.1"
                value={activeConversation.temperature}
                onChange={(event) => updateConversation(activeConversation.id, (conversation) => ({ ...conversation, temperature: Number(event.target.value), updatedAt: now() }))}
              />
              <div className="range-hints"><span>Precise</span><span>Creative</span></div>
            </div>
            <div className="inspector-section">
              <label htmlFor="max-tokens">Maximum output tokens</label>
              <input
                id="max-tokens"
                className="number-input"
                type="number"
                min="64"
                max="8192"
                step="64"
                value={activeConversation.maxTokens}
                onChange={(event) => updateConversation(activeConversation.id, (conversation) => ({ ...conversation, maxTokens: Math.min(8192, Math.max(64, Number(event.target.value) || 64)), updatedAt: now() }))}
              />
            </div>
            <div className="inspector-section">
              <span className="section-title">Capabilities</span>
              <div className="inspector-capabilities">
                {activeModel.capabilities.length ? activeModel.capabilities.map((capability) => <span key={capability}>{capability}</span>) : <span>text</span>}
                {activeModel.lora && <span>LoRA</span>}
                {activeModel.paid && <span className="paid">paid</span>}
              </div>
            </div>
            <button className="change-model" onClick={() => setModelPickerOpen(true)} type="button">Browse all {models.length} models<ChevronDown size={15} /></button>
          </aside>
        </div>
      </main>

      {modelPickerOpen && (
        <Suspense fallback={null}>
          <ModelPicker
            models={models}
            selectedId={activeConversation.modelId}
            favoriteIds={workspace.favoriteModelIds}
            syncedAt={catalogSyncedAt}
            onSelect={selectModel}
            onToggleFavorite={toggleFavorite}
            onClose={() => setModelPickerOpen(false)}
          />
        </Suspense>
      )}
    </div>
  );
}

export default App;
