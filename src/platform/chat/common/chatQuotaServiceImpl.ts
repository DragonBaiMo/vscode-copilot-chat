/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../util/vs/base/common/lifecycle';
import { IAuthenticationService } from '../../authentication/common/authentication';
import { IHeaders } from '../../networking/common/fetcherService';
import { CopilotUserQuotaInfo, IChatQuota, IChatQuotaService, QuotaSnapshots } from './chatQuotaService';

/**
 * Throttle window for non-exhausted quota updates. While quota remains > 0 we only
 * refresh `_quotaInfo` at most once per window. This dampens repeated "weekly rate
 * limit" banners rendered by VS Code core from the same snapshot data. Exhausted
 * states (percent_remaining <= 0) are never throttled.
 */
const QUOTA_UPDATE_COOLDOWN_MS = 24 * 60 * 60 * 1000; // 24h

export class ChatQuotaService extends Disposable implements IChatQuotaService {
	declare readonly _serviceBrand: undefined;
	private _quotaInfo: IChatQuota | undefined;
	private _lastUpdatedAt = 0;

	constructor(@IAuthenticationService private readonly _authService: IAuthenticationService) {
		super();
		this._register(this._authService.onDidAuthenticationChange(() => {
			this.processUserInfoQuotaSnapshot(this._authService.copilotToken?.quotaInfo);
		}));
	}

	/**
	 * Returns true when a fresh update should be suppressed because quota is not
	 * exhausted and we already accepted an update inside the cooldown window.
	 * First-ever update (`_quotaInfo === undefined`) always passes through.
	 */
	private shouldThrottle(percentRemaining: number): boolean {
		if (this._quotaInfo === undefined) {
			return false;
		}
		if (percentRemaining <= 0) {
			return false;
		}
		return Date.now() - this._lastUpdatedAt < QUOTA_UPDATE_COOLDOWN_MS;
	}

	get quotaExhausted(): boolean {
		if (!this._quotaInfo) {
			return false;
		}
		return this._quotaInfo.used >= this._quotaInfo.quota && !this._quotaInfo.overageEnabled && !this._quotaInfo.unlimited;
	}

	get overagesEnabled(): boolean {
		if (!this._quotaInfo) {
			return false;
		}
		return this._quotaInfo.overageEnabled;
	}

	clearQuota(): void {
		this._quotaInfo = undefined;
		this._lastUpdatedAt = 0;
	}

	processQuotaHeaders(headers: IHeaders): void {
		const quotaHeader = this._authService.copilotToken?.isFreeUser ? headers.get('x-quota-snapshot-chat') : headers.get('x-quota-snapshot-premium_models') || headers.get('x-quota-snapshot-premium_interactions');
		if (!quotaHeader) {
			return;
		}

		try {
			// Parse URL encoded string into key-value pairs
			const params = new URLSearchParams(quotaHeader);

			// Extract values with fallbacks to ensure type safety
			const entitlement = parseInt(params.get('ent') || '0', 10);
			const overageUsed = parseFloat(params.get('ov') || '0.0');
			const overageEnabled = params.get('ovPerm') === 'true';
			const percentRemaining = parseFloat(params.get('rem') || '0.0');
			const resetDateString = params.get('rst');

			if (this.shouldThrottle(percentRemaining)) {
				return;
			}

			let resetDate: Date;
			if (resetDateString) {
				resetDate = new Date(resetDateString);
			} else {
				// Default to one month from now if not provided
				resetDate = new Date();
				resetDate.setMonth(resetDate.getMonth() + 1);
			}

			// Calculate used based on entitlement and remaining
			const used = Math.max(0, entitlement * (1 - percentRemaining / 100));

			// Update quota info
			this._quotaInfo = {
				quota: entitlement,
				unlimited: entitlement === -1,
				used,
				overageUsed,
				overageEnabled,
				resetDate
			};
			this._lastUpdatedAt = Date.now();
		} catch (error) {
			console.error('Failed to parse quota header', error);
		}
	}

	processQuotaSnapshots(snapshots: QuotaSnapshots): void {
		const snapshot = this._authService.copilotToken?.isFreeUser
			? snapshots['chat']
			: snapshots['premium_models'] ?? snapshots['premium_interactions'];
		if (!snapshot) {
			return;
		}

		try {
			if (this.shouldThrottle(snapshot.percent_remaining)) {
				return;
			}

			const entitlement = parseInt(snapshot.entitlement, 10);
			const resetDate = snapshot.reset_date ? new Date(snapshot.reset_date) : (() => { const d = new Date(); d.setMonth(d.getMonth() + 1); return d; })();
			const used = Math.max(0, entitlement * (1 - snapshot.percent_remaining / 100));

			this._quotaInfo = {
				quota: entitlement,
				unlimited: entitlement === -1,
				used,
				overageUsed: snapshot.overage_count,
				overageEnabled: snapshot.overage_permitted,
				resetDate
			};
			this._lastUpdatedAt = Date.now();
		} catch (error) {
			console.error('Failed to process quota snapshots', error);
		}
	}

	private processUserInfoQuotaSnapshot(quotaInfo: CopilotUserQuotaInfo | undefined) {
		if (!quotaInfo || !quotaInfo.quota_snapshots || !quotaInfo.quota_reset_date) {
			return;
		}
		const premium = quotaInfo.quota_snapshots.premium_interactions;
		if (this.shouldThrottle(premium.percent_remaining)) {
			return;
		}
		this._quotaInfo = {
			unlimited: premium.unlimited,
			overageEnabled: premium.overage_permitted,
			overageUsed: premium.overage_count,
			quota: premium.entitlement,
			resetDate: new Date(quotaInfo.quota_reset_date),
			used: Math.max(0, premium.entitlement * (1 - premium.percent_remaining / 100)),
		};
		this._lastUpdatedAt = Date.now();
	}
}