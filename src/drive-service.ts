import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { OAuth2Client } from "google-auth-library";
import { type drive_v3, google } from "googleapis";
import { AccountStorage } from "./account-storage.js";
import { DriveOAuthFlow } from "./drive-oauth-flow.js";
import type { DriveAccount } from "./types.js";

type DriveFile = drive_v3.Schema$File;

export interface FileListResult {
	files: DriveFile[];
	nextPageToken?: string;
}

export interface DownloadResult {
	success: boolean;
	path?: string;
	size?: number;
	error?: string;
}

export class DriveService {
	private accountStorage = new AccountStorage();
	private driveClients: Map<string, drive_v3.Drive> = new Map();

	async addAccount(email: string, clientId: string, clientSecret: string, manual = false): Promise<void> {
		if (this.accountStorage.hasAccount(email)) {
			throw new Error(`Account '${email}' already exists`);
		}

		const oauthFlow = new DriveOAuthFlow(clientId, clientSecret);
		const refreshToken = await oauthFlow.authorize(manual);

		const account: DriveAccount = {
			email,
			oauth2: { clientId, clientSecret, refreshToken },
		};

		this.accountStorage.addAccount(account);
	}

	deleteAccount(email: string): boolean {
		this.driveClients.delete(email);
		return this.accountStorage.deleteAccount(email);
	}

	listAccounts(): DriveAccount[] {
		return this.accountStorage.getAllAccounts();
	}

	setCredentials(clientId: string, clientSecret: string): void {
		this.accountStorage.setCredentials(clientId, clientSecret);
	}

	getCredentials(): { clientId: string; clientSecret: string } | null {
		return this.accountStorage.getCredentials();
	}

	private getDriveClient(email: string): drive_v3.Drive {
		if (!this.driveClients.has(email)) {
			const account = this.accountStorage.getAccount(email);
			if (!account) {
				throw new Error(`Account '${email}' not found`);
			}

			const oauth2Client = new OAuth2Client(
				account.oauth2.clientId,
				account.oauth2.clientSecret,
				"http://localhost",
			);

			oauth2Client.setCredentials({
				refresh_token: account.oauth2.refreshToken,
				access_token: account.oauth2.accessToken,
			});

			const drive = google.drive({ version: "v3", auth: oauth2Client });
			this.driveClients.set(email, drive);
		}

		return this.driveClients.get(email)!;
	}

	async listFiles(
		email: string,
		options: {
			query?: string;
			folderId?: string;
			maxResults?: number;
			pageToken?: string;
			orderBy?: string;
		} = {},
	): Promise<FileListResult> {
		const drive = this.getDriveClient(email);

		let q = options.query || "";
		if (options.folderId) {
			const folderQuery = `'${options.folderId}' in parents`;
			q = q ? `${q} and ${folderQuery}` : folderQuery;
		}
		// Exclude trashed files by default
		if (!q.includes("trashed")) {
			q = q ? `${q} and trashed = false` : "trashed = false";
		}

		const response = await drive.files.list({
			q: q || undefined,
			pageSize: options.maxResults || 20,
			pageToken: options.pageToken,
			orderBy: options.orderBy || "modifiedTime desc",
			fields: "nextPageToken, files(id, name, mimeType, size, modifiedTime, parents, webViewLink, driveId)",
			supportsAllDrives: true,
			includeItemsFromAllDrives: true,
		});

		return {
			files: response.data.files || [],
			nextPageToken: response.data.nextPageToken || undefined,
		};
	}

	async getFile(email: string, fileId: string): Promise<DriveFile> {
		const drive = this.getDriveClient(email);
		const response = await drive.files.get({
			fileId,
			fields:
				"id, name, mimeType, size, modifiedTime, createdTime, parents, webViewLink, description, starred, driveId",
			supportsAllDrives: true,
		});
		return response.data;
	}

