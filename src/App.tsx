import {
  Archive,
  Check,
  ChevronDown,
  Copy,
  Download,
  Languages,
  LoaderCircle,
  Menu,
  MessageSquareText,
  Moon,
  PanelRight,
  Paperclip,
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
  getCapabilityLabel,
  getLocalizedError,
  getModelDescription,
  translations,
  type Language,
} from "./i18n";
import {
  CATALOG_SYNCED_AT,
  DEFAULT_MODEL_ID,
  FALLBACK_MODELS,
  formatContextWindow,
  formatPrice,
  getModel,
  supportsMultimodalAttachments,
} from "./lib/models";
import {
  clampOutputTokens,
  getOutputTokenPolicy,
  getOutputTokenPolicyForModel,
} from "./lib/output-tokens";
import {
  ATTACHMENT_ACCEPT,
  MAX_ATTACHMENTS_PER_MESSAGE,
  MAX_DOCUMENT_BYTES,
  MAX_IMAGE_BYTES,
  classifyFile,
  createLocalAttachment,
} from "./lib/attachments";
import { consumeChatStream } from "./lib/stream";
import { loadWorkspace, saveWorkspace } from "./lib/storage";
import type { Attachment, ChatMessage, Conversation, ModelInfo, WorkspaceState } from "./types";
import { AttachmentStrip } from "./components/AttachmentStrip";

const MarkdownMessage = lazy(() =>
  import("./components/MarkdownMessage").then((module) => ({ default: module.MarkdownMessage })),
);
const ModelPicker = lazy(() =>
  import("./components/ModelPicker").then((module) => ({ default: module.ModelPicker })),
);

const id = (): string => crypto.randomUUID();
const now = (): string => new Date().toISOString();
const LEGACY_VISION_MODEL_ID = "@cf/meta/llama-3.2-11b-vision-instruct";
const MAX_CONTEXT_ATTACHMENTS = 8;

const pruneAttachmentsForRequest = (messages: ChatMessage[], modelId: string): ChatMessage[] => {
  let attachmentSlots = MAX_CONTEXT_ATTACHMENTS;
  let imageSlots = modelId === LEGACY_VISION_MODEL_ID ? 1 : MAX_ATTACHMENTS_PER_MESSAGE;

  return [...messages]
    .reverse()
    .map((message) => {
      if (!message.attachments?.length || attachmentSlots <= 0) {
        return { ...message, attachments: undefined };
      }

      const attachments: Attachment[] = [];
      for (const attachment of [...message.attachments].reverse()) {
        if (attachmentSlots <= 0) break;
        if (attachment.kind === "image") {
          if (imageSlots <= 0) continue;
          imageSlots -= 1;
        }
        attachments.unshift(attachment);
        attachmentSlots -= 1;
      }
      return { ...message, attachments: attachments.length ? attachments : undefined };
    })
    .reverse();
};

const createConversation = (language: Language, modelId = DEFAULT_MODEL_ID): Conversation => {
  const timestamp = now();
  const t = translations[language];
  const outputTokenPolicy = getOutputTokenPolicyForModel(modelId);
  return {
    id: id(),
    title: t.defaultConversation,
    modelId,
    systemPrompt: t.defaultSystemPrompt,
    temperature: 0.6,
    maxTokens: outputTokenPolicy.recommended,
    maxTokensCustomized: false,
    messages: [],
    createdAt: timestamp,
    updatedAt: timestamp,
  };
};

