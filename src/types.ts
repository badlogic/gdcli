export interface DriveAccount {
	email: string;
	oauth2: {
		clientId: string;
		clientSecret: string;
		refreshToken: string;
		accessToken?: string;
	};
}