	async download(email: string, fileId: string, destPath?: string): Promise<DownloadResult> {
		const drive = this.getDriveClient(email);

		// Get file metadata first
		const file = await this.getFile(email, fileId);
		if (!file.name) {
			return { success: false, error: "File has no name" };
		}

		// Determine destination path
		const downloadDir = path.join(os.homedir(), ".gdcli", "downloads");
		if (!fs.existsSync(downloadDir)) {
			fs.mkdirSync(downloadDir, { recursive: true });
		}
		const filePath = destPath || path.join(downloadDir, `${fileId}_${file.name}`);

		// Check if it's a Google Workspace file (needs export)
		const isGoogleDoc = file.mimeType?.startsWith("application/vnd.google-apps.");

		try {
			if (isGoogleDoc) {
				// Export Google Workspace files
				const exportMimeType = this.getExportMimeType(file.mimeType!);
				const response = await drive.files.export({ fileId, mimeType: exportMimeType }, { responseType: "stream" });

				const ext = this.getExportExtension(exportMimeType);
				const exportPath = filePath.replace(/\.[^./]+$/, "") + ext;

				const dest = fs.createWriteStream(exportPath);
				await new Promise<void>((resolve, reject) => {
					(response.data as NodeJS.ReadableStream).pipe(dest);
					dest.on("finish", resolve);
					dest.on("error", reject);
				});

				const stats = fs.statSync(exportPath);
				return { success: true, path: exportPath, size: stats.size };
			}
			// Download regular files
			const response = await drive.files.get(
				{ fileId, alt: "media", supportsAllDrives: true },
				{ responseType: "stream" },
			);

			const dest = fs.createWriteStream(filePath);
			await new Promise<void>((resolve, reject) => {
				(response.data as NodeJS.ReadableStream).pipe(dest);
				dest.on("finish", resolve);
				dest.on("error", reject);
			});

			const stats = fs.statSync(filePath);
			return { success: true, path: filePath, size: stats.size };
		} catch (e) {
			return { success: false, error: e instanceof Error ? e.message : String(e) };
		}
	}

	private getExportMimeType(googleMimeType: string): string {
		const exports: Record<string, string> = {
			"application/vnd.google-apps.document": "application/pdf",
			"application/vnd.google-apps.spreadsheet": "text/csv",
			"application/vnd.google-apps.presentation": "application/pdf",
			"application/vnd.google-apps.drawing": "image/png",
		};
		return exports[googleMimeType] || "application/pdf";
	}

	private getExportExtension(mimeType: string): string {
		const exts: Record<string, string> = {
			"application/pdf": ".pdf",
			"text/csv": ".csv",
			"image/png": ".png",
			"text/plain": ".txt",
		};
		return exts[mimeType] || ".pdf";
	}

	async upload(
		email: string,
		localPath: string,
		options: { name?: string; folderId?: string; mimeType?: string } = {},
	): Promise<DriveFile> {
		const drive = this.getDriveClient(email);

		const fileName = options.name || path.basename(localPath);
		const mimeType = options.mimeType || this.guessMimeType(localPath);

		const fileMetadata: drive_v3.Schema$File = {
			name: fileName,
			parents: options.folderId ? [options.folderId] : undefined,
		};

		const media = {
			mimeType,
			body: fs.createReadStream(localPath),
		};

		const response = await drive.files.create({
			requestBody: fileMetadata,
			media,
			fields: "id, name, mimeType, size, webViewLink, driveId",
			supportsAllDrives: true,
		});

		return response.data;
	}

	private guessMimeType(filePath: string): string {
		const ext = path.extname(filePath).toLowerCase();
		const mimeTypes: Record<string, string> = {
			".pdf": "application/pdf",
			".doc": "application/msword",
			".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
			".xls": "application/vnd.ms-excel",
			".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
			".ppt": "application/vnd.ms-powerpoint",
			".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
			".png": "image/png",
			".jpg": "image/jpeg",
			".jpeg": "image/jpeg",
			".gif": "image/gif",
			".txt": "text/plain",
			".html": "text/html",
			".css": "text/css",
			".js": "application/javascript",
			".json": "application/json",
			".zip": "application/zip",
			".csv": "text/csv",
			".md": "text/markdown",
		};
		return mimeTypes[ext] || "application/octet-stream";
	}

