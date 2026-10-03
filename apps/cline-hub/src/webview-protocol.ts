import type {
	ChatMessage as CoreChatMessage,
	ProviderListItem,
	ProviderModel,
} from "@cline/core";
import type { GeneratedMedia } from "@cline/shared";

export type WebviewUsage = {
	inputTokens?: number;
	outputTokens?: number;
	cacheCreationInputTokens?: number;
	cacheReadInputTokens?: number;
	totalCost?: number;
};

export type WebviewProviderModel = Pick<
	ProviderModel,
	| "id"
	| "name"
	| "operation"
	| "supportsReasoning"
	| "inputModalities"
	| "outputModalities"
> & {
	supportsThinking?: boolean;
};

export type WebviewProviderCatalogItem = ProviderListItem;

export type WebviewReasonLevel = "none" | "low" | "medium" | "high";

export type WebviewToolEvent = {
	toolCallId?: string;
	toolName?: string;
	status: "running" | "completed" | "failed";
	input?: unknown;
	output?: unknown;
	error?: string;
};

export type WebviewChatMessageBlock =
	| { id: string; type: "text"; text: string }
	| { id: string; type: "reasoning"; text: string; redacted?: boolean }
	| { id: string; type: "media"; media: GeneratedMedia }
	| {
			id: string;
			type: "tool";
			toolEvent: NonNullable<WebviewChatMessage["toolEvents"]>[number];
	  };

export type WebviewChatMessage = Omit<
	CoreChatMessage,
	"content" | "createdAt" | "meta" | "role" | "sessionId"
> & {
	role:
		| Extract<CoreChatMessage["role"], "user" | "assistant" | "error">
		| "meta";
	text: string;
	reasoning?: string;
	reasoningRedacted?: boolean;
	checkpoint?: NonNullable<CoreChatMessage["meta"]>["checkpoint"];
	toolEvents?: Array<{
		id: string;
		toolCallId?: string;
		name: string;
		text: string;
		state: "input-available" | "output-available" | "output-error";
		input?: unknown;
		output?: unknown;
		error?: string;
	}>;
	blocks?: WebviewChatMessageBlock[];
};

export type WebviewConfig = {
	provider?: string;
	model?: string;
	/**
	 * Launch folder for a new session. The server's resolveLaunchContext accepts
	 * these as a session-context override, which is how a peer recovers a session
	 * the hub no longer holds in memory (same folder, same provider/model).
	 */
	workspaceRoot?: string;
	cwd?: string;
	mode?: "act" | "plan";
	systemPrompt?: string;
	maxIterations?: number;
	reasonLevel?: WebviewReasonLevel;
	enableTools?: boolean;
	enableSpawn?: boolean;
	enableTeams?: boolean;
	autoApproveTools?: boolean;
};

export type WebviewChatAttachments = {
	userImages?: string[];
};

export type WebviewToolApprovalRequest = {
	approvalId: string;
	sessionId: string;
	agentId: string;
	conversationId: string;
	iteration: number;
	toolCallId: string;
	toolName: string;
	input: unknown;
	policy?: Record<string, unknown>;
};

/**
 * A follow-up question (`ask_question` / `ask_followup_question`) the agent is
 * waiting on. Peers render it as selectable options plus a free-form answer.
 *
 * `remote` marks a question raised inside a session owned by another hub
 * client (Cline Desktop, the CLI). The hub routes that question to its owning
 * client, so answering from the browser is a best effort: the dashboard relays
 * the answer, and when the hub refuses a non-owner answer it aborts the
 * blocked turn and delivers the answer as the next prompt.
 */
export type WebviewQuestionRequest = {
	type: "question_request";
	questionId: string;
	sessionId: string;
	question: string;
	options: string[];
	remote?: boolean;
	createdAt?: number;
};

export type WebviewQuestionResolved = {
	type: "question_resolved";
	questionId: string;
	answer?: string;
};

export type WebviewDefaults = {
	provider?: string;
	model?: string;
	workspaceRoot: string;
	cwd: string;
};

export type WebviewSessionSummary = {
	sessionId: string;
	title?: string;
	status?: string;
	source?: string;
	providerId?: string;
	model?: string;
	workspaceRoot?: string;
	createdAt?: number;
	updatedAt?: number;
	inputTokens?: number;
	outputTokens?: number;
	totalCost?: number;
};

export type WebviewConnectedClient = {
	clientId: string;
	displayName?: string;
	clientType: string;
	version?: string;
	pid?: number;
	connectedAt: number;
};

export type WebviewClientSummary = {
	label: string;
	name: string;
	sessionCount: number;
};

export type WebviewConnectorField = {
	flag: string;
	label: string;
	placeholder?: string;
	required?: boolean;
	help?: string[];
	initialValue?: string;
	options?: Array<{ value: string; label: string; hint?: string }>;
	includeWhen?: {
		flag: string;
		equals?: string;
		notEquals?: string;
	};
};

export type WebviewConnectorSecurityField = {
	key: string;
	label: string;
	placeholder?: string;
	help?: string[];
	requiredMessage: string;
};

export type WebviewConnectorChannel = {
	id: string;
	name: string;
	type: "polling" | "webhook" | "hybrid";
	hint: string;
	fields: WebviewConnectorField[];
	security?: {
		prompt: string;
		fields: WebviewConnectorSecurityField[];
	};
};

