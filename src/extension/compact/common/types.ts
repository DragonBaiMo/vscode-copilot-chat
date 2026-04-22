/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createServiceIdentifier } from '../../../util/common/services';

export type CompactOverrideMode = 'replace' | 'append';
export type CompactOverrideSource = 'session' | 'workspace' | 'user';
export type PendingUserGateState = 'idle' | 'pending' | 'asked' | 'resolved' | 'expired';
export type EventCompactTriggerState = 'idle' | 'armed' | 'triggered' | 'cooldown';

export interface CompactOverrideResult {
	readonly content: string;
	readonly mode: CompactOverrideMode;
	readonly source: CompactOverrideSource;
}

export interface PendingUserGate {
	readonly sessionId: string;
	state: PendingUserGateState;
	readonly injectionMsg: string;
	userAnswer?: string;
	readonly createdAt: number;
	askedAt?: number;
}

export interface GateToolCallResult {
	readonly deny: boolean;
	readonly additionalContext?: string[];
}

export const ICompactPromptOverrideResolver = createServiceIdentifier<ICompactPromptOverrideResolver>('ICompactPromptOverrideResolver');

export interface ICompactPromptOverrideResolver {
	readonly _serviceBrand: undefined;

	resolve(sessionId: string): Promise<CompactOverrideResult | undefined>;
}

export const IPendingUserGateService = createServiceIdentifier<IPendingUserGateService>('IPendingUserGateService');

export interface IPendingUserGateService {
	readonly _serviceBrand: undefined;

	createGate(sessionId: string, injectionMsg: string): void;
	getGate(sessionId: string): PendingUserGate | undefined;
	isActive(sessionId: string): boolean;
	onToolCallAttempted(sessionId: string): GateToolCallResult;
	onUserPromptSubmitted(sessionId: string, prompt: string): void;
}

export const IEventCompactTriggerService = createServiceIdentifier<IEventCompactTriggerService>('IEventCompactTriggerService');

export interface IEventCompactTriggerService {
	readonly _serviceBrand: undefined;

	onPostToolUse(sessionId: string | undefined, toolName: string, toolInput: unknown): void;
	tryConsume(sessionId: string, gateActive: boolean): boolean;
	onCompactCompleted(sessionId: string): void;
	getState(sessionId: string): EventCompactTriggerState;
}