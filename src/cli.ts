#!/usr/bin/env node

import * as fs from "fs";
import { parseArgs } from "util";
import { DriveService } from "./drive-service.js";

const service = new DriveService();

function usage(): never {
	console.log(`gdcli - Google Drive CLI

USAGE

  gdcli accounts <action>                    Account management
  gdcli <email> <command> [options]          Drive operations

ACCOUNT COMMANDS

  gdcli accounts credentials <file.json>     Set OAuth credentials (once)
  gdcli accounts list                        List configured accounts
  gdcli accounts add <email> [--manual]      Add account (--manual for browserless OAuth)
  gdcli accounts remove <email>              Remove account

DRIVE COMMANDS

  gdcli <email> ls [folderId] [options]
      List files in a folder (default: root).
      Options:
        --max <n>            Max results (default: 20)
        --page <token>       Page token for pagination
        --query <q>          Drive query filter (e.g., "mimeType='image/png'")

  gdcli <email> search <query> [--max N] [--page TOKEN]
      Full-text search across all files.

  gdcli <email> get <fileId>
      Get file metadata.

  gdcli <email> download <fileId> [destPath]
      Download a file. Google Docs are exported as PDF/CSV.
      Default destination: ~/.gdcli/downloads/

  gdcli <email> upload <localPath> [options]
      Upload a file.
      Options:
        --name <n>           Override filename
        --folder <folderId>  Destination folder
        --convert <type>     Convert to Google format: docs, sheets, or slides

  gdcli <email> mkdir <name> [--parent <folderId>]
      Create a folder.

  gdcli <email> delete <fileId>
      Delete a file (moves to trash).

  gdcli <email> move <fileId> <newParentId>
      Move a file to a different folder.

  gdcli <email> rename <fileId> <newName>
      Rename a file or folder.

  gdcli <email> share <fileId> [options]
      Share a file or folder.
      Options:
        --anyone             Make publicly accessible
        --email <addr>       Share with specific user
        --role <r>           Permission: reader (default) or writer

  gdcli <email> unshare <fileId> <permissionId>
      Remove a permission from a file.

  gdcli <email> permissions <fileId>
      List permissions on a file.

  gdcli <email> url <fileIds...>
      Print web URLs for files.

EXAMPLES

  gdcli accounts list
  gdcli you@gmail.com ls
  gdcli you@gmail.com ls 1ABC123 --max 50
  gdcli you@gmail.com search "quarterly report"
  gdcli you@gmail.com get 1ABC123
  gdcli you@gmail.com download 1ABC123
  gdcli you@gmail.com download 1ABC123 ./myfile.pdf
  gdcli you@gmail.com upload ./report.pdf --folder 1ABC123
  gdcli you@gmail.com upload ./README.md --convert docs
  gdcli you@gmail.com mkdir "New Folder" --parent 1ABC123
  gdcli you@gmail.com delete 1ABC123
  gdcli you@gmail.com move 1ABC123 1DEF456
  gdcli you@gmail.com rename 1ABC123 "New Name.pdf"
  gdcli you@gmail.com share 1ABC123 --anyone
  gdcli you@gmail.com share 1ABC123 --email friend@gmail.com --role writer
  gdcli you@gmail.com permissions 1ABC123
  gdcli you@gmail.com unshare 1ABC123 anyoneWithLink
  gdcli you@gmail.com url 1ABC123 1DEF456

DATA STORAGE

  ~/.gdcli/credentials.json   OAuth client credentials
  ~/.gdcli/accounts.json      Account tokens
  ~/.gdcli/downloads/         Downloaded files`);
	process.exit(1);
}

function error(msg: string): never {
	console.error("Error:", msg);
	process.exit(1);
}

function formatSize(bytes: number | string | null | undefined): string {
	if (!bytes) return "-";
	const b = typeof bytes === "string" ? Number.parseInt(bytes, 10) : bytes;
	if (b === 0) return "0 B";
	const units = ["B", "KB", "MB", "GB", "TB"];
	const i = Math.floor(Math.log(b) / Math.log(1024));
	return `${(b / 1024 ** i).toFixed(i > 0 ? 1 : 0)} ${units[i]}`;
}

