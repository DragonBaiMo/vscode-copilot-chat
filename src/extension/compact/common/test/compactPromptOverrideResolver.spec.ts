/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { beforeEach, expect, suite, test } from 'vitest';
import { ConfigKey } from '../../../../platform/configuration/common/configurationService';
import { DefaultsOnlyConfigurationService } from '../../../../platform/configuration/common/defaultsOnlyConfigurationService';
import { InMemoryConfigurationService } from '../../../../platform/configuration/test/common/inMemoryConfigurationService';
import { NullNativeEnvService } from '../../../../platform/env/common/nullEnvService';
import { MockFileSystemService } from '../../../../platform/filesystem/node/test/mockFileSystemService';
import { TestWorkspaceService } from '../../../../platform/test/node/testWorkspaceService';
import { TestLogService } from '../../../../platform/testing/common/testLogService';
import { URI } from '../../../../util/vs/base/common/uri';
import { CompactPromptOverrideResolver } from '../compactPromptOverrideResolver';

class CodedMockFileSystemService extends MockFileSystemService {
	override async readFile(uri: URI, disableLimit?: boolean): Promise<Uint8Array> {
		try {
			return await super.readFile(uri, disableLimit);
		} catch (error) {
			if (error instanceof Error && error.message === 'ENOENT') {
				throw Object.assign(new Error(error.message), { code: 'ENOENT' });
			}

			throw error;
		}
	}
}

class CollectingLogService extends TestLogService {
	readonly warnings: string[] = [];

	override warn(message: string): void {
		this.warnings.push(message);
	}
}

class TestNativeEnvService extends NullNativeEnvService {
	override get userHome(): URI {
		return URI.file('/home/testuser');
	}
}

suite('CompactPromptOverrideResolver', () => {
	const workspaceUri = URI.file('/workspace');
	const userHomeUri = URI.file('/home/testuser');
	const sessionId = 'session-123';

	let fileSystemService: CodedMockFileSystemService;
	let configurationService: InMemoryConfigurationService;
	let workspaceService: TestWorkspaceService;
	let logService: CollectingLogService;
	let resolver: CompactPromptOverrideResolver;

	beforeEach(async () => {
		fileSystemService = new CodedMockFileSystemService();
		configurationService = new InMemoryConfigurationService(new DefaultsOnlyConfigurationService());
		workspaceService = new TestWorkspaceService([workspaceUri]);
		logService = new CollectingLogService();
		resolver = new CompactPromptOverrideResolver(
			fileSystemService,
			configurationService,
			workspaceService,
			new TestNativeEnvService(),
			logService,
		);

		await configurationService.setConfig(ConfigKey.Advanced.CompactPromptOverrideEnabled, true);
	});

	test('returns undefined when the feature is disabled', async () => {
		await configurationService.setConfig(ConfigKey.Advanced.CompactPromptOverrideEnabled, false);
		fileSystemService.mockFile(URI.joinPath(workspaceUri, '.copilot', 'compact', 'prompt.md'), 'workspace override');

		const result = await resolver.resolve(sessionId);

		expect(result).toBeUndefined();
	});

	test('prefers the session override over workspace and user files', async () => {
		await configurationService.setConfig(ConfigKey.Advanced.CompactPromptOverrideMode, 'append');
		fileSystemService.mockFile(URI.joinPath(workspaceUri, '.copilot', 'compact', 'session', `${sessionId}.md`), ' session override ');
		fileSystemService.mockFile(URI.joinPath(workspaceUri, '.copilot', 'compact', 'prompt.md'), 'workspace override');
		fileSystemService.mockFile(URI.joinPath(userHomeUri, '.copilot', 'compact', 'prompt.md'), 'user override');

		const result = await resolver.resolve(sessionId);

		expect(result).toEqual({
			content: 'session override',
			mode: 'append',
			source: 'session',
		});
	});

	test('skips empty files and falls back to the workspace override', async () => {
		fileSystemService.mockFile(URI.joinPath(workspaceUri, '.copilot', 'compact', 'session', `${sessionId}.md`), '   \n\t  ');
		fileSystemService.mockFile(URI.joinPath(workspaceUri, '.copilot', 'compact', 'prompt.md'), 'workspace override');

		const result = await resolver.resolve(sessionId);

		expect(result).toEqual({
			content: 'workspace override',
			mode: 'replace',
			source: 'workspace',
		});
	});

	test('truncates oversized overrides and records a warning', async () => {
		const oversized = 'x'.repeat(110 * 1024);
		fileSystemService.mockFile(URI.joinPath(userHomeUri, '.copilot', 'compact', 'prompt.md'), oversized);

		const result = await resolver.resolve(sessionId);

		expect(result?.content).toHaveLength(100 * 1024);
		expect(result?.source).toBe('user');
		expect(logService.warnings).toEqual([
			expect.stringContaining('Truncated oversized compact override file'),
		]);
	});

	test('warns on non-file-not-found errors and continues to later candidates', async () => {
		fileSystemService.mockError(
			URI.joinPath(workspaceUri, '.copilot', 'compact', 'session', `${sessionId}.md`),
			Object.assign(new Error('Access denied'), { code: 'EACCES' }),
		);
		fileSystemService.mockFile(URI.joinPath(userHomeUri, '.copilot', 'compact', 'prompt.md'), 'user override');

		const result = await resolver.resolve(sessionId);

		expect(result).toEqual({
			content: 'user override',
			mode: 'replace',
			source: 'user',
		});
		expect(logService.warnings).toEqual([
			expect.stringContaining('Failed to read'),
		]);
	});
});