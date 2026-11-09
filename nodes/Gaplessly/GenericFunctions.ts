import { createHash } from 'crypto';
import type {
	IDataObject,
	IExecuteFunctions,
	IHookFunctions,
	IHttpRequestMethods,
	IHttpRequestOptions,
	ILoadOptionsFunctions,
	IWebhookFunctions,
	JsonObject,
} from 'n8n-workflow';
import { NodeApiError } from 'n8n-workflow';

// Fixed origin: the key is never sent anywhere but Gaplessly.
export const BASE_URL = 'https://gaplessly.com/api/v1';

type Ctx = IExecuteFunctions | ILoadOptionsFunctions | IHookFunctions | IWebhookFunctions;

export async function gaplesslyRequest(
	this: Ctx,
	method: IHttpRequestMethods,
	path: string,
	body?: IDataObject,
	qs?: IDataObject,
	headers?: IDataObject,
): Promise<IDataObject> {
	const options: IHttpRequestOptions = {
		method,
		url: `${BASE_URL}${path}`,
		json: true,
		headers: { 'Content-Type': 'application/json', ...headers },
		...(body ? { body } : {}),
		...(qs ? { qs } : {}),
	};
	try {
		return (await this.helpers.httpRequestWithAuthentication.call(this, 'gaplesslyApi', options)) as IDataObject;
	} catch (error) {
		const data = apiBody(error);
		// NodeApiError hands back an already-wrapped error untouched, options and
		// all, so build ours from the underlying request failure instead.
		const source = (error instanceof NodeApiError ? (error.cause ?? error) : error) as JsonObject;
		// A deposit or card rule: nothing was booked, the guest finishes online.
		if (data?.code === 'payment_required' && data.bookingUrl) {
			throw new NodeApiError(this.getNode(), source, {
				message: 'Nothing was booked. The guest must complete payment or card collection',
				description: String(data.bookingUrl),
			});
		}
		// The API's own sentence beats n8n's generic one for the status code.
		throw new NodeApiError(this.getNode(), source, {
			message: typeof data?.error === 'string' ? data.error : undefined,
			description: typeof data?.code === 'string' ? `Gaplessly code: ${data.code}` : undefined,
		});
	}
}

// n8n wraps the request failure in its own NodeApiError, with the original
// error (and the API's JSON body) as `cause`; read whichever layer has it.
function apiBody(error: unknown): IDataObject | undefined {
	for (const layer of [error, (error as JsonObject)?.cause]) {
		const response = (layer as JsonObject | undefined)?.response as JsonObject | undefined;
		const body = response?.data ?? response?.body;
		if (body && typeof body === 'object') return body as IDataObject;
		if (typeof body === 'string') {
			try {
				return JSON.parse(body) as IDataObject;
			} catch {
				return undefined;
			}
		}
	}
	return undefined;
}

/** Walks a cursor-paged list. `max` bounds how many rows come back. */
export async function gaplesslyRequestAll(this: Ctx, path: string, qs: IDataObject = {}, max = Infinity): Promise<IDataObject[]> {
	const rows: IDataObject[] = [];
	let cursor: string | undefined;
	do {
		const page = await gaplesslyRequest.call(this, 'GET', path, undefined, { ...qs, limit: 200, ...(cursor ? { cursor } : {}) });
		rows.push(...((page.data as IDataObject[]) ?? []));
		cursor = (page.nextCursor as string | null) ?? undefined;
	} while (cursor && rows.length < max);
	return rows.slice(0, max);
}

export async function businessType(this: Ctx): Promise<'hospitality' | 'appointments'> {
	const org = (await gaplesslyRequest.call(this, 'GET', '/organization')).data as IDataObject;
	return org.businessType === 'hospitality' ? 'hospitality' : 'appointments';
}

export const bookingPath = (type: string) => (type === 'hospitality' ? '/reservations' : '/appointments');

// Stable across retries of the same source event, so a re-run never books
// twice; the API keeps the first answer for the key.
export function idempotencyKey(operation: string, sourceId: string): string {
	const hex = createHash('sha256').update(`gaplessly:n8n:${operation}:${sourceId}`).digest('hex');
	return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

export const digits = (value: unknown) => String(value ?? '').replace(/\D/g, '');

export function nextDay(date: string): string {
	const d = new Date(`${date}T00:00:00Z`);
	d.setUTCDate(d.getUTCDate() + 1);
	return d.toISOString().slice(0, 10);
}