export type WebviewActiveConnector = {
	id: string;
	type: string;
	pid: number;
	hubUrl: string;
	startedAt?: string;
	applicationId?: string;
	botUsername?: string;
	userName?: string;
	phoneNumberId?: string;
	port?: number;
	baseUrl?: string;
	connectionMode?: string;
};

export type WebviewConnectorChannelsResponse = {
	available: WebviewConnectorChannel[];
	active: WebviewActiveConnector[];
};

export type WebviewActionSessionSummary = {
	sessionId: string;
	title: string;
	status: string;
	workspaceRoot: string;
	workspaceName: string;
	cwd?: string;
	model?: string;
	provider?: string;
	createdAt: number;
	updatedAt: number;
	createdByClientId?: string;
	prompt?: string;
	inputTokens?: number;
	outputTokens?: number;
	totalCost?: number;
	agentCount: number;
};

export type WebviewHubEvent = {
	id: string;
	title: string;
	body: string;
	severity: "info" | "success" | "warn" | "error";
	timestamp: number;
};

export type WebviewHubState = {
	type: "hub_state";
	connected: boolean;
	hubUrl?: string;
	hubStartedAt?: string;
	coreVersion?: string;
	hubUptime?: string;
	clients: WebviewConnectedClient[];
	connectors: WebviewActiveConnector[];
	sessions: WebviewActionSessionSummary[];
	clientSummaries: WebviewClientSummary[];
	sessionSummaries: WebviewActionSessionSummary[];
	events: WebviewHubEvent[];
	lastWorkspaceRoot?: string;
};

export type WebviewInboundMessage =
	| { type: "ready" }
	| { type: "restart_hub" }
	| {
			type: "desktopCommand";
			id: string;
			command: string;
			args?: Record<string, unknown>;
	  }
	| {
			type: "send";
			prompt: string;
			config?: WebviewConfig;
			attachments?: WebviewChatAttachments;
	  }
	| { type: "abort" }
	| { type: "reset" }
	| {
			type: "approval_response";
			approvalId: string;
			approved: boolean;
			reason?: string;
	  }
	| {
			type: "question_response";
			questionId: string;
			answer: string;
	  }
	| { type: "loadModels"; providerId: string }
	| { type: "loadProviderCatalog" }
	| {
			type: "saveProviderSettings";
			providerId: string;
			enabled?: boolean;
			apiKey?: string;
			baseUrl?: string;
	  }
	| { type: "runProviderOAuthLogin"; providerId: string }
	| { type: "attachSession"; sessionId: string }
	| { type: "deleteSession"; sessionId: string }
	| {
			type: "updateSessionMetadata";
			sessionId: string;
			metadata: Record<string, unknown>;
	  }
	| { type: "restore"; checkpointRunCount: number }
	| { type: "forkSession" };

export type WebviewOutboundMessage =
	| { type: "status"; text: string }
	/**
	 * `recoverable: true` marks an in-run notice (e.g. a MistakeTracker
	 * mistake such as a plan-mode guard-blocked command) — the run continues,
	 * so peers should not treat it as the turn's outcome. Absent/false means
	 * a genuine failure.
	 */
	| { type: "error"; text: string; recoverable?: boolean }
	| {
			type: "desktopCommandResult";
			id: string;
			ok: true;
			result: unknown;
	  }
	| {
			type: "desktopCommandResult";
			id: string;
			ok: false;
			error: string;
	  }
	| { type: "session_started"; sessionId: string }
	| {
			type: "session_hydrated";
			sessionId: string;
			status?: string;
			providerId?: string;
			modelId?: string;
			messages: WebviewChatMessage[];
	  }
	| { type: "assistant_delta"; text: string }
	| { type: "reasoning_delta"; text: string; redacted?: boolean }
	| { type: "assistant_media"; media: GeneratedMedia }
	| { type: "tool_event"; text: string; event?: WebviewToolEvent }
	| ({ type: "approval_request" } & WebviewToolApprovalRequest)
	| {
			type: "approval_resolved";
			approvalId: string;
			approved: boolean;
			reason?: string;
	  }
	| WebviewQuestionRequest
	| WebviewQuestionResolved
	| {
			type: "turn_done";
			finishReason: string;
			iterations: number;
			usage?: WebviewUsage;
	  }
	| {
			type: "providers";
			providers: Array<
				Pick<ProviderListItem, "defaultModelId" | "enabled" | "id" | "name">
			>;
	  }
	| {
			type: "provider_catalog";
			providers: WebviewProviderCatalogItem[];
			settingsPath: string;
	  }
	| {
			type: "provider_settings_saved";
			providerId: string;
			enabled: boolean;
	  }
	| {
			type: "provider_oauth_login_done";
			providerId: string;
			accessTokenPresent: boolean;
	  }
	| { type: "models"; providerId: string; models: WebviewProviderModel[] }
	| { type: "sessions"; sessions: WebviewSessionSummary[] }
	| WebviewHubState
	| { type: "defaults"; defaults: WebviewDefaults }
	| { type: "reset_done" }
	| {
			type: "fork_done";
			forkedFromSessionId: string;
			newSessionId: string;
	  }
	| { type: "fork_error"; text: string };
