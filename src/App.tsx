import {
  Archive,
  AudioLines,
  Check,
  ChevronDown,
  Cloud,
  Copy,
  Download,
  Languages,
  LoaderCircle,
  LogOut,
  Menu,
  MessageSquareText,
  MoreHorizontal,
  Moon,
  PanelRight,
  Paperclip,
  Pause,
  Pencil,
  Plus,
  RefreshCw,
  Send,
  Settings2,
  Square,
  Sun,
  Trash2,
  Volume2,
  X,
} from "lucide-react";
import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
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
import { hasRenderableMessageOutput } from "./lib/message-output";
import {
  getMessageContentForRequest,
  getRetainedImageContextForRequest,
  stripInternalImageContext,
} from "./lib/chat-context";
import { isRecoverableStreamError, waitForPageVisible } from "./lib/stream-recovery";
import { waitForImageJob } from "./lib/image-jobs";
import { recoverInterruptedMessage } from "./lib/workspace-recovery";
import { formatElapsedDuration, formatMessageTimestamp } from "./lib/time";
import {
  prepareSpeechText,
  resolveSpeechRequest,
  type SpeechMode,
} from "./lib/speech";
import {
  DEFAULT_IMAGE_MODEL_ID,
  getImageModel,
  IMAGE_MODELS,
  isImageModelId,
} from "./lib/image-models";
import {
  disconnectCloudflare,
  getCloudflareAuthStatus,
  selectCloudflareAccount,
  type CloudflareAuthStatus,
} from "./lib/cloudflare-auth";
import type { Attachment, ChatMessage, Conversation, GeneratedImage, ModelInfo, WorkspaceState } from "./types";
import { AttachmentStrip } from "./components/AttachmentStrip";
import { GeneratedImageGallery } from "./components/GeneratedImageGallery";
import {
  CodeGlyph,
  CreationGlyph,
  IdeaGlyph,
  NeuronGlyph,
  PerspectiveGlyph,
} from "./components/ProductIcons";
import { ProviderLogo } from "./components/ProviderLogo";

const MarkdownMessage = lazy(() =>
  import("./components/MarkdownMessage").then((module) => ({ default: module.MarkdownMessage })),
);
const ModelPicker = lazy(() =>
  import("./components/ModelPicker").then((module) => ({ default: module.ModelPicker })),
);

const id = (): string => crypto.randomUUID();
const now = (): string => new Date().toISOString();
const MAX_CACHED_SPEECH_AUDIO = 12;
const normalizeComposerText = (value: string): string => value.replace(/\r\n?/g, "\n");
const insertComposerText = (editor: HTMLDivElement, value: string): string => {
  const selection = window.getSelection();
  if (!selection) return normalizeComposerText(editor.innerText);

  let range: Range;
  if (selection.rangeCount && editor.contains(selection.anchorNode)) {
    range = selection.getRangeAt(0);
    range.deleteContents();
  } else {
    range = document.createRange();
    range.selectNodeContents(editor);
    range.collapse(false);
  }

  const textNode = document.createTextNode(normalizeComposerText(value));
  range.insertNode(textNode);
  range.setStartAfter(textNode);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
  return normalizeComposerText(editor.innerText);
};
const LEGACY_VISION_MODEL_ID = "@cf/meta/llama-3.2-11b-vision-instruct";
const MAX_CONTEXT_ATTACHMENTS = 8;
const STARTER_ICONS = [IdeaGlyph, CodeGlyph, PerspectiveGlyph] as const;

interface SpeechPlayback {
  messageId: string;
  status: "loading" | "playing" | "paused";
}

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