	async delete(email: string, fileId: string): Promise<void> {
		const drive = this.getDriveClient(email);
		await drive.files.delete({ fileId, supportsAllDrives: true });
	}

	async mkdir(email: string, name: string, parentId?: string): Promise<DriveFile> {
		const drive = this.getDriveClient(email);

		const fileMetadata: drive_v3.Schema$File = {
			name,
			mimeType: "application/vnd.google-apps.folder",
			parents: parentId ? [parentId] : undefined,
		};

		const response = await drive.files.create({
			requestBody: fileMetadata,
			fields: "id, name, mimeType, webViewLink, driveId",
			supportsAllDrives: true,
		});

		return response.data;
	}

	async move(email: string, fileId: string, newParentId: string): Promise<DriveFile> {
		const drive = this.getDriveClient(email);

		// Get current parents
		const file = await this.getFile(email, fileId);
		const previousParents = file.parents?.join(",") || "";

		const response = await drive.files.update({
			fileId,
			addParents: newParentId,
			removeParents: previousParents,
			fields: "id, name, mimeType, parents, webViewLink, driveId",
			supportsAllDrives: true,
		});

		return response.data;
	}

	async rename(email: string, fileId: string, newName: string): Promise<DriveFile> {
		const drive = this.getDriveClient(email);

		const response = await drive.files.update({
			fileId,
			requestBody: { name: newName },
			fields: "id, name, mimeType, webViewLink, driveId",
			supportsAllDrives: true,
		});

		return response.data;
	}

	async share(
		email: string,
		fileId: string,
		options: { anyone?: boolean; email?: string; role?: "reader" | "writer" } = {},
	): Promise<{ link: string; permissionId: string }> {
		const drive = this.getDriveClient(email);

		const role = options.role || "reader";

		let permission: { type: string; role: string; emailAddress?: string };
		if (options.anyone) {
			permission = { type: "anyone", role };
		} else if (options.email) {
			permission = { type: "user", role, emailAddress: options.email };
		} else {
			throw new Error("Must specify --anyone or --email");
		}

		const response = await drive.permissions.create({
			fileId,
			requestBody: permission,
			fields: "id",
			supportsAllDrives: true,
		});

		// Get the shareable link
		const file = await drive.files.get({
			fileId,
			fields: "webViewLink",
			supportsAllDrives: true,
		});

		return {
			link: file.data.webViewLink || `https://drive.google.com/file/d/${fileId}/view`,
			permissionId: response.data.id || "",
		};
	}

	async unshare(email: string, fileId: string, permissionId: string): Promise<void> {
		const drive = this.getDriveClient(email);
		await drive.permissions.delete({ fileId, permissionId, supportsAllDrives: true });
	}

	async listPermissions(
		email: string,
		fileId: string,
	): Promise<Array<{ id: string; type: string; role: string; email?: string }>> {
		const drive = this.getDriveClient(email);
		const response = await drive.permissions.list({
			fileId,
			fields: "permissions(id, type, role, emailAddress)",
			supportsAllDrives: true,
		});

		return (response.data.permissions || []).map((p) => ({
			id: p.id || "",
			type: p.type || "",
			role: p.role || "",
			email: p.emailAddress || undefined,
		}));
	}

	async search(email: string, query: string, maxResults = 20, pageToken?: string): Promise<FileListResult> {
		const drive = this.getDriveClient(email);

		// Full-text search
		const q = `fullText contains '${query.replace(/'/g, "\\'")}' and trashed = false`;

		const response = await drive.files.list({
			q,
			pageSize: maxResults,
			pageToken,
			fields: "nextPageToken, files(id, name, mimeType, size, modifiedTime, parents, webViewLink, driveId)",
			supportsAllDrives: true,
			includeItemsFromAllDrives: true,
		});

		return {
			files: response.data.files || [],
			nextPageToken: response.data.nextPageToken || undefined,
		};
	}
}
