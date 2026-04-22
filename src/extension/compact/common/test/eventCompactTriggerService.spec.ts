/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { afterEach, beforeEach, expect, suite, test, vi } from 'vitest';
import { ConfigKey } from '../../../../platform/configuration/common/configurationService';
import { DefaultsOnlyConfigurationService } from '../../../../platform/configuration/common/defaultsOnlyConfigurationService';
import { InMemoryConfigurationService } from '../../../../platform/configuration/test/common/inMemoryConfigurationService';
import { TestWorkspaceService } from '../../../../platform/test/node/testWorkspaceService';
import { TestLogService } from '../../../../platform/testing/common/testLogService';
import { URI } from '../../../../util/vs/base/common/uri';
import { EventCompactTriggerService } from '../eventCompactTriggerService';

class CollectingLogService extends TestLogService {
	readonly debugs: string[] = [];

	override debug(message: string): void {
		this.debugs.push(message);
	}
}

suite('EventCompactTriggerService', () => {
	const workspaceUri = URI.file('/workspace');
	const triggerFilePath = URI.joinPath(workspaceUri, '.copilot', 'compact', 'trigger.md').fsPath;

	let configurationService: InMemoryConfigurationService;
	let logService: CollectingLogService;
	let workspaceService: TestWorkspaceService;
	let service: EventCompactTriggerService;

	beforeEach(async () => {
		vi.useFakeTimers();
		configurationService = new InMemoryConfigurationService(new DefaultsOnlyConfigurationService());
		logService = new CollectingLogService();
		workspaceService = new TestWorkspaceService([workspaceUri]);
		await configurationService.setConfig(ConfigKey.Advanced.EventCompactTriggerEnabled, true);
		await configurationService.setConfig(ConfigKey.Advanced.EventCompactTriggerCooldownSeconds, 2);
		service = new EventCompactTriggerService(configurationService, logService, workspaceService);
	});

	afterEach(() => {
		service.dispose();
		vi.useRealTimers();
	});

	test('does not arm when the feature is disabled', async () => {
		await configurationService.setConfig(ConfigKey.Advanced.EventCompactTriggerEnabled, false);

		service.onPostToolUse('session-a', 'read_file', { filePath: triggerFilePath });

		expect(service.getState('session-a')).toBe('idle');
	});

	test('arms only when read_file targets the trigger file', () => {
		service.onPostToolUse('session-a', 'grep_search', { filePath: triggerFilePath });
		service.onPostToolUse('session-a', 'read_file', { filePath: URI.joinPath(workspaceUri, 'README.md').fsPath });
		service.onPostToolUse('session-a', 'read_file', { filePath: triggerFilePath });

		expect(service.getState('session-a')).toBe('armed');
	});

	test('defers consumption while a user gate is active', () => {
		service.onPostToolUse('session-a', 'read_file', { filePath: triggerFilePath });

		expect(service.tryConsume('session-a', true)).toBe(false);
		expect(service.getState('session-a')).toBe('armed');
		expect(logService.debugs).toEqual([
			expect.stringContaining('Gate active for session session-a'),
		]);

		expect(service.tryConsume('session-a', false)).toBe(true);
		expect(service.getState('session-a')).toBe('triggered');
	});

	test('enters cooldown after compaction and resets back to idle', async () => {
		service.onPostToolUse('session-a', 'read_file', { filePath: triggerFilePath });
		service.tryConsume('session-a', false);
		service.onCompactCompleted('session-a');

		expect(service.getState('session-a')).toBe('cooldown');

		service.onPostToolUse('session-a', 'read_file', { filePath: triggerFilePath });
		expect(service.getState('session-a')).toBe('cooldown');

		await vi.advanceTimersByTimeAsync(2_001);

		expect(service.getState('session-a')).toBe('idle');
	});

	test('keeps sessions isolated across arm and cooldown state', async () => {
		service.onPostToolUse('session-a', 'read_file', { filePath: triggerFilePath });
		service.onPostToolUse('session-b', 'read_file', { filePath: triggerFilePath });
		service.tryConsume('session-a', false);
		service.onCompactCompleted('session-a');

		expect(service.getState('session-a')).toBe('cooldown');
		expect(service.getState('session-b')).toBe('armed');

		await vi.advanceTimersByTimeAsync(2_001);

		expect(service.getState('session-a')).toBe('idle');
		expect(service.getState('session-b')).toBe('armed');
	});
});