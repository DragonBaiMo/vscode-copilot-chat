/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ConfigKey, IConfigurationService } from '../../../platform/configuration/common/configurationService';
import { INativeEnvService } from '../../../platform/env/common/envService';
import { IFileSystemService } from '../../../platform/filesystem/common/fileSystemService';
import { ILogService } from '../../../platform/log/common/logService';
import { IWorkspaceService } from '../../../platform/workspace/common/workspaceService';
import { Disposable } from '../../../util/vs/base/common/lifecycle';
import { URI } from '../../../util/vs/base/common/uri';
import { CompactOverrideResult, CompactOverrideSource, ICompactPromptOverrideResolver } from './types';

const MAX_COMPACT_OVERRIDE_CHARS = 100 * 1024;

export class CompactPromptOverrideResolver extends Disposable implements ICompactPromptOverrideResolver {
	declare readonly _serviceBrand: undefined;

	constructor(
		@IFileSystemService private readonly _fileSystemService: IFileSystemService,
		@IConfigurationService private readonly _configurationService: IConfigurationService,
		@IWorkspaceService private readonly _workspaceService: IWorkspaceService,
		@INativeEnvService private readonly _envService: INativeEnvService,
		@ILogService private readonly _logService: ILogService,
	) {
		super();
	}

	async resolve(sessionId: string): Promise<CompactOverrideResult | undefined> {
		if (!this._configurationService.getConfig(ConfigKey.Advanced.CompactPromptOverrideEnabled)) {
			return undefined;
		}

		const workspaceUri = this._workspaceService.getWorkspaceFolders()[0];
		if (!workspaceUri) {
			return undefined;
		}

		const mode = this._configurationService.getConfig(ConfigKey.Advanced.CompactPromptOverrideMode);
		const candidates: Array<{ uri: URI; source: CompactOverrideSource }> = [
			{ uri: URI.joinPath(workspaceUri, '.copilot', 'compact', 'session', `${sessionId}.md`), source: 'session' },
			{ uri: URI.joinPath(workspaceUri, '.copilot', 'compact', 'prompt.md'), source: 'workspace' },
			{ uri: URI.joinPath(this._envService.userHome, '.copilot', 'compact', 'prompt.md'), source: 'user' },
		];

		for (const candidate of candidates) {
			try {
				const content = await this._readCandidate(candidate.uri);
				if (!content) {
					continue;
				}

				return {
					content,
					mode,
					source: candidate.source,
				};
			} catch (error) {
				if (isFileNotFoundError(error)) {
					continue;
				}

				this._logService.warn(`[CompactPromptOverrideResolver] Failed to read ${candidate.uri.toString()}: ${getErrorMessage(error)}`);
			}
		}

		return undefined;
	}

	private async _readCandidate(uri: URI): Promise<string | undefined> {
		const raw = await this._fileSystemService.readFile(uri);
		let text = new TextDecoder().decode(raw).trim();
		if (!text.length) {
			return undefined;
		}

		if (text.length > MAX_COMPACT_OVERRIDE_CHARS) {
			text = text.slice(0, MAX_COMPACT_OVERRIDE_CHARS);
			this._logService.warn(`[CompactPromptOverrideResolver] Truncated oversized compact override file: ${uri.toString()}`);
		}

		return text;
	}
}

function isFileNotFoundError(error: unknown): boolean {
	if (!(error instanceof Error)) {
		return false;
	}

	const code = 'code' in error ? String(error.code) : undefined;
	return code === 'FileNotFound' || code === 'EntryNotFound' || code === 'ENOENT';
}

function getErrorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}