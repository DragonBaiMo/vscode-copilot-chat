/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ConfigKey, IConfigurationService } from '../../../platform/configuration/common/configurationService';
import { ILogService } from '../../../platform/log/common/logService';
import { IWorkspaceService } from '../../../platform/workspace/common/workspaceService';
import { Disposable } from '../../../util/vs/base/common/lifecycle';
import { extUriBiasedIgnorePathCase } from '../../../util/vs/base/common/resources';
import { URI } from '../../../util/vs/base/common/uri';
import { EventCompactTriggerState, IEventCompactTriggerService } from './types';

interface ReadFileLikeInput {
	readonly filePath?: string;
}

export class EventCompactTriggerService extends Disposable implements IEventCompactTriggerService {
	declare readonly _serviceBrand: undefined;

	private readonly _states = new Map<string, EventCompactTriggerState>();
	private readonly _cooldownTimers = new Map<string, ReturnType<typeof setTimeout>>();

	constructor(
		@IConfigurationService private readonly _configurationService: IConfigurationService,
		@ILogService private readonly _logService: ILogService,
		@IWorkspaceService private readonly _workspaceService: IWorkspaceService,
	) {
		super();
	}

	override dispose(): void {
		for (const timer of this._cooldownTimers.values()) {
			clearTimeout(timer);
		}
		this._cooldownTimers.clear();
		super.dispose();
	}

	onPostToolUse(sessionId: string | undefined, toolName: string, toolInput: unknown): void {
		if (!sessionId || !this._configurationService.getConfig(ConfigKey.Advanced.EventCompactTriggerEnabled)) {
			return;
		}

		if (toolName !== 'read_file') {
			return;
		}

		const triggerUri = this._getTriggerFileUri();
		const filePath = this._getFilePath(toolInput);
		if (!triggerUri || !filePath) {
			return;
		}

		const readUri = URI.file(filePath);
		if (!extUriBiasedIgnorePathCase.isEqual(triggerUri, readUri)) {
			return;
		}

		const state = this.getState(sessionId);
		if (state === 'cooldown' || state === 'armed' || state === 'triggered') {
			return;
		}

		this._states.set(sessionId, 'armed');
	}

	tryConsume(sessionId: string, gateActive: boolean): boolean {
		if (this.getState(sessionId) !== 'armed') {
			return false;
		}

		if (gateActive) {
			this._logService.debug(`[EventCompactTriggerService] Gate active for session ${sessionId} · deferring compact trigger`);
			return false;
		}

		this._states.set(sessionId, 'triggered');
		return true;
	}

	onCompactCompleted(sessionId: string): void {
		this._states.set(sessionId, 'cooldown');

		const existingTimer = this._cooldownTimers.get(sessionId);
		if (existingTimer) {
			clearTimeout(existingTimer);
		}

		const cooldownMs = this._configurationService.getConfig(ConfigKey.Advanced.EventCompactTriggerCooldownSeconds) * 1000;
		const timer = setTimeout(() => {
			this._states.set(sessionId, 'idle');
			this._cooldownTimers.delete(sessionId);
		}, cooldownMs);

		this._cooldownTimers.set(sessionId, timer);
	}

	getState(sessionId: string): EventCompactTriggerState {
		return this._states.get(sessionId) ?? 'idle';
	}

	private _getTriggerFileUri(): URI | undefined {
		const workspaceUri = this._workspaceService.getWorkspaceFolders()[0];
		return workspaceUri ? URI.joinPath(workspaceUri, '.copilot', 'compact', 'trigger.md') : undefined;
	}

	private _getFilePath(toolInput: unknown): string | undefined {
		if (!toolInput || typeof toolInput !== 'object') {
			return undefined;
		}

		const input = toolInput as ReadFileLikeInput;
		return typeof input.filePath === 'string' ? input.filePath : undefined;
	}
}