async function main() {
	const args = process.argv.slice(2);
	if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
		usage();
	}

	const first = args[0];
	const rest = args.slice(1);

	try {
		if (first === "accounts") {
			await handleAccounts(rest);
			return;
		}

		const account = first;
		const command = rest[0];
		const commandArgs = rest.slice(1);

		if (!command) {
			error("Missing command. Use --help for usage.");
		}

		switch (command) {
			case "ls":
				await handleLs(account, commandArgs);
				break;
			case "search":
				await handleSearch(account, commandArgs);
				break;
			case "get":
				await handleGet(account, commandArgs);
				break;
			case "download":
				await handleDownload(account, commandArgs);
				break;
			case "upload":
				await handleUpload(account, commandArgs);
				break;
			case "mkdir":
				await handleMkdir(account, commandArgs);
				break;
			case "delete":
				await handleDelete(account, commandArgs);
				break;
			case "move":
				await handleMove(account, commandArgs);
				break;
			case "rename":
				await handleRename(account, commandArgs);
				break;
			case "share":
				await handleShare(account, commandArgs);
				break;
			case "unshare":
				await handleUnshare(account, commandArgs);
				break;
			case "permissions":
				await handlePermissions(account, commandArgs);
				break;
			case "url":
				handleUrl(commandArgs);
				break;
			default:
				error(`Unknown command: ${command}`);
		}
	} catch (e) {
		error(e instanceof Error ? e.message : String(e));
	}
}

async function handleAccounts(args: string[]) {
	const action = args[0];
	if (!action) error("Missing action: list|add|remove|credentials");

	switch (action) {
		case "list": {
			const accounts = service.listAccounts();
			if (accounts.length === 0) {
				console.log("No accounts configured");
			} else {
				for (const a of accounts) {
					console.log(a.email);
				}
			}
			break;
		}
		case "credentials": {
			const credFile = args[1];
			if (!credFile) error("Usage: accounts credentials <credentials.json>");
			const creds = JSON.parse(fs.readFileSync(credFile, "utf8"));
			const installed = creds.installed || creds.web;
			const clientId = installed?.client_id || creds.clientId;
			const clientSecret = installed?.client_secret || creds.clientSecret;
			if (!clientId || !clientSecret) error("Invalid credentials file");
			service.setCredentials(clientId, clientSecret);
			console.log("Credentials saved");
			break;
		}
		case "add": {
			const manual = args.includes("--manual");
			const filtered = args.slice(1).filter((a) => a !== "--manual");
			const email = filtered[0];
			if (!email) error("Usage: accounts add <email> [--manual]");
			const creds = service.getCredentials();
			if (!creds) error("No credentials configured. Run: gdcli accounts credentials <credentials.json>");
			await service.addAccount(email, creds.clientId, creds.clientSecret, manual);
			console.log(`Account '${email}' added`);
			break;
		}
		case "remove": {
			const email = args[1];
			if (!email) error("Usage: accounts remove <email>");
			const deleted = service.deleteAccount(email);
			console.log(deleted ? `Removed '${email}'` : `Not found: ${email}`);
			break;
		}
		default:
			error(`Unknown action: ${action}`);
	}
}

async function handleLs(account: string, args: string[]) {
	const { values, positionals } = parseArgs({
		args,
		options: {
			max: { type: "string" },
			page: { type: "string" },
			query: { type: "string" },
		},
		allowPositionals: true,
	});

	const folderId = positionals[0];

	const result = await service.listFiles(account, {
		folderId: folderId || undefined,
		maxResults: values.max ? Number(values.max) : 20,
		pageToken: values.page,
		query: values.query,
	});

	if (result.files.length === 0) {
		console.log("No files");
	} else {
		console.log("ID\tNAME\tTYPE\tSIZE\tMODIFIED");
		for (const f of result.files) {
			const type = f.mimeType?.includes("folder") ? "folder" : "file";
			const modified = f.modifiedTime ? f.modifiedTime.slice(0, 16).replace("T", " ") : "-";
			console.log(`${f.id}\t${f.name}\t${type}\t${formatSize(f.size)}\t${modified}`);
		}
		if (result.nextPageToken) {
			console.log(`\n# Next page: --page ${result.nextPageToken}`);
		}
	}
}

async function handleSearch(account: string, args: string[]) {
	const { values, positionals } = parseArgs({
		args,
		options: {
			max: { type: "string" },
			page: { type: "string" },
		},
		allowPositionals: true,
	});

	const query = positionals.join(" ");
	if (!query) error("Usage: <email> search <query>");

	const result = await service.search(account, query, values.max ? Number(values.max) : 20, values.page);

	if (result.files.length === 0) {
		console.log("No results");
	} else {
		console.log("ID\tNAME\tTYPE\tSIZE\tMODIFIED");
		for (const f of result.files) {
			const type = f.mimeType?.includes("folder") ? "folder" : "file";
			const modified = f.modifiedTime ? f.modifiedTime.slice(0, 16).replace("T", " ") : "-";
			console.log(`${f.id}\t${f.name}\t${type}\t${formatSize(f.size)}\t${modified}`);
		}
		if (result.nextPageToken) {
			console.log(`\n# Next page: --page ${result.nextPageToken}`);
		}
	}
}

