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
}

export interface ImageGenerationState {
  status: "generating" | "complete" | "error";
  modelId: string;
  modelName: string;
  prompt?: string;
  message?: string;
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
}