const createWorkspace = (language: Language): WorkspaceState => {
  const conversation = createConversation(language);
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

function App() {
  const [language, setLanguage] = useState<Language>(
    () => (localStorage.getItem("neurondeck-language") === "en" ? "en" : "zh"),
  );
  const t = translations[language];
  const [workspace, setWorkspace] = useState<WorkspaceState>(() => createWorkspace(language));
  const [models, setModels] = useState<ModelInfo[]>(FALLBACK_MODELS);
  const [catalogSyncedAt, setCatalogSyncedAt] = useState(CATALOG_SYNCED_AT);
  const [hydrated, setHydrated] = useState(false);
  const [composer, setComposer] = useState("");
  const [pendingAttachments, setPendingAttachments] = useState<Attachment[]>([]);
  const [attachmentBusy, setAttachmentBusy] = useState(false);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const [theme, setTheme] = useState<"dark" | "light">(
    () => (localStorage.getItem("neurondeck-theme-v2") as "dark" | "light" | null) ?? "light",
  );
  const abortRef = useRef<AbortController | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const messageEndRef = useRef<HTMLDivElement | null>(null);

  const activeConversation =
    workspace.conversations.find((conversation) => conversation.id === workspace.activeConversationId) ??
    workspace.conversations[0];
  const activeModel = getModel(models, activeConversation.modelId);
  const activeModelSupportsAttachments = supportsMultimodalAttachments(activeModel);
  const activeOutputTokenPolicy = getOutputTokenPolicy(activeModel.contextWindow);
  const attachmentTarget = `${activeConversation.id}:${activeModel.id}`;
  const attachmentTargetRef = useRef(attachmentTarget);
  attachmentTargetRef.current = attachmentTarget;

  useEffect(() => {
    let active = true;
    void loadWorkspace().then((saved) => {
      if (!active) return;
      if (saved?.conversations?.length) {
        const validIds = new Set(FALLBACK_MODELS.map((model) => model.id));
        const conversations = saved.conversations.map((conversation) => {
          const modelId = validIds.has(conversation.modelId) ? conversation.modelId : DEFAULT_MODEL_ID;
          const outputTokenPolicy = getOutputTokenPolicyForModel(modelId);
          const hasStoredTokenValue = Number.isInteger(conversation.maxTokens) && conversation.maxTokens >= 64;
          const maxTokensCustomized = conversation.maxTokensCustomized ??
            (hasStoredTokenValue && conversation.maxTokens !== 2_048);
          return {
            ...conversation,
            modelId,
            maxTokens: maxTokensCustomized
              ? clampOutputTokens(conversation.maxTokens, outputTokenPolicy)
              : outputTokenPolicy.recommended,
            maxTokensCustomized,
            systemPrompt:
              conversation.systemPrompt === translations.zh.defaultSystemPrompt ||
              conversation.systemPrompt === translations.en.defaultSystemPrompt
                ? translations[language].defaultSystemPrompt
                : conversation.systemPrompt,
          };
        });
        setWorkspace({ ...saved, conversations });
      }
      setHydrated(true);
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    setWorkspace((current) => ({
      ...current,
      conversations: current.conversations.map((conversation) => ({
        ...conversation,
        systemPrompt:
          conversation.systemPrompt === translations.zh.defaultSystemPrompt ||
          conversation.systemPrompt === translations.en.defaultSystemPrompt
            ? translations[language].defaultSystemPrompt
            : conversation.systemPrompt,
      })),
    }));
  }, [language]);

  useEffect(() => {
    if (!hydrated) return;
    const timeout = window.setTimeout(() => void saveWorkspace(workspace), 250);
    return () => window.clearTimeout(timeout);
  }, [workspace, hydrated]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.setAttribute(
      "content",
      theme === "dark" ? "#19221e" : "#edf1eb",
    );
    localStorage.setItem("neurondeck-theme-v2", theme);
  }, [theme]);

  useEffect(() => {
    document.documentElement.lang = t.htmlLang;
    localStorage.setItem("neurondeck-language", language);
  }, [language, t.htmlLang]);

  useEffect(() => {
    void fetch("/api/models")
      .then(async (response) => {
        if (!response.ok) throw new Error(t.modelCatalogUnavailable);
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
  }, [t.modelCatalogUnavailable]);

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

      const requestMessages = pruneAttachmentsForRequest(contextMessages, conversation.modelId);
      const apiMessages = [
        ...(conversation.systemPrompt.trim()
          ? [{ role: "system" as const, content: conversation.systemPrompt.trim() }]
          : []),
        ...requestMessages.map((message) => ({
          role: message.role,
          content: message.content,
          ...(message.attachments?.length ? { attachments: message.attachments } : {}),
        })),
      ];

      try {
        const response = await fetch("/api/chat", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-neurondeck-client": getClientId(),
            "accept-language": language === "zh" ? "zh-CN" : "en",
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
          const data = (await response.json().catch(() => null)) as
            | { error?: { code?: string; message?: string } }
            | null;
          throw new Error(
            getLocalizedError(language, data?.error?.code, data?.error?.message || t.requestFailed(response.status)),
          );
        }

        await consumeChatStream(response, (event) => {
          if (event.error) {
            throw new Error(language === "zh" ? t.errors.inference_failed : event.error);
          }
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
          content: content || t.emptyCompletion,
          reasoning,
          status: "complete",
          elapsedMs: Math.round(performance.now() - startedAt),
        }));
      } catch (error) {
        const stopped = error instanceof DOMException && error.name === "AbortError";
        const message = stopped
          ? content || t.generationStopped
          : error instanceof Error
            ? error.message
            : t.generationFailed;
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
    [language, t.emptyCompletion, t.generationFailed, t.generationStopped, t.requestFailed, updateMessage],
  );

  const sendMessage = useCallback(async () => {
    const attachments = activeModelSupportsAttachments ? pendingAttachments : [];
    const prompt = composer.trim() || (attachments.length ? t.attachmentDefaultPrompt : "");
    if (!prompt || generating || attachmentBusy) return;

    const timestamp = now();
    const userMessage: ChatMessage = {
      id: id(),
      role: "user",
      content: prompt,
      createdAt: timestamp,
      status: "complete",
      ...(attachments.length ? { attachments } : {}),
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
    setPendingAttachments([]);
    setAttachmentError(null);
    await generateResponse(snapshot, contextMessages, assistantMessage.id);
  }, [
    activeConversation,
    activeModelSupportsAttachments,
    attachmentBusy,
    composer,
    generateResponse,
    generating,
    pendingAttachments,
    t.attachmentDefaultPrompt,
    updateConversation,
  ]);

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
    setPendingAttachments(activeModelSupportsAttachments ? (message.attachments ?? []) : []);
    setAttachmentError(null);
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

  const handleFileSelection = async (files: FileList | null) => {
    if (!activeModelSupportsAttachments || !files?.length || attachmentBusy || generating) return;
    const targetAtStart = attachmentTargetRef.current;
    setAttachmentBusy(true);
    setAttachmentError(null);

    const availableSlots = Math.max(0, MAX_ATTACHMENTS_PER_MESSAGE - pendingAttachments.length);
    const selected = Array.from(files).slice(0, availableSlots);
    if (files.length > availableSlots) setAttachmentError(t.tooManyAttachments);
    const prepared: Attachment[] = [];
    let imageCount = pendingAttachments.filter((attachment) => attachment.kind === "image").length;
    const imageLimit = activeModel.id === LEGACY_VISION_MODEL_ID ? 1 : MAX_ATTACHMENTS_PER_MESSAGE;

    try {
      for (const file of selected) {
        const classification = classifyFile(file);
        if (classification === "unsupported") {
          setAttachmentError(t.unsupportedAttachment);
          continue;
        }
        if (classification === "image") {
          if (imageCount >= imageLimit) {
            setAttachmentError(t.tooManyImages);
            continue;
          }
          if (file.size > MAX_IMAGE_BYTES) {
            setAttachmentError(t.imageTooLarge);
            continue;
          }
          const attachment = await createLocalAttachment(file);
          if (attachment) {
            prepared.push(attachment);
            imageCount += 1;
          }
          continue;
        }

        if (file.size > MAX_DOCUMENT_BYTES) {
          setAttachmentError(t.documentTooLarge);
          continue;
        }
        if (classification === "text") {
          const attachment = await createLocalAttachment(file);
          if (attachment) prepared.push(attachment);
          continue;
        }

        const formData = new FormData();
        formData.set("file", file);
        const response = await fetch("/api/attachments/convert", {
          method: "POST",
          headers: {
            "x-neurondeck-client": getClientId(),
            "accept-language": language === "zh" ? "zh-CN" : "en",
          },
          body: formData,
        });
        const data = (await response.json().catch(() => null)) as
          | {
              name?: string;
              mimeType?: string;
              size?: number;
              text?: string;
              tokens?: number;
              truncated?: boolean;
              error?: { code?: string; message?: string };
            }
          | null;
        if (!response.ok || !data?.text) {
          throw new Error(
            getLocalizedError(language, data?.error?.code, data?.error?.message || t.conversionFailed),
          );
        }
        prepared.push({
          id: id(),
          kind: "file",
          name: data.name || file.name,
          mimeType: data.mimeType || file.type || "application/octet-stream",
          size: data.size ?? file.size,
          text: data.text,
          tokens: data.tokens,
          truncated: data.truncated,
        });
      }

      if (prepared.length && attachmentTargetRef.current === targetAtStart) {
        setPendingAttachments((current) => [...current, ...prepared].slice(0, MAX_ATTACHMENTS_PER_MESSAGE));
      }
    } catch (error) {
      if (attachmentTargetRef.current === targetAtStart) {
        setAttachmentError(error instanceof Error ? error.message : t.attachmentReadFailed);
      }
    } finally {
      setAttachmentBusy(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const removePendingAttachment = (attachmentId: string) => {
    setPendingAttachments((current) => current.filter((attachment) => attachment.id !== attachmentId));
    setAttachmentError(null);
  };

  const newConversation = () => {
    const conversation = createConversation(language, activeConversation.modelId);
    setWorkspace((current) => ({
      ...current,
      conversations: [conversation, ...current.conversations],
      activeConversationId: conversation.id,
    }));
    setSidebarOpen(false);
    setComposer("");
    setPendingAttachments([]);
    setAttachmentError(null);
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
      const replacement = createConversation(language);
      return { ...current, conversations: [replacement], activeConversationId: replacement.id };
    });
  };

  const exportConversation = () => {
    const exportedTitle =
      activeConversation.title === translations.zh.defaultConversation ||
      activeConversation.title === translations.en.defaultConversation
        ? t.defaultConversation
        : activeConversation.title;
    const markdown = [
      `# ${exportedTitle}`,
      "",
      `${t.modelLabel}: ${activeModel.name} (${activeModel.id})`,
      "",
      ...activeConversation.messages.flatMap((message) => [
        `## ${message.role === "user" ? t.exportYou : activeModel.name}`,
        "",
        ...(message.attachments?.length
          ? [`${t.attachmentList}: ${message.attachments.map((attachment) => attachment.name).join(", ")}`, ""]
          : []),
        message.content,
        "",
      ]),
    ].join("\n");
    const url = URL.createObjectURL(new Blob([markdown], { type: "text/markdown" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${exportedTitle.replace(/[^\p{L}\p{N}]+/gu, "-").toLowerCase() || "conversation"}.md`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const selectModel = (modelId: string) => {
    const selectedModel = getModel(models, modelId);
    const outputTokenPolicy = getOutputTokenPolicy(selectedModel.contextWindow);
    updateConversation(activeConversation.id, (conversation) => ({
      ...conversation,
      modelId,
      maxTokens: conversation.maxTokensCustomized
        ? clampOutputTokens(conversation.maxTokens, outputTokenPolicy)
        : outputTokenPolicy.recommended,
      updatedAt: now(),
    }));
    if (!supportsMultimodalAttachments(selectedModel)) {
      setPendingAttachments([]);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
    setAttachmentError(null);
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
  const conversationTitle = (title: string) =>
    title === translations.zh.defaultConversation || title === translations.en.defaultConversation
      ? t.defaultConversation
      : title;

  return (
    <div className="app-shell">
      {sidebarOpen && <button className="mobile-scrim" aria-label={t.closeSidebar} onClick={() => setSidebarOpen(false)} />}
      <aside className={sidebarOpen ? "sidebar open" : "sidebar"}>
        <div className="brand-row">
          <div className="brand-mark"><span /><span /><span /></div>
          <div className="brand-copy">
            <strong>NeuronDeck</strong>
            <span>{t.brandSubtitle}</span>
          </div>
          <button className="icon-button sidebar-close" onClick={() => setSidebarOpen(false)} aria-label={t.closeSidebar}>
            <X size={18} />
          </button>
        </div>

        <button className="new-chat-button" onClick={newConversation} type="button">
          <Plus size={17} />
          {t.newConversation}
          <span>⌘ N</span>
        </button>

        <div className="sidebar-label"><MessageSquareText size={13} />{t.conversations}</div>
        <nav className="conversation-list" aria-label={t.conversations}>
          {groupedConversations.map((conversation) => (
            <button
              key={conversation.id}
              type="button"
              className={conversation.id === activeConversation.id ? "conversation-item active" : "conversation-item"}
              onClick={() => {
                setWorkspace((current) => ({ ...current, activeConversationId: conversation.id }));
                setSidebarOpen(false);
                setComposer("");
                setPendingAttachments([]);
                setAttachmentError(null);
              }}
            >
              <span className="conversation-title">{conversationTitle(conversation.title)}</span>
              <span className="conversation-meta">
                {getModel(models, conversation.modelId).name}
                <Trash2
                  size={14}
                  role="button"
                  aria-label={`${t.deleteConversation}：${conversationTitle(conversation.title)}`}
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
            <div><strong>{t.localFirst}</strong><span>{t.localFirstDetail}</span></div>
          </div>
          <button className="sidebar-action" onClick={exportConversation} type="button">
            <Download size={16} />{t.exportConversation}
          </button>
        </div>
      </aside>

      <main className="main-panel">
        <header className="topbar">
          <button className="icon-button mobile-menu" onClick={() => setSidebarOpen(true)} aria-label={t.openSidebar}>
            <Menu size={20} />
          </button>
          <button className="model-trigger" onClick={() => setModelPickerOpen(true)} type="button">
            <span className="model-dot" />
            <span><small>{activeModel.provider}</small>{activeModel.name}</span>
            <ChevronDown size={16} />
          </button>
          <div className="topbar-actions">
            <button
              className="language-toggle"
              onClick={() => setLanguage((current) => (current === "zh" ? "en" : "zh"))}
              aria-label={t.switchLanguage}
              title={t.switchLanguage}
              type="button"
            >
              <Languages size={16} />
              <span>{t.languageName}</span>
            </button>
            <button
              className="icon-button"
              onClick={() => setTheme((current) => (current === "dark" ? "light" : "dark"))}
              aria-label={t.toggleTheme}
              type="button"
            >
              {theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
            </button>
            <button
              className={inspectorOpen ? "icon-button active" : "icon-button"}
              onClick={() => setInspectorOpen((current) => !current)}
              aria-label={t.toggleInspector}
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
                  <span className="eyebrow">{t.welcomeEyebrow}</span>
                  <h1>{t.welcomeTitle}</h1>
                  <p>{t.welcomeDescription}</p>
                  <div className="starter-grid">
                    {t.starterPrompts.map((item) => (
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
                          <strong>{message.role === "user" ? t.you : getModel(models, message.modelId ?? activeModel.id).name}</strong>
                          <span>{message.elapsedMs ? `${(message.elapsedMs / 1000).toFixed(1)}s` : message.status === "streaming" ? t.generating : ""}</span>
                        </div>
                      </div>
                      <div className={message.status === "error" ? "message-content error" : "message-content"}>
                        {message.attachments?.length ? (
                          <AttachmentStrip attachments={message.attachments} language={language} />
                        ) : null}
                        {message.reasoning && (
                          <details className="reasoning-block">
                            <summary>{t.reasoningTrace}</summary>
                            <div className="reasoning-markdown">
                              <Suspense fallback={<p>{message.reasoning}</p>}>
                                <MarkdownMessage content={message.reasoning} language={language} />
                              </Suspense>
                            </div>
                          </details>
                        )}
                        {message.content ? (
                          <Suspense fallback={<p>{message.content}</p>}>
                            <MarkdownMessage content={message.content} language={language} />
                          </Suspense>
                        ) : <div className="typing"><span /><span /><span /></div>}
                      </div>
                      {message.content && message.status !== "streaming" && (
                        <div className="message-actions">
                          <button onClick={() => void copyMessage(message)} type="button">
                            {copiedMessageId === message.id ? <Check size={14} /> : <Copy size={14} />}
                            {copiedMessageId === message.id ? t.copied : t.copy}
                          </button>
                          {message.role === "assistant" ? (
                            <button onClick={() => regenerate(message.id)} type="button"><RefreshCw size={14} />{t.regenerate}</button>
                          ) : (
                            <button onClick={() => editMessage(message.id)} type="button"><Pencil size={14} />{t.editFromHere}</button>
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
                {activeModelSupportsAttachments ? (
                  <>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept={ATTACHMENT_ACCEPT}
                      multiple
                      hidden
                      onChange={(event) => void handleFileSelection(event.target.files)}
                    />
                    {pendingAttachments.length ? (
                      <AttachmentStrip
                        attachments={pendingAttachments}
                        language={language}
                        onRemove={removePendingAttachment}
                        pending
                      />
                    ) : null}
                  </>
                ) : null}
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
                  placeholder={t.messageModel(activeModel.name)}
                  aria-label={t.messageAria}
                  disabled={generating}
                />
                <div className="composer-bottom">
                  <div className="composer-tools">
                    {activeModelSupportsAttachments ? (
                      <button
                        className="attach-button"
                        onClick={() => fileInputRef.current?.click()}
                        disabled={generating || attachmentBusy || pendingAttachments.length >= MAX_ATTACHMENTS_PER_MESSAGE}
                        type="button"
                        aria-label={t.attachFiles}
                        title={t.attachFiles}
                      >
                        {attachmentBusy ? <LoaderCircle className="spinning" size={17} /> : <Paperclip size={17} />}
                      </button>
                    ) : null}
                    <div className="composer-badges">
                      <button onClick={() => setModelPickerOpen(true)} type="button"><span className="model-dot" />{activeModel.name}</button>
                      <span>{formatContextWindow(activeModel.contextWindow, language)}</span>
                    </div>
                  </div>
                  {generating ? (
                    <button className="send-button stop" onClick={() => abortRef.current?.abort()} type="button" aria-label={t.stopGenerating}><Square size={15} fill="currentColor" /></button>
                  ) : (
                    <button
                      className="send-button"
                      onClick={() => void sendMessage()}
                      disabled={
                        (!composer.trim() && !(activeModelSupportsAttachments && pendingAttachments.length)) || attachmentBusy
                      }
                      type="button"
                      aria-label={t.sendMessage}
                    ><Send size={17} /></button>
                  )}
                </div>
              </div>
              {attachmentBusy ? <p className="attachment-status">{t.processingAttachment}</p> : null}
              {attachmentError ? <p className="attachment-error" role="alert">{attachmentError}</p> : null}
              <p className="composer-note">{t.modelCaution}</p>
            </div>
          </section>

          <aside className={inspectorOpen ? "inspector open" : "inspector"}>
            <div className="inspector-header">
              <div><span className="eyebrow">{t.modelInspector}</span><h2>{activeModel.name}</h2></div>
              <button className="icon-button" onClick={() => setInspectorOpen(false)} aria-label={t.closeInspector}><X size={17} /></button>
            </div>
            <p className="inspector-description">{getModelDescription(activeModel, language)}</p>
            <div className="inspector-stats">
              <div><span>{t.context}</span><strong>{formatContextWindow(activeModel.contextWindow, language).replace(language === "zh" ? " 上下文" : " context", "")}</strong></div>
              <div><span>{t.inputPerMillion}</span><strong>{formatPrice(activeModel.prices.input)}</strong></div>
              <div><span>{t.outputPerMillion}</span><strong>{formatPrice(activeModel.prices.output)}</strong></div>
            </div>
            <div className="inspector-section">
              <label htmlFor="system-prompt"><Settings2 size={14} />{t.systemPrompt}</label>
              <textarea
                id="system-prompt"
                rows={6}
                value={activeConversation.systemPrompt}
                onChange={(event) => updateConversation(activeConversation.id, (conversation) => ({ ...conversation, systemPrompt: event.target.value, updatedAt: now() }))}
              />
            </div>
            <div className="inspector-section">
              <div className="range-label"><label htmlFor="temperature">{t.temperature}</label><output>{activeConversation.temperature.toFixed(1)}</output></div>
              <input
                id="temperature"
                type="range"
                min="0"
                max="2"
                step="0.1"
                value={activeConversation.temperature}
                onChange={(event) => updateConversation(activeConversation.id, (conversation) => ({ ...conversation, temperature: Number(event.target.value), updatedAt: now() }))}
              />
              <div className="range-hints"><span>{t.precise}</span><span>{t.creative}</span></div>
            </div>
            <div className="inspector-section">
              <label htmlFor="max-tokens">{t.maxOutputTokens}</label>
              <input
                id="max-tokens"
                className="number-input"
                type="number"
                min="64"
                max={activeOutputTokenPolicy.maximum}
                step="256"
                value={activeConversation.maxTokens}
                onChange={(event) => updateConversation(activeConversation.id, (conversation) => ({
                  ...conversation,
                  maxTokens: clampOutputTokens(Number(event.target.value), activeOutputTokenPolicy),
                  maxTokensCustomized: true,
                  updatedAt: now(),
                }))}
              />
              <div className="number-hint">
                <span>{t.outputTokenRecommendation(
                  activeOutputTokenPolicy.recommended.toLocaleString(language === "zh" ? "zh-CN" : "en"),
                  activeOutputTokenPolicy.maximum.toLocaleString(language === "zh" ? "zh-CN" : "en"),
                )}</span>
                <button
                  type="button"
                  onClick={() => updateConversation(activeConversation.id, (conversation) => ({
                    ...conversation,
                    maxTokens: activeOutputTokenPolicy.recommended,
                    maxTokensCustomized: false,
                    updatedAt: now(),
                  }))}
                >{t.resetOutputTokens}</button>
              </div>
            </div>
            <div className="inspector-section">
              <span className="section-title">{t.capabilities}</span>
              <div className="inspector-capabilities">
                {activeModel.capabilities.length ? activeModel.capabilities.map((capability) => <span key={capability}>{getCapabilityLabel(capability, language)}</span>) : <span>{t.text}</span>}
                {activeModel.lora && <span>LoRA</span>}
                {activeModel.paid && <span className="paid">{t.paid}</span>}
              </div>
            </div>
            <button className="change-model" onClick={() => setModelPickerOpen(true)} type="button">{t.browseAllModels(models.length)}<ChevronDown size={15} /></button>
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
            language={language}
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
