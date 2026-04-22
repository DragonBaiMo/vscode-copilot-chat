/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { afterEach, beforeEach, expect, suite, test, vi } from 'vitest';
import { ConfigKey } from '../../../../platform/configuration/common/configurationService';
import { DefaultsOnlyConfigurationService } from '../../../../platform/configuration/common/defaultsOnlyConfigurationService';
import { InMemoryConfigurationService } from '../../../../platform/configuration/test/common/inMemoryConfigurationService';
import { TestLogService } from '../../../../platform/testing/common/testLogService';
import { PendingUserGateService } from '../pendingUserGateService';

class CollectingLogService extends TestLogService {
	readonly warnings: string[] = [];

	override warn(message: string): void {
		this.warnings.push(message);
	}
}

suite('PendingUserGateService', () => {
	let configurationService: InMemoryConfigurationService;
	let logService: CollectingLogService;
	let service: PendingUserGateService;

	beforeEach(async () => {
		vi.useFakeTimers();
		configurationService = new InMemoryConfigurationService(new DefaultsOnlyConfigurationService());
		logService = new CollectingLogService();
		await configurationService.setConfig(ConfigKey.Advanced.InterruptGateEnabled, true);
		await configurationService.setConfig(ConfigKey.Advanced.InterruptGateTimeoutSeconds, 1);
		service = new PendingUserGateService(configurationService, logService);
	});

	afterEach(() => {
		service.dispose();
		vi.useRealTimers();
	});

	test('does not create a gate when the feature is disabled', async () => {
		await configurationService.setConfig(ConfigKey.Advanced.InterruptGateEnabled, false);

		service.createGate('session-a', 'Need user confirmation');

		expect(service.getGate('session-a')).toBeUndefined();
	});

	test('denies the first tool call and marks the gate as asked', () => {
		service.createGate('session-a', 'Need user confirmation');

		const result = service.onToolCallAttempted('session-a');

		expect(result).toEqual({
			deny: true,
			additionalContext: [
				'Interrupt gate is active. Ask the user a clear follow-up question before using any tools.',
				'Pending context: Need user confirmation',
			],
		});
		expect(service.getGate('session-a')?.state).toBe('asked');
		expect(service.isActive('session-a')).toBe(true);
	});

	test('continues denying tool calls until the user responds', () => {
		service.createGate('session-a', 'Need user confirmation');
		service.onToolCallAttempted('session-a');

		const result = service.onToolCallAttempted('session-a');

		expect(result).toEqual({
			deny: true,
			additionalContext: ['Interrupt gate is still waiting for the user response. Do not call tools yet.'],
		});
	});

	test('passes the user answer through once and clears the gate', () => {
		service.createGate('session-a', 'Need user confirmation');
		service.onToolCallAttempted('session-a');
		service.onUserPromptSubmitted('session-a', 'Proceed with the tool call');

		const result = service.onToolCallAttempted('session-a');

		expect(result).toEqual({
			deny: false,
			additionalContext: ['User response: Proceed with the tool call'],
		});
		expect(service.getGate('session-a')).toBeUndefined();
		expect(service.isActive('session-a')).toBe(false);
	});

	test('expires asked gates after the configured timeout', async () => {
		service.createGate('session-a', 'Need user confirmation');
		service.onToolCallAttempted('session-a');

		await vi.advanceTimersByTimeAsync(31_001);

		expect(service.getGate('session-a')?.state).toBe('expired');
		expect(service.onToolCallAttempted('session-a')).toEqual({ deny: false });
		expect(logService.warnings).toEqual([
			expect.stringContaining('Interrupt gate expired for session session-a'),
		]);
	});

	test('keeps session state isolated', () => {
		service.createGate('session-a', 'Need user confirmation');
		service.createGate('session-b', 'Need other confirmation');
		service.onToolCallAttempted('session-a');
		service.onUserPromptSubmitted('session-b', 'answer');

		expect(service.getGate('session-a')?.state).toBe('asked');
		expect(service.getGate('session-b')?.state).toBe('resolved');
	});
});