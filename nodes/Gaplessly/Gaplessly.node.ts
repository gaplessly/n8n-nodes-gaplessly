import type {
	IDataObject,
	IExecuteFunctions,
	ILoadOptionsFunctions,
	INodeExecutionData,
	INodePropertyOptions,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';
import {
	bookingPath,
	businessType,
	digits,
	gaplesslyRequest,
	gaplesslyRequestAll,
	idempotencyKey,
	nextDay,
} from './GenericFunctions';

const show = (resource: string, operation?: string[]) => ({
	show: operation ? { resource: [resource], operation } : { resource: [resource] },
});

export class Gaplessly implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Gaplessly',
		name: 'gaplessly',
		icon: { light: 'file:gaplessly.svg', dark: 'file:gaplessly.dark.svg' },
		group: ['transform'],
		version: [1],
		subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
		description: 'Bookings, availability, guests and venue setup in your Gaplessly account',
		defaults: { name: 'Gaplessly' },
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		usableAsTool: true,
		credentials: [{ name: 'gaplesslyApi', required: true }],
		properties: [
			{
				displayName: 'Resource',
				name: 'resource',
				type: 'options',
				noDataExpression: true,
				options: [
					{ name: 'Availability', value: 'availability' },
					{ name: 'Booking', value: 'booking' },
					{ name: 'Event', value: 'event' },
					{ name: 'Guest', value: 'guest' },
					{ name: 'Organization', value: 'organization' },
					{ name: 'Service', value: 'service' },
					{ name: 'Service Period', value: 'servicePeriod' },
					{ name: 'Staff Member', value: 'staff' },
					{ name: 'Table', value: 'table' },
				],
				default: 'booking',
			},
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: show('availability'),
				options: [{ name: 'Check', value: 'check', action: 'Check free times', description: 'Free times for a date, party size or service' }],
				default: 'check',
			},
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: show('booking'),
				options: [
					{ name: 'Cancel', value: 'cancel', action: 'Cancel a booking', description: 'Cancel under the business cancellation and refund rules' },
					{ name: 'Create', value: 'create', action: 'Create a booking', description: 'Book a table or an appointment, respecting availability and payment rules' },
					{ name: 'Get Checks', value: 'getChecks', action: 'Get till checks for a table booking' },
					{ name: 'Get Many', value: 'getAll', action: 'Get many bookings', description: 'Bookings starting in a local date range' },
					{ name: 'Move Table', value: 'moveTable', action: 'Move a table booking to a table' },
					{ name: 'Record Check', value: 'recordCheck', action: 'Record a till check total', description: 'For guest spend. Never charges anything.' },
					{ name: 'Seat Walk-In', value: 'seatWalkIn', action: 'Seat a walk in party', description: 'Seats a party nobody booked at a table now. No guest record or emails.' },
					{ name: 'Update', value: 'update', action: 'Update a booking', description: 'New time, party size or notes' },
					{ name: 'Update Status', value: 'updateStatus', action: 'Update a table booking status', description: 'Seated, completed, no-show, or undo a seat' },
				],
				default: 'create',
			},
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: show('guest'),
				options: [
					{ name: 'Find', value: 'find', action: 'Find a guest by email or phone' },
					{ name: 'Get Many', value: 'getAll', action: 'Get many guests' },
				],
				default: 'find',
			},
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['organization'] } },
				options: [{ name: 'Get', value: 'get', action: 'Get the organization' }],
				default: 'get',
			},
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['event'] } },
				options: [{ name: 'Get', value: 'get', action: 'Get an event', description: 'A booking, guest or till check event by its ID, as Gaplessly sent it (kept for 30 days)' }],
				default: 'get',
			},
			{
				displayName: 'Event ID',
				name: 'eventId',
				type: 'string',
				required: true,
				default: '',
				description: 'The top-level ID of a trigger payload, not data.object.ID',
				displayOptions: { show: { resource: ['event'] } },
			},
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['service', 'servicePeriod', 'staff', 'table'] } },
				options: [{ name: 'Get Many', value: 'getAll', action: 'Get many' }],
				default: 'getAll',
			},

			// Shared booking fields.
			{
				displayName: 'Booking ID',
				name: 'bookingId',
				type: 'string',
				required: true,
				default: '',
				description: 'The booking ID, such as data.object.ID from the Gaplessly Trigger (not the event ID)',
				displayOptions: show('booking', ['cancel', 'update', 'updateStatus', 'moveTable', 'recordCheck', 'getChecks']),
			},
			{
				displayName: 'Local Date',
				name: 'date',
				type: 'string',
				required: true,
				default: '',
				placeholder: '2026-12-24',
				description: 'YYYY-MM-DD in the business timezone',
				displayOptions: { show: { resource: ['availability'] } },
			},
			{
				displayName: 'Local Start Time',
				name: 'startsAt',
				type: 'string',
				required: true,
				default: '',
				placeholder: '2026-12-24T19:00',
				description: 'Business local time, YYYY-MM-DDTHH:MM, with no UTC offset. Use a slot from Availability.',
				displayOptions: show('booking', ['create']),
			},
			{
				displayName: 'Party Size',
				name: 'partySize',
				type: 'number',
				typeOptions: { minValue: 1 },
				default: 2,
				description: 'For a restaurant or bar. Ignored by an appointments business.',
				displayOptions: { show: { resource: ['availability', 'booking'], operation: ['check', 'create'] } },
			},
			{
				displayName: 'Service Name or ID',
				name: 'serviceId',
				type: 'options',
				typeOptions: { loadOptionsMethod: 'getServices' },
				default: '',
				description:
					'For an appointments business. Ignored by a restaurant or bar. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
				displayOptions: { show: { resource: ['availability', 'booking'], operation: ['check', 'create'] } },
			},
			{
				displayName: 'Staff Member Name or ID',
				name: 'providerId',
				type: 'options',
				typeOptions: { loadOptionsMethod: 'getStaff' },
				default: '',
				description:
					'For an appointments business. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
				displayOptions: { show: { resource: ['availability', 'booking'], operation: ['check', 'create'] } },
			},
			{
				displayName: 'Source Event ID',
				name: 'sourceId',
				type: 'string',
				required: true,
				default: '',
				description:
					'A stable unique ID from whatever started this booking. Re-running with the same ID returns the first booking instead of making a second. Use a new ID for each intended booking.',
				displayOptions: show('booking', ['create']),
			},
			{ displayName: 'Guest Name', name: 'name', type: 'string', required: true, default: '', displayOptions: show('booking', ['create']) },
			{ displayName: 'Guest Email', name: 'email', type: 'string', placeholder: 'name@email.com', required: true, default: '', displayOptions: show('booking', ['create']) },
			{ displayName: 'Guest Phone', name: 'phone', type: 'string', required: true, default: '', displayOptions: show('booking', ['create']) },
			{ displayName: 'Email', name: 'email', type: 'string', placeholder: 'name@email.com', default: '', description: 'Matched without regard to case. Fill email, phone or both.', displayOptions: show('guest', ['find']) },
			{ displayName: 'Phone', name: 'phone', type: 'string', default: '', description: 'Compared by digits only, so spacing and dashes do not matter', displayOptions: show('guest', ['find']) },
			{ displayName: 'Notes', name: 'notes', type: 'string', default: '', displayOptions: show('booking', ['create']) },
			{
				displayName: 'Update Fields',
				name: 'updateFields',
				type: 'collection',
				placeholder: 'Add Field',
				default: {},
				displayOptions: show('booking', ['update']),
				options: [
					{ displayName: 'Local Start Time', name: 'startsAt', type: 'string', default: '', placeholder: '2026-12-24T19:30', description: 'Business local time, YYYY-MM-DDTHH:MM' },
					{ displayName: 'Notes', name: 'notes', type: 'string', default: '' },
					{ displayName: 'Party Size', name: 'partySize', type: 'number', typeOptions: { minValue: 1 }, default: 2, description: 'Table bookings only' },
				],
			},
			{
				displayName: 'Status',
				name: 'status',
				type: 'options',
				required: true,
				default: 'seated',
				options: [
					{ name: 'Completed', value: 'completed' },
					{ name: 'Confirmed (Undo a Seat)', value: 'confirmed' },
					{ name: 'No-Show', value: 'no_show' },
					{ name: 'Seated', value: 'seated' },
				],
				displayOptions: show('booking', ['updateStatus']),
			},
			{
				displayName: 'Only If Current Status Is',
				name: 'ifStatus',
				type: 'options',
				default: '',
				options: [
					{ name: 'Any', value: '' },
					{ name: 'Confirmed', value: 'confirmed' },
					{ name: 'Seated', value: 'seated' },
				],
				description: 'Refuse the change if the booking has moved on',
				displayOptions: show('booking', ['updateStatus']),
			},
			{
				displayName: 'Table Name or ID',
				name: 'tableId',
				type: 'options',
				typeOptions: { loadOptionsMethod: 'getTables' },
				required: true,
				default: '',
				description: 'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
				displayOptions: show('booking', ['moveTable', 'seatWalkIn']),
			},
			{
				displayName: 'Walk-In Source Event ID',
				name: 'walkInSourceId',
				type: 'string',
				// Not marked required: a workflow saved before this field existed keeps
				// its old walkInFields.sourceId, which the run falls back to below.
				default: '',
				description: 'Needed. A stable ID from the till event that opened the table. Re-running with the same ID returns the first walk-in instead of seating the party twice. Use a new ID for each party.',
				displayOptions: show('booking', ['seatWalkIn']),
			},
			{ displayName: 'Walk-In Party Size', name: 'walkInPartySize', type: 'number', typeOptions: { minValue: 1 }, required: true, default: 2, displayOptions: show('booking', ['seatWalkIn']) },
			{
				displayName: 'Walk-In Options',
				name: 'walkInFields',
				type: 'collection',
				placeholder: 'Add Field',
				default: {},
				displayOptions: show('booking', ['seatWalkIn']),
				options: [
					{ displayName: 'Minutes at the Table', name: 'turnMinutes', type: 'number', typeOptions: { minValue: 15 }, default: 90, description: 'Leave unset for the venue default for that party size' },
					// n8n drops a saved collection value whose option is gone, so the old
					// home of the source event ID stays declared for older workflows.
					{ displayName: 'Source Event ID (Older Workflows)', name: 'sourceId', type: 'string', default: '', description: 'Where workflows saved before Walk-In Source Event ID kept it. Use Walk-In Source Event ID instead.' },
				],
			},
			{ displayName: 'Check Number', name: 'checkNumber', type: 'string', required: true, default: '', description: "The till's own check number. Sending it again updates the same check.", displayOptions: show('booking', ['recordCheck']) },
			{ displayName: 'Total in Cents', name: 'totalCents', type: 'number', typeOptions: { minValue: 0 }, required: true, default: 0, description: 'Whole cents in the venue currency. 12.50 is 1250.', displayOptions: show('booking', ['recordCheck']) },
			{
				displayName: 'Check Fields',
				name: 'checkFields',
				type: 'collection',
				placeholder: 'Add Field',
				default: {},
				displayOptions: show('booking', ['recordCheck']),
				options: [
					{ displayName: 'Closed At', name: 'closedAt', type: 'string', default: '', description: 'An exact time with a UTC offset, e.g. 2026-12-24T21:05:00+11:00' },
					{ displayName: 'Covers', name: 'covers', type: 'number', typeOptions: { minValue: 1 }, default: 2 },
					{
						displayName: 'Status',
						name: 'status',
						type: 'options',
						default: 'closed',
						options: [
							{ name: 'Closed', value: 'closed' },
							{ name: 'Open', value: 'open' },
							{ name: 'Voided', value: 'voided' },
						],
					},
				],
			},
			{
				displayName: 'From Local Date',
				name: 'fromDate',
				type: 'string',
				required: true,
				default: '',
				placeholder: '2026-12-24',
				description: 'First day, YYYY-MM-DD in the business timezone',
				displayOptions: show('booking', ['getAll']),
			},
			{
				displayName: 'To Local Date',
				name: 'toDate',
				type: 'string',
				default: '',
				placeholder: '2026-12-31',
				description: 'Last day, included. Leave empty for one day.',
				displayOptions: show('booking', ['getAll']),
			},
			{
				displayName: 'Return All',
				name: 'returnAll',
				type: 'boolean',
				default: false,
				description: 'Whether to return all results or only up to a given limit',
				displayOptions: { show: { operation: ['getAll'] } },
			},
			{
				displayName: 'Limit',
				name: 'limit',
				type: 'number',
				typeOptions: { minValue: 1 },
				default: 50,
				description: 'Max number of results to return',
				displayOptions: { show: { operation: ['getAll'], returnAll: [false] } },
			},
		],
	};

	methods = {
		loadOptions: {
			async getServices(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				if ((await businessType.call(this)) !== 'appointments') return [];
				const rows = await gaplesslyRequestAll.call(this, '/services');
				return rows.filter((r) => r.active !== false).map((r) => ({ name: `${r.name} (${r.durationMinutes} min)`, value: r.id as string }));
			},
			async getStaff(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				if ((await businessType.call(this)) !== 'appointments') return [];
				const rows = await gaplesslyRequestAll.call(this, '/providers');
				return rows.filter((r) => r.active !== false).map((r) => ({ name: r.name as string, value: r.id as string }));
			},
			async getTables(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				if ((await businessType.call(this)) !== 'hospitality') return [];
				const rows = await gaplesslyRequestAll.call(this, '/tables');
				return rows.filter((r) => r.active !== false).map((r) => ({ name: `${r.name} (${r.seatsMin}-${r.seatsMax} seats)`, value: r.id as string }));
			},
		},
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const out: INodeExecutionData[] = [];
		let type: 'hospitality' | 'appointments' | undefined;
		const engine = async () => (type ??= await businessType.call(this));

		const runItem = async (i: number): Promise<IDataObject | IDataObject[]> => {
				const resource = this.getNodeParameter('resource', i) as string;
				const operation = this.getNodeParameter('operation', i) as string;
				const param = <T>(name: string, fallback?: T) => this.getNodeParameter(name, i, fallback) as T;
				let result: IDataObject | IDataObject[];

				const limitFor = () => (param<boolean>('returnAll', false) ? Infinity : param<number>('limit', 50));
				const venueOnly = async () => {
					if ((await engine()) !== 'hospitality') throw new NodeOperationError(this.getNode(), 'This operation works for table bookings only', { itemIndex: i });
				};

				if (resource === 'event') {
					result = (await gaplesslyRequest.call(this, 'GET', `/events/${encodeURIComponent(param<string>('eventId'))}`)).data as IDataObject;
				} else if (resource === 'organization') {
					result = (await gaplesslyRequest.call(this, 'GET', '/organization')).data as IDataObject;
				} else if (resource === 'availability') {
					const qs: IDataObject = { date: param<string>('date') };
					if ((await engine()) === 'hospitality') qs.partySize = param<number>('partySize');
					else {
						qs.serviceId = param<string>('serviceId');
						if (param<string>('providerId', '')) qs.providerId = param<string>('providerId');
					}
					result = (await gaplesslyRequest.call(this, 'GET', '/availability', undefined, qs)).data as IDataObject;
				} else if (['service', 'servicePeriod', 'staff', 'table'].includes(resource)) {
					const path = { service: '/services', servicePeriod: '/service-periods', staff: '/providers', table: '/tables' }[resource] as string;
					result = await gaplesslyRequestAll.call(this, path, {}, limitFor());
				} else if (resource === 'guest') {
					if (operation === 'getAll') result = await gaplesslyRequestAll.call(this, '/clients', {}, limitFor());
					else {
						const email = param<string>('email', '').trim().toLowerCase();
						const phone = digits(param<string>('phone', ''));
						if (!email && !phone) throw new NodeOperationError(this.getNode(), 'Enter an email or a phone number', { itemIndex: i });
						// ponytail: no server-side guest search yet, so this scans up to
						// 2,000 guests; add ?q= to /api/v1/clients before venues outgrow it.
						const rows = await gaplesslyRequestAll.call(this, '/clients', {}, 2000);
						result = rows.filter((r) => (email && String(r.email ?? '').toLowerCase() === email) || (phone && digits(r.phone) === phone)).slice(0, 1);
					}
				} else {
					const path = bookingPath(await engine());
					const id = () => encodeURIComponent(param<string>('bookingId'));
					if (operation === 'create') {
						const body: IDataObject = {
							startsAt: param<string>('startsAt'),
							customer: { name: param<string>('name'), email: param<string>('email'), phone: param<string>('phone') },
						};
						if (param<string>('notes', '')) body.notes = param<string>('notes');
						if (path === '/reservations') body.partySize = param<number>('partySize');
						else {
							body.serviceId = param<string>('serviceId');
							body.providerId = param<string>('providerId');
						}
						const key = idempotencyKey(path, param<string>('sourceId'));
						result = (await gaplesslyRequest.call(this, 'POST', path, body, undefined, { 'Idempotency-Key': key })).data as IDataObject;
					} else if (operation === 'update') {
						const fields = param<IDataObject>('updateFields', {});
						if (path !== '/reservations') delete fields.partySize;
						if (!Object.keys(fields).length) throw new NodeOperationError(this.getNode(), 'Add a field to change: time, party size or notes', { itemIndex: i });
						result = (await gaplesslyRequest.call(this, 'PATCH', `${path}/${id()}`, fields)).data as IDataObject;
					} else if (operation === 'cancel') {
						result = (await gaplesslyRequest.call(this, 'POST', `${path}/${id()}/cancel`)).data as IDataObject;
					} else if (operation === 'getAll') {
						const from = param<string>('fromDate');
						const to = nextDay(param<string>('toDate', '') || from);
						const rows = await gaplesslyRequestAll.call(this, path, { from: `${from}T00:00:00`, to: `${to}T00:00:00` }, limitFor());
						result = rows.filter((r) => r.status !== 'hold');
					} else if (operation === 'updateStatus') {
						await venueOnly();
						const body: IDataObject = { status: param<string>('status') };
						if (param<string>('ifStatus', '')) body.ifStatus = param<string>('ifStatus');
						result = (await gaplesslyRequest.call(this, 'POST', `/reservations/${id()}/status`, body)).data as IDataObject;
					} else if (operation === 'moveTable') {
						await venueOnly();
						result = (await gaplesslyRequest.call(this, 'POST', `/reservations/${id()}/table`, { tableId: param<string>('tableId') })).data as IDataObject;
					} else if (operation === 'seatWalkIn') {
						await venueOnly();
						const options = param<IDataObject>('walkInFields', {});
						const body: IDataObject = { tableId: param<string>('tableId'), partySize: param<number>('walkInPartySize') };
						if (options.turnMinutes) body.turnMinutes = options.turnMinutes;
						const sourceId = String(param<string>('walkInSourceId', '') || options.sourceId || '').trim();
						// The API requires an Idempotency-Key here, as for any create.
						if (!sourceId) throw new NodeOperationError(this.getNode(), 'Enter a Walk-In Source Event ID', { itemIndex: i });
						const headers = { 'Idempotency-Key': idempotencyKey('/walk-ins', sourceId) };
						result = (await gaplesslyRequest.call(this, 'POST', '/walk-ins', body, undefined, headers)).data as IDataObject;
					} else if (operation === 'recordCheck') {
						await venueOnly();
						const extra = param<IDataObject>('checkFields', {});
						const body: IDataObject = { externalId: param<string>('checkNumber'), totalCents: Math.round(param<number>('totalCents')), ...extra };
						result = (await gaplesslyRequest.call(this, 'POST', `/reservations/${id()}/checks`, body)).data as IDataObject;
					} else {
						await venueOnly();
						const page = await gaplesslyRequest.call(this, 'GET', `/reservations/${id()}/checks`);
						result = { checks: page.data, spendCents: page.spendCents };
					}
				}

				return result;
		};

		for (let i = 0; i < items.length; i++) {
			let result: IDataObject | IDataObject[];
			// Errors are caught only to honour Continue On Fail; otherwise the
			// NodeApiError from the request reaches n8n with its HTTP details.
			if (this.continueOnFail()) {
				try {
					result = await runItem(i);
				} catch (error) {
					out.push({ json: { error: (error as Error).message }, pairedItem: { item: i } });
					continue;
				}
			} else {
				result = await runItem(i);
			}
			for (const json of Array.isArray(result) ? result : [result]) out.push({ json, pairedItem: { item: i } });
		}
		return [out];
	}
}
