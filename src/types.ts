export type Capability = "reasoning" | "tools" | "vision" | "coding";

export interface ModelInfo {
  id: string;
  name: string;
  provider: string;
  description: string;
  contextWindow: number;
  capabilities: Capability[];
  paid: boolean;
  lora: boolean;
  experimental?: boolean;
  prices: {
    input?: number;
    output?: number;
    cachedInput?: number;
  };
}

export type MessageRole = "user" | "assistant";

export interface Attachment {
  id: string;
  kind: "image" | "file";
  name: string;
  mimeType: string;
  size: number;
  dataUrl?: string;
  text?: string;
  tokens?: number;
  truncated?: boolean;
}

export interface GeneratedImage {
  id: string;
  dataUrl: string;
  modelId: string;
  modelName: string;
  prompt: string;
  width: number;
  height: number;
  seed?: number;
  elapsedMs?: number;
  operation?: ImageOperation;
  sourceImageIds?: string[];
}

export type ImageOperation = "generate" | "edit" | "variation" | "multi_reference";

export interface ImageGenerationState {
  status: "generating" | "complete" | "error";
  modelId: string;
  modelName: string;
  jobId?: string;
  prompt?: string;
  message?: string;
  operation?: ImageOperation;
  sourceImageIds?: string[];
}

export interface WebSource {
  title: string;
  url: string;
  domain: string;
}

export interface BrowserScreenshot {
  id: string;
  dataUrl: string;
  url: string;
  title: string;
  width: number;
  height: number;
  fullPage: boolean;
  viewport: "desktop" | "mobile";
  elapsedMs?: number;
}

export interface WebResearchState {
  status: "searching" | "reading" | "capturing" | "complete" | "error";
  query?: string;
  url?: string;
  message?: string;
  source?: WebSource;
}

export interface ChatMessage {
  id: string;
  role: MessageRole;
  content: string;
  reasoning?: string;
  createdAt: string;
  modelId?: string;
  status?: "streaming" | "complete" | "error";
  elapsedMs?: number;
  attachments?: Attachment[];
  generatedImages?: GeneratedImage[];
  imageGeneration?: ImageGenerationState;
  webResearch?: WebResearchState;
  webSources?: WebSource[];
  browserScreenshots?: BrowserScreenshot[];
  generationSessionId?: string;
  streamCursor?: number;
  recoveryState?: "connecting" | "recovering";
}

export interface Conversation {
  id: string;
  title: string;
  modelId: string;
  systemPrompt: string;
  temperature: number;
  maxTokens: number;
  maxTokensCustomized?: boolean;
  imageModelId: string;
  messages: ChatMessage[];
  createdAt: string;
  updatedAt: string;
}

export interface WorkspaceState {
  conversations: Conversation[];
  activeConversationId: string;
  favoriteModelIds: string[];
}

export interface StreamEvent {
  content?: string;
  reasoning?: string;
  done?: boolean;
  usage?: Record<string, number>;
  error?: string;
  generatedImage?: GeneratedImage;
  imageGeneration?: ImageGenerationState;
  webResearch?: WebResearchState;
  browserScreenshot?: BrowserScreenshot;
  cursor?: number;
  cancelled?: boolean;
}
