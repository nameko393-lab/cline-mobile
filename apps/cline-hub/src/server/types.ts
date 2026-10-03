import type { SaveProviderSettingsActionRequest } from "@cline/core";
import type { ToolApprovalRequest, ToolApprovalResult } from "@cline/shared";
import type {
	WebviewInboundMessage,
	WebviewReasonLevel,
} from "../webview-protocol";

export type BrowserFrame = WebviewInboundMessage | { type: "restart_hub" };

export type ProviderSettingsUpdate = Partial<
	Omit<SaveProviderSettingsActionRequest, "action" | "providerId">
>;

export interface BrowserConfig {
	inviteRequired: boolean;
	publicUrl: string;
}

export type TrackedClient = {
	clientId: string;
	displayName?: string;
	clientType: string;
	connectedAt: number;
	version?: string;
	pid?: number;
};

export type TrackedSession = {
	sessionId: string;
	status: string;
	title: string;
	workspaceRoot: string;
	cwd?: string;
	provider?: string;
	model?: string;
	source?: string;
	createdAt: number;
	updatedAt: number;
	createdByClientId?: string;
	prompt?: string;
	inputTokens?: number;
	outputTokens?: number;
	totalCost?: number;
	agentCount: number;
	participantCount: number;
};

export type SessionContext = {
	workspaceRoot: string;
	cwd: string;
	providerId: string;
	modelId: string;
};

export type BrowserPeer = {
	socket: Bun.ServerWebSocket<BrowserPeer>;
	displayName: string;
	selectedSessionId?: string;
	unsubscribeEvents?: () => void;
	sending: boolean;
};

export type PendingToolApproval = {
	sessionId: string;
	/**
	 * The request as it was broadcast, so a peer that attaches later (a page
	 * reload, a second phone) can be shown the same card.
	 */
	request: ToolApprovalRequest;
	createdAt: number;
	resolve: (result: ToolApprovalResult) => void;
	timeout: ReturnType<typeof setTimeout>;
};

/**
 * A follow-up question raised inside a session this dashboard owns. The agent
 * is parked on the `ask_question` tool until `resolve` runs.
 *
 * The question text and options are kept alongside the resolver: the card a
 * browser renders is built from them, and a peer that attaches after the
 * question was raised (page reload, phone opened later) must be able to see
 * the same options, not just learn that something is pending.
 */
export type PendingQuestion = {
	questionId: string;
	sessionId: string;
	question: string;
	options: string[];
	createdAt: number;
	resolve: (answer: string) => void;
	timeout: ReturnType<typeof setTimeout>;
};

/**
 * A follow-up question raised inside a session owned by another hub client
 * (Cline Desktop / CLI). The dashboard mirrors it to its browser peers and
 * relays the answer back to the hub.
 */
export type RemoteQuestion = {
	sessionId: string;
	requestId: string;
	targetClientId: string;
	question: string;
	options: string[];
};

export type JsonRecord = Record<string, unknown>;

export type { WebviewReasonLevel };