async function handleGet(account: string, args: string[]) {
	const fileId = args[0];
	if (!fileId) error("Usage: <email> get <fileId>");

	const file = await service.getFile(account, fileId);

	console.log(`ID: ${file.id}`);
	console.log(`Name: ${file.name}`);
	console.log(`Type: ${file.mimeType}`);
	console.log(`Size: ${formatSize(file.size)}`);
	console.log(`Created: ${file.createdTime || "-"}`);
	console.log(`Modified: ${file.modifiedTime || "-"}`);
	if (file.description) console.log(`Description: ${file.description}`);
	console.log(`Starred: ${file.starred ? "yes" : "no"}`);
	console.log(`Link: ${file.webViewLink || "-"}`);
}

async function handleDownload(account: string, args: string[]) {
	const fileId = args[0];
	const destPath = args[1];
	if (!fileId) error("Usage: <email> download <fileId> [destPath]");

	const result = await service.download(account, fileId, destPath);

	if (result.success) {
		console.log(`Downloaded: ${result.path}`);
		console.log(`Size: ${formatSize(result.size)}`);
	} else {
		error(result.error || "Download failed");
	}
}

async function handleUpload(account: string, args: string[]) {
	const { values, positionals } = parseArgs({
		args,
		options: {
			name: { type: "string" },
			folder: { type: "string" },
			convert: { type: "string" },
		},
		allowPositionals: true,
	});

	const localPath = positionals[0];
	if (!localPath)
		error("Usage: <email> upload <localPath> [--name <n>] [--folder <folderId>] [--convert docs|sheets|slides]");

	if (!fs.existsSync(localPath)) {
		error(`File not found: ${localPath}`);
	}

	const file = await service.upload(account, localPath, {
		name: values.name,
		folderId: values.folder,
		convertTo: values.convert,
	});

	console.log(`Uploaded: ${file.id}`);
	console.log(`Name: ${file.name}`);
	console.log(`Link: ${file.webViewLink || "-"}`);
}

async function handleMkdir(account: string, args: string[]) {
	const { values, positionals } = parseArgs({
		args,
		options: {
			parent: { type: "string" },
		},
		allowPositionals: true,
	});

	const name = positionals[0];
	if (!name) error("Usage: <email> mkdir <name> [--parent <folderId>]");

	const folder = await service.mkdir(account, name, values.parent);

	console.log(`Created: ${folder.id}`);
	console.log(`Name: ${folder.name}`);
	console.log(`Link: ${folder.webViewLink || "-"}`);
}

async function handleDelete(account: string, args: string[]) {
	const fileId = args[0];
	if (!fileId) error("Usage: <email> delete <fileId>");

	await service.delete(account, fileId);
	console.log("Deleted");
}

async function handleMove(account: string, args: string[]) {
	const fileId = args[0];
	const newParentId = args[1];
	if (!fileId || !newParentId) error("Usage: <email> move <fileId> <newParentId>");

	const file = await service.move(account, fileId, newParentId);
	console.log(`Moved: ${file.id}`);
	console.log(`Name: ${file.name}`);
}

async function handleRename(account: string, args: string[]) {
	const fileId = args[0];
	const newName = args[1];
	if (!fileId || !newName) error("Usage: <email> rename <fileId> <newName>");

	const file = await service.rename(account, fileId, newName);
	console.log(`Renamed: ${file.id}`);
	console.log(`Name: ${file.name}`);
}

async function handleShare(account: string, args: string[]) {
	const { values, positionals } = parseArgs({
		args,
		options: {
			anyone: { type: "boolean" },
			email: { type: "string" },
			role: { type: "string" },
		},
		allowPositionals: true,
	});

	const fileId = positionals[0];
	if (!fileId) error("Usage: <email> share <fileId> [--anyone | --email <addr>] [--role reader|writer]");
	if (!values.anyone && !values.email) error("Must specify --anyone or --email <addr>");

	const role = (values.role as "reader" | "writer") || "reader";
	const result = await service.share(account, fileId, {
		anyone: values.anyone,
		email: values.email,
		role,
	});

	console.log(`Shared: ${result.link}`);
	console.log(`Permission ID: ${result.permissionId}`);
}

async function handleUnshare(account: string, args: string[]) {
	const fileId = args[0];
	const permissionId = args[1];
	if (!fileId || !permissionId) error("Usage: <email> unshare <fileId> <permissionId>");

	await service.unshare(account, fileId, permissionId);
	console.log("Permission removed");
}

async function handlePermissions(account: string, args: string[]) {
	const fileId = args[0];
	if (!fileId) error("Usage: <email> permissions <fileId>");

	const perms = await service.listPermissions(account, fileId);
	if (perms.length === 0) {
		console.log("No permissions");
	} else {
		console.log("ID\tTYPE\tROLE\tEMAIL");
		for (const p of perms) {
			console.log(`${p.id}\t${p.type}\t${p.role}\t${p.email || "-"}`);
		}
	}
}

function handleUrl(args: string[]) {
	if (args.length === 0) {
		error("Usage: <email> url <fileIds...>");
	}

	for (const id of args) {
		const url = `https://drive.google.com/file/d/${id}/view`;
		console.log(`${id}\t${url}`);
	}
}

main();
