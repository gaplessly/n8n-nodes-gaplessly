import type { IAuthenticateGeneric, ICredentialTestRequest, ICredentialType, INodeProperties, Icon } from 'n8n-workflow';

export class GaplesslyApi implements ICredentialType {
	name = 'gaplesslyApi';

	displayName = 'Gaplessly API';

	icon: Icon = { light: 'file:gaplessly.svg', dark: 'file:gaplessly.dark.svg' };

	documentationUrl = 'https://gaplessly.com/docs/integrations';

	properties: INodeProperties[] = [
		{
			displayName: 'API Key',
			name: 'apiKey',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			required: true,
			description:
				'Create a key on the Developer page in Gaplessly. A test key (sk_test_) only reaches your sandbox, so start with one.',
		},
	];

	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			headers: {
				Authorization: '=Bearer {{$credentials.apiKey}}',
			},
		},
	};

	test: ICredentialTestRequest = {
		request: {
			baseURL: 'https://gaplessly.com/api/v1',
			url: '/organization',
		},
	};
}
