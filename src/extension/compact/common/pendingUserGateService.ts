/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ConfigKey, IConfigurationService } from '../../../platform/configuration/common/configurationService';
import { ILogService } from '../../../platform/log/common/logService';
import { Disposable } from '../../../util/vs/base/common/lifecycle';
import { GateToolCallResult, IPendingUserGateService, PendingUserGate } from './types';

const GATE_SWEEP_INTERVAL_MS = 30_000;

export class PendingUserGateService extends Disposable implements IPendingUserGateService {
	declare readonly _serviceBrand: undefined;

	private readonly _gates = new Map<string, PendingUserGate>();
	private readonly _timeoutHandle: ReturnType<typeof setInterval>;

	constructor(
		@IConfigurationService private readonly _configurationService: IConfigurationService,
		@ILogService private readonly _logService: ILogService,
	) {
		super();

		this._timeoutHandle = setInterval(() => this._expireAskedGates(), GATE_SWEEP_INTERVAL_MS);
	}

	override dispose(): void {
		clearInterval(this._timeoutHandle);
		super.dispose();
	}

	createGate(sessionId: string, injectionMsg: string): void {
		if (!this._configurationService.getConfig(ConfigKey.Advanced.InterruptGateEnabled)) {
			return;
		}

		this._gates.set(sessionId, {
			sessionId,
			state: 'pending',
			injectionMsg,
			createdAt: Date.now(),
		});
	}

	getGate(sessionId: string): PendingUserGate | undefined {
		return this._gates.get(sessionId);
	}

	isActive(sessionId: string): boolean {
		const gate = this._gates.get(sessionId);
		return gate?.state === 'pending' || gate?.state === 'asked';
	}

	onToolCallAttempted(sessionId: string): GateToolCallResult {
		const gate = this._gates.get(sessionId);
		if (!gate) {
			return { deny: false };
		}

		switch (gate.state) {
			case 'pending': {
				gate.state = 'asked';
				gate.askedAt = Date.now();
				return {
					deny: true,
					additionalContext: [
						'Interrupt gate is active. Ask the user a clear follow-up question before using any tools.',
						`Pending context: ${gate.injectionMsg}`,
					],
				};
			}
			case 'asked':
				return {
					deny: true,
					additionalContext: ['Interrupt gate is still waiting for the user response. Do not call tools yet.'],
				};
			case 'resolved': {
				this._gates.delete(sessionId);
				return {
					deny: false,
					additionalContext: gate.userAnswer ? [`User response: ${gate.userAnswer}`] : undefined,
				};
			}
			case 'expired':
			default:
				return { deny: false };
		}
	}

	onUserPromptSubmitted(sessionId: string, prompt: string): void {
		const gate = this._gates.get(sessionId);
		if (!gate) {
			return;
		}

		if (gate.state === 'pending' || gate.state === 'asked') {
			gate.userAnswer = prompt;
			gate.state = 'resolved';
		}
	}

	private _expireAskedGates(): void {
		const timeoutMs = this._configurationService.getConfig(ConfigKey.Advanced.InterruptGateTimeoutSeconds) * 1000;
		const now = Date.now();
		for (const gate of this._gates.values()) {
			if (gate.state !== 'asked' || gate.askedAt === undefined) {
				continue;
			}

			if (now - gate.askedAt > timeoutMs) {
				gate.state = 'expired';
				this._logService.warn(`[PendingUserGateService] Interrupt gate expired for session ${gate.sessionId}`);
			}
		}
	}
}