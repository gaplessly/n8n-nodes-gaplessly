import { createHmac, timingSafeEqual } from 'crypto';
import type {
	IDataObject,
	IHookFunctions,
	INodeType,
	INodeTypeDescription,
	IWebhookFunctions,
	IWebhookResponseData,
} from 'n8n-workflow';
import { NodeConnectionTypes } from 'n8n-workflow';
import { gaplesslyRequest } from '../Gaplessly/GenericFunctions';

const TOLERANCE_SECONDS = 300;
// Gaplessly retries a failed delivery for about three days (20 attempts, 6h
// cap); five days outlasts it.
const KEEP_SECONDS = 5 * 24 * 60 * 60;
const MAX_REMEMBERED = 5000;

export class GaplesslyTrigger implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Gaplessly Trigger',
		name: 'gaplesslyTrigger',
		icon: { light: 'file:gaplessly.svg', dark: 'file:gaplessly.dark.svg' },
		group: ['trigger'],
		version: 1,
		subtitle: '={{$parameter["events"].join(", ")}}',
		description: 'Starts the workflow when a booking, guest or till check changes in Gaplessly',
		defaults: { name: 'Gaplessly Trigger' },
		inputs: [],
		outputs: [NodeConnectionTypes.Main],
		credentials: [{ name: 'gaplesslyApi', required: true }],
		webhooks: [{ name: 'default', httpMethod: 'POST', responseMode: 'onReceived', responseData: 'noData', path: 'webhook' }],
		properties: [
			{
				displayName: 'Events',
				name: 'events',
				type: 'multiOptions',
				required: true,
				default: ['booking.created'],
				options: [
					{ name: 'Booking Cancelled', value: 'booking.cancelled' },
					{ name: 'Booking Created', value: 'booking.created' },
					{ name: 'Booking Updated', value: 'booking.updated', description: 'Moved, status, party or staff changed, or the guest reconfirmed' },
					{ name: 'Check Updated', value: 'check.updated', description: 'Table bookings only: a till check opened, or its total, status or covers changed' },
					{ name: 'Guest Created', value: 'guest.created' },
					{ name: 'Guest Merged', value: 'guest.merged' },
				],
			},
		],
	};

	webhookMethods = {
		default: {
			async checkExists(this: IHookFunctions): Promise<boolean> {
				// The API cannot list endpoints, so the stored id is the truth; a
				// stale one is replaced on the next activation.
				return Boolean(this.getWorkflowStaticData('node').webhookId);
			},
			async create(this: IHookFunctions): Promise<boolean> {
				const events = this.getNodeParameter('events') as string[];
				const result = await gaplesslyRequest.call(this, 'POST', '/webhooks', {
					url: this.getNodeWebhookUrl('default'),
					events,
					description: `n8n: ${this.getWorkflow().name ?? 'workflow'}`.slice(0, 200),
				});
				const data = this.getWorkflowStaticData('node');
				data.webhookId = (result.data as IDataObject).id;
				data.secret = result.secret;
				return true;
			},
			async delete(this: IHookFunctions): Promise<boolean> {
				const data = this.getWorkflowStaticData('node');
				if (data.webhookId) {
					try {
						await gaplesslyRequest.call(this, 'DELETE', `/webhooks/${encodeURIComponent(String(data.webhookId))}`);
					} catch (error) {
						// Already gone (404) is the state we want.
						if (!String((error as Error).message).includes('404')) return false;
					}
				}
				delete data.webhookId;
				delete data.secret;
				delete data.seen;
				return true;
			},
		},
	};

	async webhook(this: IWebhookFunctions): Promise<IWebhookResponseData> {
		const req = this.getRequestObject();
		const res = this.getResponseObject();
		const data = this.getWorkflowStaticData('node');
		const refuse = (status: number, error: string): IWebhookResponseData => {
			res.status(status).json({ error });
			return { noWebhookResponse: true };
		};

		// The MAC covers the exact bytes sent, so it is checked over the raw body.
		const raw = (req as unknown as { rawBody?: Buffer }).rawBody?.toString('utf8');
		const header = String(this.getHeaderData()['gaplessly-signature'] ?? '');
		const match = /^t=(\d+),v1=([a-f0-9]{64})$/.exec(header);
		const secret = typeof data.secret === 'string' ? data.secret : '';
		if (!match || !secret || raw === undefined) return refuse(401, 'Missing Gaplessly-Signature or secret');
		if (Math.abs(Date.now() / 1000 - Number(match[1])) > TOLERANCE_SECONDS) return refuse(401, 'Stale timestamp');
		const expected = createHmac('sha256', secret).update(`${match[1]}.${raw}`).digest();
		if (!timingSafeEqual(expected, Buffer.from(match[2], 'hex'))) return refuse(401, 'Signature does not match');

		let event: IDataObject;
		try {
			event = JSON.parse(raw) as IDataObject;
		} catch {
			return refuse(400, 'Body is not JSON');
		}
		const id = String(event.id ?? '');
		if (!id) return refuse(400, 'Event has no id');

		// Each event id runs once. Static data is kept for an active workflow
		// only, so a manual test run never remembers anything.
		const now = Math.floor(Date.now() / 1000);
		const seen = (data.seen ?? {}) as Record<string, number>;
		for (const key of Object.keys(seen)) if (now - seen[key] > KEEP_SECONDS) delete seen[key];
		if (seen[id]) {
			res.status(200).json({ received: true, duplicate: true });
			return { noWebhookResponse: true };
		}
		seen[id] = now;
		const keys = Object.keys(seen);
		if (keys.length > MAX_REMEMBERED) for (const key of keys.sort((a, b) => seen[a] - seen[b]).slice(0, keys.length - MAX_REMEMBERED)) delete seen[key];
		data.seen = seen;

		const events = this.getNodeParameter('events') as string[];
		if (!events.includes(String(event.type))) {
			res.status(200).json({ received: true, ignored: true });
			return { noWebhookResponse: true };
		}
		return { webhookResponse: { received: true }, workflowData: [this.helpers.returnJsonArray([event])] };
	}
}