const createConversation = (
  language: Language,
  modelId = DEFAULT_MODEL_ID,
  imageModelId = DEFAULT_IMAGE_MODEL_ID,
): Conversation => {
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
    imageModelId,
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
  const [cloudflareAuth, setCloudflareAuth] = useState<CloudflareAuthStatus>({
    configured: false,
    authenticated: false,
    publicPoolConfigured: false,
    accounts: [],
  });
  const [cloudflareAuthBusy, setCloudflareAuthBusy] = useState(true);
  const [cloudflareAuthError, setCloudflareAuthError] = useState<string | null>(null);
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const [revealedTimeMessageId, setRevealedTimeMessageId] = useState<string | null>(null);
  const [theme, setTheme] = useState<"dark" | "light">(
    () => (localStorage.getItem("neurondeck-theme-v2") as "dark" | "light" | null) ?? "light",
  );
  const [speechMode, setSpeechMode] = useState<SpeechMode>(
    () => localStorage.getItem("neurondeck-speech-mode") === "quality" ? "quality" : "economy",
  );
  const [speechPlayback, setSpeechPlayback] = useState<SpeechPlayback | null>(null);
  const [speechError, setSpeechError] = useState<{ messageId: string; message: string } | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const speechAbortRef = useRef<AbortController | null>(null);
  const speechAudioRef = useRef<HTMLAudioElement | null>(null);
  const speechUrlsRef = useRef(new Map<string, string>());
  const composerEditorRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const messageEndRef = useRef<HTMLDivElement | null>(null);
  const resumedImageJobsRef = useRef(false);

  const activeConversation =
    workspace.conversations.find((conversation) => conversation.id === workspace.activeConversationId) ??
    workspace.conversations[0];
  const activeModel = getModel(models, activeConversation.modelId);
  const activeModelSupportsAttachments = supportsMultimodalAttachments(activeModel);
  const activeModelSupportsTools = activeModel.capabilities.includes("tools");
  const activeImageModel = getImageModel(activeConversation.imageModelId);
  const activeOutputTokenPolicy = getOutputTokenPolicy(activeModel.contextWindow);
  const siteQuotaLabel = cloudflareAuth.publicPoolConfigured ? t.cloudflarePublicPool : t.cloudflareSiteQuota;
  const siteQuotaDescription = cloudflareAuth.publicPoolConfigured
    ? t.cloudflarePublicPoolDescription
    : t.cloudflareAccountDescription;
  const attachmentTarget = `${activeConversation.id}:${activeModel.id}`;
  const attachmentTargetRef = useRef(attachmentTarget);
  attachmentTargetRef.current = attachmentTarget;

  const stopSpeechPlayback = useCallback(() => {
    speechAbortRef.current?.abort();
    speechAbortRef.current = null;
    speechAudioRef.current?.pause();
    speechAudioRef.current = null;
    setSpeechPlayback(null);
  }, []);

  useEffect(() => {
    localStorage.setItem("neurondeck-speech-mode", speechMode);
  }, [speechMode]);

  useEffect(() => {
    stopSpeechPlayback();
    setSpeechError(null);
  }, [activeConversation.id, speechMode, stopSpeechPlayback]);

  useEffect(() => () => {
    speechAbortRef.current?.abort();
    speechAudioRef.current?.pause();
    for (const url of speechUrlsRef.current.values()) URL.revokeObjectURL(url);
    speechUrlsRef.current.clear();
  }, []);

  useEffect(() => {
    let active = true;
    const callbackStatus = new URL(window.location.href).searchParams.get("cloudflare");
    if (callbackStatus) {
      const cleanUrl = new URL(window.location.href);
      cleanUrl.searchParams.delete("cloudflare");
      window.history.replaceState({}, "", `${cleanUrl.pathname}${cleanUrl.search}${cleanUrl.hash}`);
    }
    void getCloudflareAuthStatus()
      .then((status) => {
        if (!active) return;
        setCloudflareAuth(status);
        setCloudflareAuthError(callbackStatus === "error" || callbackStatus === "denied"
          ? t.cloudflareAuthFailed
          : status.error ?? null);
      })
      .catch((error) => {
        if (active) setCloudflareAuthError(error instanceof Error ? error.message : t.cloudflareAuthFailed);
      })
      .finally(() => {
        if (active) setCloudflareAuthBusy(false);
      });
    return () => {
      active = false;
    };
  }, [t.cloudflareAuthFailed]);

  useEffect(() => {
    if (!revealedTimeMessageId) return;
    const timeout = window.setTimeout(() => setRevealedTimeMessageId(null), 3_200);
    return () => window.clearTimeout(timeout);
  }, [revealedTimeMessageId]);

  useLayoutEffect(() => {
    const editor = composerEditorRef.current;
    if (!editor || editor.innerText === composer) return;
    editor.innerText = composer;
  }, [composer]);

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
            messages: conversation.messages.map((message) => {
              const recovered = recoverInterruptedMessage(message, translations[language].generationInterrupted);
              return { ...recovered, content: stripInternalImageContext(recovered.content) };
            }),
            modelId,
            imageModelId: isImageModelId(conversation.imageModelId)
              ? conversation.imageModelId
              : DEFAULT_IMAGE_MODEL_ID,
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
    const catalogUrl = `/api/models?catalog=${encodeURIComponent(CATALOG_SYNCED_AT)}`;
    void fetch(catalogUrl, { cache: "no-store" })
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

  const connectCloudflare = () => {
    setCloudflareAuthBusy(true);
    window.location.assign("/api/auth/cloudflare/start");
  };

  const changeCloudflareAccount = async (accountId: string) => {
    setCloudflareAuthBusy(true);
    setCloudflareAuthError(null);
    try {
      await selectCloudflareAccount(accountId);
      setCloudflareAuth(await getCloudflareAuthStatus());
    } catch (error) {
      setCloudflareAuthError(error instanceof Error ? error.message : t.cloudflareAuthFailed);
    } finally {
      setCloudflareAuthBusy(false);
    }
  };

  const logoutCloudflare = async () => {
    setCloudflareAuthBusy(true);
    setCloudflareAuthError(null);
    try {
      await disconnectCloudflare();
      setCloudflareAuth(await getCloudflareAuthStatus());
    } catch (error) {
      setCloudflareAuthError(error instanceof Error ? error.message : t.cloudflareAuthFailed);
    } finally {
      setCloudflareAuthBusy(false);
    }
  };

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

  useEffect(() => {
    if (!hydrated || resumedImageJobsRef.current) return;
    resumedImageJobsRef.current = true;
    const controllers: AbortController[] = [];
    for (const conversation of workspace.conversations) {
      for (const message of conversation.messages) {
        const jobId = message.imageGeneration?.status === "generating"
          ? message.imageGeneration.jobId
          : undefined;
        if (!jobId || message.generatedImages?.length) continue;
        const controller = new AbortController();
        controllers.push(controller);
        void waitForImageJob({
          jobId,
          clientId: getClientId(),
          signal: controller.signal,
          language,
        }).then((image) => {
          updateMessage(conversation.id, message.id, (current) => ({
            ...current,
            content: current.content || t.imageGeneratedFallback,
            generatedImages: current.generatedImages?.some((item) => item.id === image.id)
              ? current.generatedImages
              : [...(current.generatedImages ?? []), image],
            imageGeneration: {
              status: "complete",
              modelId: image.modelId,
              modelName: image.modelName,
              prompt: image.prompt,
            },
            status: "complete",
          }));
        }).catch((error) => {
          if (controller.signal.aborted) return;
          updateMessage(conversation.id, message.id, (current) => ({
            ...current,
            content: current.content || (error instanceof Error ? error.message : t.generationFailed),
            imageGeneration: {
              ...current.imageGeneration!,
              status: "error",
              message: error instanceof Error ? error.message : t.generationFailed,
            },
            status: "error",
          }));
        });
      }
    }
    return () => controllers.forEach((controller) => controller.abort());
  }, [hydrated]);

  const generateResponse = useCallback(
    async (conversation: Conversation, contextMessages: ChatMessage[], assistantId: string) => {
      const controller = new AbortController();
      abortRef.current = controller;
      setGenerating(true);
      const startedAt = performance.now();
      let content = "";
      let reasoning = "";
      let generatedImages: GeneratedImage[] = [];
      let pendingImageJobId: string | undefined;

      const recoverPendingImage = async (): Promise<boolean> => {
        if (!pendingImageJobId) return false;
        const image = await waitForImageJob({
          jobId: pendingImageJobId,
          clientId: getClientId(),
          signal: controller.signal,
          language,
        });
        pendingImageJobId = undefined;
        if (!generatedImages.some((item) => item.id === image.id)) generatedImages = [...generatedImages, image];
        updateMessage(conversation.id, assistantId, (message) => ({
          ...message,
          generatedImages,
          imageGeneration: {
            status: "complete",
            modelId: image.modelId,
            modelName: image.modelName,
            prompt: image.prompt,
          },
          status: "streaming",
        }));
        return true;
      };

      const requestMessages = pruneAttachmentsForRequest(contextMessages, conversation.modelId);
      const apiMessages = [
        ...(conversation.systemPrompt.trim()
          ? [{ role: "system" as const, content: conversation.systemPrompt.trim() }]
          : []),
        ...requestMessages.map((message) => {
          const retainedImageContext = getRetainedImageContextForRequest(message);
          return {
            role: message.role,
            content: getMessageContentForRequest(message),
            ...(message.attachments?.length ? { attachments: message.attachments } : {}),
            ...(retainedImageContext ? { retainedImageContext } : {}),
          };
        }),
      ];
      const requestBody = JSON.stringify({
        model: conversation.modelId,
        messages: apiMessages,
        temperature: conversation.temperature,
        maxTokens: conversation.maxTokens,
        imageModel: conversation.imageModelId,
      });

      try {
        let recoveryAttempts = 0;
        while (true) {
          try {
            const response = await fetch("/api/chat", {
              method: "POST",
              headers: {
                "content-type": "application/json",
                "x-neurondeck-client": getClientId(),
                "accept-language": language === "zh" ? "zh-CN" : "en",
              },
              body: requestBody,
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
              if (event.content) content = stripInternalImageContext(content + event.content);
              if (event.reasoning) reasoning += event.reasoning;
              if (event.imageGeneration?.status === "generating" && event.imageGeneration.jobId) {
                pendingImageJobId = event.imageGeneration.jobId;
              }
              if (event.imageGeneration?.status === "error") pendingImageJobId = undefined;
              if (event.generatedImage) {
                pendingImageJobId = undefined;
                generatedImages = [...generatedImages, event.generatedImage];
              }
              if (event.content || event.reasoning || event.generatedImage || event.imageGeneration) {
                updateMessage(conversation.id, assistantId, (message) => ({
                  ...message,
                  content,
                  reasoning,
                  generatedImages,
                  imageGeneration: event.imageGeneration ??
                    (event.generatedImage
                      ? {
                          status: "complete",
                          modelId: event.generatedImage.modelId,
                          modelName: event.generatedImage.modelName,
                          prompt: event.generatedImage.prompt,
                        }
                      : message.imageGeneration),
                  status: "streaming",
                }));
              }
            });
            await recoverPendingImage();
            break;
          } catch (error) {
            if (controller.signal.aborted) throw new DOMException("Aborted", "AbortError");
            if (isRecoverableStreamError(error) && generatedImages.length) break;
            if (isRecoverableStreamError(error) && pendingImageJobId) {
              await recoverPendingImage();
              break;
            }
            if (!isRecoverableStreamError(error) || recoveryAttempts >= 1) throw error;

            recoveryAttempts += 1;
            await waitForPageVisible(controller.signal);
            content = "";
            reasoning = "";
            generatedImages = [];
            updateMessage(conversation.id, assistantId, (message) => ({
              ...message,
              content: "",
              reasoning: "",
              generatedImages: [],
              imageGeneration: undefined,
              status: "streaming",
            }));
          }
        }

        updateMessage(conversation.id, assistantId, (message) => ({
          ...message,
          content: content || (generatedImages.length ? t.imageGeneratedFallback : t.emptyCompletion),
          reasoning,
          generatedImages,
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
          generatedImages,
          status: stopped ? "complete" : "error",
          elapsedMs: Math.round(performance.now() - startedAt),
        }));
      } finally {
        abortRef.current = null;
        setGenerating(false);
      }
    },
    [
      language,
      t.emptyCompletion,
      t.generationFailed,
      t.generationStopped,
      t.imageGeneratedFallback,
      t.requestFailed,
      updateMessage,
    ],
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
    window.setTimeout(() => composerEditorRef.current?.focus(), 0);
  };

  const copyMessage = async (message: ChatMessage) => {
    await navigator.clipboard.writeText(message.content);
    setCopiedMessageId(message.id);
    window.setTimeout(() => setCopiedMessageId(null), 1400);
  };

  const toggleSpeech = useCallback(async (message: ChatMessage) => {
    if (speechPlayback?.messageId === message.id) {
      if (speechPlayback.status === "loading") return;
      const audio = speechAudioRef.current;
      if (!audio) return;
      if (speechPlayback.status === "playing") {
        audio.pause();
        setSpeechPlayback({ messageId: message.id, status: "paused" });
        return;
      }
      try {
        await audio.play();
        setSpeechPlayback({ messageId: message.id, status: "playing" });
      } catch {
        setSpeechPlayback({ messageId: message.id, status: "paused" });
      }
      return;
    }

    stopSpeechPlayback();
    setSpeechError(null);
    const text = prepareSpeechText(message.content);
    if (!text) {
      setSpeechError({ messageId: message.id, message: t.errors.invalid_tts_text });
      return;
    }

    const selection = resolveSpeechRequest(speechMode, text, language);
    const cacheKey = `${message.id}:${speechMode}:${selection.model}:${selection.language}`;
    let audioUrl = speechUrlsRef.current.get(cacheKey);
    if (!audioUrl) {
      const controller = new AbortController();
      speechAbortRef.current = controller;
      setSpeechPlayback({ messageId: message.id, status: "loading" });
      try {
        const response = await fetch("/api/tts", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-neurondeck-client": getClientId(),
            "accept-language": language === "zh" ? "zh-CN" : "en",
          },
          body: JSON.stringify({ text, model: selection.model, language: selection.language }),
          signal: controller.signal,
        });
        if (!response.ok) {
          const data = (await response.json().catch(() => null)) as
            | { error?: { code?: string; message?: string } }
            | null;
          throw new Error(getLocalizedError(
            language,
            data?.error?.code,
            data?.error?.message || t.speechFailed,
          ));
        }
        const audio = await response.blob();
        if (!audio.size || !audio.type.toLowerCase().startsWith("audio/")) throw new Error(t.speechFailed);
        audioUrl = URL.createObjectURL(audio);
        if (speechUrlsRef.current.size >= MAX_CACHED_SPEECH_AUDIO) {
          const oldest = speechUrlsRef.current.entries().next().value as [string, string] | undefined;
          if (oldest) {
            URL.revokeObjectURL(oldest[1]);
            speechUrlsRef.current.delete(oldest[0]);
          }
        }
        speechUrlsRef.current.set(cacheKey, audioUrl);
      } catch (error) {
        if (controller.signal.aborted) return;
        setSpeechPlayback(null);
        setSpeechError({
          messageId: message.id,
          message: error instanceof Error ? error.message : t.speechFailed,
        });
        return;
      } finally {
        if (speechAbortRef.current === controller) speechAbortRef.current = null;
      }
    }

    const audio = new Audio(audioUrl);
    speechAudioRef.current = audio;
    audio.onended = () => {
      if (speechAudioRef.current !== audio) return;
      speechAudioRef.current = null;
      setSpeechPlayback(null);
    };
    audio.onerror = () => {
      if (speechAudioRef.current !== audio) return;
      speechAudioRef.current = null;
      if (speechUrlsRef.current.get(cacheKey) === audioUrl) {
        speechUrlsRef.current.delete(cacheKey);
        URL.revokeObjectURL(audioUrl);
      }
      setSpeechPlayback(null);
      setSpeechError({ messageId: message.id, message: t.speechFailed });
    };
    try {
      await audio.play();
      setSpeechPlayback({ messageId: message.id, status: "playing" });
    } catch {
      setSpeechPlayback({ messageId: message.id, status: "paused" });
    }
  }, [language, speechMode, speechPlayback, stopSpeechPlayback, t.errors.invalid_tts_text, t.speechFailed]);

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
    const conversation = createConversation(language, activeConversation.modelId, activeConversation.imageModelId);
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
        ...(message.generatedImages?.length
          ? message.generatedImages.flatMap((image) => [
              `${t.imageModel}: ${image.modelName}`,
              `${image.width} × ${image.height} · ${image.prompt}`,
              "",
            ])
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
          <div className="brand-mark"><NeuronGlyph /></div>
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
            <div className="conversation-row" key={conversation.id}>
              <button
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
                <span className="conversation-meta">{getModel(models, conversation.modelId).name}</span>
              </button>
              <button
                className="conversation-delete"
                type="button"
                disabled={generating}
                aria-label={`${t.deleteConversation}：${conversationTitle(conversation.title)}`}
                title={t.deleteConversation}
                onClick={() => deleteConversation(conversation.id)}
              >
                <Trash2 size={15} />
              </button>
            </div>
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
            <span className="active-model-mark"><ProviderLogo provider={activeModel.provider} /></span>
            <span><small>{activeModel.provider}</small>{activeModel.name}</span>
            <ChevronDown size={16} />
          </button>
          <div className="topbar-actions">
            <button
              className={cloudflareAuth.authenticated ? "cloud-account-button connected" : "cloud-account-button"}
              onClick={() => setInspectorOpen(true)}
              aria-label={t.cloudflareAccount}
              title={cloudflareAuth.authenticated ? cloudflareAuth.activeAccountName : siteQuotaLabel}
              type="button"
            >
              <Cloud size={17} />
              <span>{cloudflareAuth.authenticated ? cloudflareAuth.activeAccountName : siteQuotaLabel}</span>
            </button>
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
                  <div className="welcome-orbit"><NeuronGlyph /></div>
                  <span className="eyebrow">{t.welcomeEyebrow}</span>
                  <h1>{t.welcomeTitle}</h1>
                  <p>{t.welcomeDescription}</p>
                  <div className="starter-grid">
                    {t.starterPrompts.map((item, index) => {
                      const StarterIcon = STARTER_ICONS[index % STARTER_ICONS.length];
                      return (
                        <button key={item.label} type="button" onClick={() => {
                          setComposer(item.prompt);
                          window.setTimeout(() => composerEditorRef.current?.focus(), 0);
                        }}>
                          <span className="starter-icon"><StarterIcon /></span>
                          <strong>{item.label}</strong>
                          <span className="starter-prompt">{item.prompt}</span>
                        </button>
                      );
                    })}
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
                          <div className="avatar ai-avatar"><NeuronGlyph /></div>
                        )}
                        <div>
                          <strong>{message.role === "user" ? t.you : getModel(models, message.modelId ?? activeModel.id).name}</strong>
                          <span>{message.elapsedMs != null ? formatElapsedDuration(message.elapsedMs, language) : message.status === "streaming" ? t.generating : ""}</span>
                        </div>
                      </div>
                      <div className={message.status === "error" ? "message-content error" : "message-content"}>
                        {message.attachments?.length ? (
                          <AttachmentStrip attachments={message.attachments} language={language} />
                        ) : null}
                        <GeneratedImageGallery
                          images={message.generatedImages}
                          state={message.imageGeneration}
                          language={language}
                        />
                        {message.reasoning && (
                          <details className="reasoning-block" open={message.status === "streaming"}>
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
                        ) : message.imageGeneration || message.generatedImages?.length ? null : (
                          <div className="typing"><span /><span /><span /></div>
                        )}
                      </div>
                      {hasRenderableMessageOutput(message) && message.status !== "streaming" && (
                        <div className="message-actions">
                          <button onClick={() => void copyMessage(message)} type="button">
                            {copiedMessageId === message.id ? <Check size={14} /> : <Copy size={14} />}
                            {copiedMessageId === message.id ? t.copied : t.copy}
                          </button>
                          {message.role === "assistant" ? (
                            <>
                              {message.content ? (
                                <button
                                  className={speechPlayback?.messageId === message.id ? "speech-action active" : "speech-action"}
                                  onClick={() => void toggleSpeech(message)}
                                  disabled={speechPlayback?.messageId === message.id && speechPlayback.status === "loading"}
                                  type="button"
                                  aria-pressed={speechPlayback?.messageId === message.id && speechPlayback.status === "playing"}
                                >
                                  {speechPlayback?.messageId === message.id && speechPlayback.status === "loading"
                                    ? <LoaderCircle className="spinning" size={14} />
                                    : speechPlayback?.messageId === message.id && speechPlayback.status === "playing"
                                      ? <Pause size={14} />
                                      : <Volume2 size={14} />}
                                  {speechPlayback?.messageId === message.id && speechPlayback.status === "loading"
                                    ? t.preparingSpeech
                                    : speechPlayback?.messageId === message.id && speechPlayback.status === "playing"
                                      ? t.pauseSpeech
                                      : speechPlayback?.messageId === message.id && speechPlayback.status === "paused"
                                        ? t.resumeSpeech
                                        : t.readAloud}
                                </button>
                              ) : null}
                              <button onClick={() => regenerate(message.id)} type="button"><RefreshCw size={14} />{t.regenerate}</button>
                            </>
                          ) : (
                            <button onClick={() => editMessage(message.id)} type="button"><Pencil size={14} />{t.editFromHere}</button>
                          )}
                          <button
                            className="message-time-toggle"
                            type="button"
                            aria-label={t.showMessageTime}
                            aria-expanded={revealedTimeMessageId === message.id}
                            onClick={() => setRevealedTimeMessageId((current) => current === message.id ? null : message.id)}
                          ><MoreHorizontal size={14} /></button>
                          <time
                            className={revealedTimeMessageId === message.id ? "message-time revealed" : "message-time"}
                            dateTime={message.createdAt}
                            title={new Date(message.createdAt).toLocaleString(language === "zh" ? "zh-CN" : "en-US")}
                          >{formatMessageTimestamp(message.createdAt, language)}</time>
                          {speechError?.messageId === message.id ? (
                            <span className="speech-error" role="alert" title={speechError.message}>{speechError.message}</span>
                          ) : null}
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
                <div
                  id="chat-composer"
                  ref={composerEditorRef}
                  className="composer-editor"
                  role="textbox"
                  aria-multiline="true"
                  contentEditable={!generating}
                  suppressContentEditableWarning
                  tabIndex={0}
                  onInput={(event) => setComposer(normalizeComposerText(event.currentTarget.innerText))}
                  onKeyDown={(event) => {
                    if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
                    event.preventDefault();
                    if (event.shiftKey) {
                      setComposer(insertComposerText(event.currentTarget, "\n"));
                      return;
                    }
                    void sendMessage();
                  }}
                  onPaste={(event) => {
                    event.preventDefault();
                    setComposer(insertComposerText(event.currentTarget, event.clipboardData.getData("text/plain")));
                  }}
                  data-placeholder={t.messageModel(activeModel.name)}
                  aria-label={t.messageAria}
                  autoCapitalize="sentences"
                  autoCorrect="on"
                  inputMode="text"
                  enterKeyHint="send"
                  spellCheck
                  aria-disabled={generating}
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
                      <button onClick={() => setModelPickerOpen(true)} type="button"><span className="active-model-mark"><ProviderLogo provider={activeModel.provider} /></span>{activeModel.name}</button>
                      {activeModelSupportsTools ? (
                        <span className="image-tool-badge"><CreationGlyph />{t.imageToolBadge(activeImageModel.name)}</span>
                      ) : null}
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
            <div className="inspector-section cloudflare-account-section">
              <span className="section-title"><Cloud size={15} />{t.cloudflareAccount}</span>
              <div className={cloudflareAuth.authenticated ? "cloudflare-account-card connected" : "cloudflare-account-card"}>
                <div className="cloudflare-account-heading">
                  <span className="cloudflare-mark"><Cloud size={18} /></span>
                  <div>
                    <strong>{cloudflareAuth.authenticated ? cloudflareAuth.activeAccountName : siteQuotaLabel}</strong>
                    <span>{cloudflareAuth.authenticated ? t.cloudflareConnected : siteQuotaDescription}</span>
                  </div>
                </div>
                {cloudflareAuth.authenticated ? (
                  <>
                    {cloudflareAuth.accounts.length > 1 ? (
                      <label className="cloudflare-account-select">
                        <span>{t.cloudflareSelectAccount}</span>
                        <select
                          value={cloudflareAuth.activeAccountId}
                          disabled={cloudflareAuthBusy}
                          onChange={(event) => void changeCloudflareAccount(event.target.value)}
                        >
                          {cloudflareAuth.accounts.map((account) => (
                            <option key={account.id} value={account.id}>{account.name}</option>
                          ))}
                        </select>
                      </label>
                    ) : null}
                    <button className="cloudflare-disconnect" type="button" disabled={cloudflareAuthBusy} onClick={() => void logoutCloudflare()}>
                      {cloudflareAuthBusy ? <LoaderCircle className="spinning" size={14} /> : <LogOut size={14} />}
                      {t.cloudflareDisconnect}
                    </button>
                  </>
                ) : (
                  <button className="cloudflare-connect" type="button" disabled={cloudflareAuthBusy || !cloudflareAuth.configured} onClick={connectCloudflare}>
                    {cloudflareAuthBusy ? <LoaderCircle className="spinning" size={15} /> : <Cloud size={15} />}
                    {cloudflareAuthBusy ? t.cloudflareConnecting : cloudflareAuth.configured ? t.cloudflareConnect : t.cloudflareUnavailable}
                  </button>
                )}
              </div>
              {cloudflareAuthError ? <p className="cloudflare-auth-error" role="alert">{cloudflareAuthError}</p> : null}
              <p className="cloudflare-auth-privacy">{t.cloudflareAccountPrivacy}</p>
            </div>
            <div className="inspector-section">
              <label htmlFor="system-prompt"><Settings2 size={14} />{t.systemPrompt}</label>
              <textarea
                id="system-prompt"
                name="system-prompt"
                rows={6}
                value={activeConversation.systemPrompt}
                onChange={(event) => updateConversation(activeConversation.id, (conversation) => ({ ...conversation, systemPrompt: event.target.value, updatedAt: now() }))}
                aria-autocomplete="none"
                autoComplete="off"
                data-form-type="other"
                data-1p-ignore="true"
                data-lpignore="true"
                data-bwignore="true"
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
            <div className="inspector-section speech-model-section">
              <span className="section-title"><AudioLines />{t.speechModel}</span>
              <p>{t.speechModelDescription}</p>
              <div className="speech-model-options" role="radiogroup" aria-label={t.speechModel}>
                <button
                  className={speechMode === "quality" ? "speech-model-option selected" : "speech-model-option"}
                  type="button"
                  role="radio"
                  aria-checked={speechMode === "quality"}
                  onClick={() => setSpeechMode("quality")}
                >
                  <span className="speech-provider-mark aura"><AudioLines /></span>
                  <span className="speech-model-copy">
                    <strong>{t.speechQuality}</strong>
                    <small>{t.speechQualitySummary}</small>
                    <i>{t.speechQualityPrice}</i>
                  </span>
                  <span className="speech-model-check">{speechMode === "quality" ? <Check size={14} /> : null}</span>
                </button>
                <button
                  className={speechMode === "economy" ? "speech-model-option selected" : "speech-model-option"}
                  type="button"
                  role="radio"
                  aria-checked={speechMode === "economy"}
                  onClick={() => setSpeechMode("economy")}
                >
                  <span className="speech-provider-mark melo">M</span>
                  <span className="speech-model-copy">
                    <strong>{t.speechEconomy}<em>{t.speechDefault}</em></strong>
                    <small>{t.speechEconomySummary}</small>
                    <i>{t.speechEconomyPrice}</i>
                  </span>
                  <span className="speech-model-check">{speechMode === "economy" ? <Check size={14} /> : null}</span>
                </button>
              </div>
            </div>
            {activeModelSupportsTools ? (
              <div className="inspector-section image-model-section">
                <span className="section-title"><CreationGlyph />{t.imageModel}</span>
                <p>{t.imageModelDescription}</p>
                <div className="image-model-options" role="radiogroup" aria-label={t.imageModel}>
                  {IMAGE_MODELS.map((imageModel) => {
                    const selected = activeConversation.imageModelId === imageModel.id;
                    return (
                      <button
                        className={selected ? "image-model-option selected" : "image-model-option"}
                        key={imageModel.id}
                        type="button"
                        role="radio"
                        aria-checked={selected}
                        onClick={() => updateConversation(activeConversation.id, (conversation) => ({
                          ...conversation,
                          imageModelId: imageModel.id,
                          updatedAt: now(),
                        }))}
                      >
                        <span className={`image-provider-mark ${imageModel.provider === "Leonardo" ? "leonardo" : "flux"}`}>
                          {imageModel.provider === "Leonardo" ? "L" : (
                            <svg aria-hidden="true" viewBox="0 0 24 24">
                              <path d="M0 20.7 12 2.5l12 18.2h-2.2L12 5.9 3.5 18.8h12.1l1.2 1.9Z" />
                              <path d="m8.1 16.7 2-3.1 2.1 3.1Zm10.1 4-5.6-8.7h2.1l5.7 8.7Z" />
                            </svg>
                          )}
                        </span>
                        <span className="image-model-copy">
                          <strong>{imageModel.name}{imageModel.id === DEFAULT_IMAGE_MODEL_ID ? <em>{t.imageModelDefault}</em> : null}</strong>
                          <small>{imageModel.summary[language]}</small>
                          <i>{imageModel.price[language]}</i>
                        </span>
                        <span className="image-model-check">{selected ? <Check size={14} /> : null}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : null}
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
