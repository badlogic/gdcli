import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import type { DriveAccount } from "./types.js";

const CONFIG_DIR = path.join(os.homedir(), ".gdcli");
const ACCOUNTS_FILE = path.join(CONFIG_DIR, "accounts.json");
const CREDENTIALS_FILE = path.join(CONFIG_DIR, "credentials.json");

export class AccountStorage {
	private accounts: Map<string, DriveAccount> = new Map();

	constructor() {
		this.ensureConfigDir();
		this.loadAccounts();
	}

	private ensureConfigDir(): void {
		if (!fs.existsSync(CONFIG_DIR)) {
			fs.mkdirSync(CONFIG_DIR, { recursive: true });
		}
	}

	private loadAccounts(): void {
		if (fs.existsSync(ACCOUNTS_FILE)) {
			try {
				const data = JSON.parse(fs.readFileSync(ACCOUNTS_FILE, "utf8"));
				for (const account of data) {
					this.accounts.set(account.email, account);
				}
			} catch {
				// Ignore
			}
		}
	}

	private saveAccounts(): void {
		fs.writeFileSync(ACCOUNTS_FILE, JSON.stringify(Array.from(this.accounts.values()), null, 2));
	}

	addAccount(account: DriveAccount): void {
		this.accounts.set(account.email, account);
		this.saveAccounts();
	}

	getAccount(email: string): DriveAccount | undefined {
		return this.accounts.get(email);
	}

	getAllAccounts(): DriveAccount[] {
		return Array.from(this.accounts.values());
	}

	deleteAccount(email: string): boolean {
		const deleted = this.accounts.delete(email);
		if (deleted) this.saveAccounts();
		return deleted;
	}

	hasAccount(email: string): boolean {
		return this.accounts.has(email);
	}

	setCredentials(clientId: string, clientSecret: string): void {
		fs.writeFileSync(CREDENTIALS_FILE, JSON.stringify({ clientId, clientSecret }, null, 2));
	}

	getCredentials(): { clientId: string; clientSecret: string } | null {
		if (!fs.existsSync(CREDENTIALS_FILE)) return null;
		try {
			return JSON.parse(fs.readFileSync(CREDENTIALS_FILE, "utf8"));
		} catch {
			return null;
		}
	}
}
