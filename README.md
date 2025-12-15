# gdcli

Minimal Google Drive CLI for listing, searching, uploading, and downloading files.

## Install

```bash
npm install -g @mariozechner/gdcli
```

## Setup

Before adding an account, you need OAuth2 credentials from Google Cloud Console:

1. [Create a new project](https://console.cloud.google.com/projectcreate) (or select existing)
2. [Enable the Google Drive API](https://console.cloud.google.com/apis/library/drive.googleapis.com)
3. [Set app name](https://console.cloud.google.com/auth/branding) in OAuth branding
4. [Add test users](https://console.cloud.google.com/auth/audience) (all Gmail addresses you want to use)
5. [Create OAuth client](https://console.cloud.google.com/auth/clients):
   - Click "Create Client"
   - Application type: "Desktop app"
   - Download the JSON file

Then:

```bash
gdcli accounts credentials ~/path/to/credentials.json
gdcli accounts add you@gmail.com
```

You can reuse credentials from gmcli or gccli:
```bash
gdcli accounts credentials ~/.gmcli/credentials.json
```

## Usage

```
gdcli accounts <action>                Account management
gdcli <email> <command> [options]      Drive operations
```

## Commands

### accounts

```bash
gdcli accounts credentials <file.json>   # Set OAuth credentials (once)
gdcli accounts list                      # List configured accounts
gdcli accounts add <email>               # Add account (opens browser)
gdcli accounts add <email> --manual      # Add account (browserless, paste redirect URL)
gdcli accounts remove <email>            # Remove account
```

### ls

List files in a folder (default: root).

```bash
gdcli <email> ls [folderId] [options]
```

Options:
- `--max <n>` - Max results (default: 20)
- `--page <token>` - Page token for pagination
- `--query <q>` - Drive query filter

Examples:
```bash
gdcli you@gmail.com ls
gdcli you@gmail.com ls 1ABC123 --max 50
gdcli you@gmail.com ls --query "mimeType='image/png'"
```

### search

Full-text search across all files.

```bash
gdcli <email> search <query> [--max N] [--page TOKEN]
```

Example:
```bash
gdcli you@gmail.com search "quarterly report"
```

### get

Get file metadata.

```bash
gdcli <email> get <fileId>
```

### download

Download a file. Google Docs are exported as PDF/CSV.

```bash
gdcli <email> download <fileId> [destPath]
```

Default destination: `~/.gdcli/downloads/`

Examples:
```bash
gdcli you@gmail.com download 1ABC123
gdcli you@gmail.com download 1ABC123 ./myfile.pdf
```

### upload

Upload a file.

```bash
gdcli <email> upload <localPath> [options]
```

Options:
- `--name <n>` - Override filename
- `--folder <folderId>` - Destination folder
- `--convert <type>` - Convert to Google format: `docs`, `sheets`, or `slides`

Examples:
```bash
gdcli you@gmail.com upload ./report.pdf
gdcli you@gmail.com upload ./report.pdf --folder 1ABC123 --name "Q4 Report.pdf"
gdcli you@gmail.com upload ./README.md --convert docs
gdcli you@gmail.com upload ./data.csv --convert sheets
```

**Note:** The `--convert` option uses Google Drive's import feature. Some conversions (notably Markdown to Google Docs with full formatting) work best with Google Workspace accounts. Personal Gmail accounts may have limited conversion support.

### mkdir

Create a folder.

```bash
gdcli <email> mkdir <name> [--parent <folderId>]
```

Example:
```bash
gdcli you@gmail.com mkdir "New Folder" --parent 1ABC123
```

### delete

Delete a file (moves to trash).

```bash
gdcli <email> delete <fileId>
```

### move

Move a file to a different folder.

```bash
gdcli <email> move <fileId> <newParentId>
```

### rename

Rename a file or folder.

```bash
gdcli <email> rename <fileId> <newName>
```

### share

Share a file or folder.

```bash
gdcli <email> share <fileId> [options]
```

Options:
- `--anyone` - Make publicly accessible (anyone with link)
- `--email <addr>` - Share with specific user
- `--role <r>` - Permission level: `reader` (default) or `writer`

Examples:
```bash
gdcli you@gmail.com share 1ABC123 --anyone
gdcli you@gmail.com share 1ABC123 --email friend@gmail.com --role writer
```

### unshare

Remove a permission from a file.

```bash
gdcli <email> unshare <fileId> <permissionId>
```

Get permission IDs with `permissions` command.

### permissions

List permissions on a file.

```bash
gdcli <email> permissions <fileId>
```

### url

Print web URLs for files.

```bash
gdcli <email> url <fileIds...>
```

## Data Storage

All data is stored in `~/.gdcli/`:
- `credentials.json` - OAuth client credentials
- `accounts.json` - Account tokens
- `downloads/` - Downloaded files

## Development

```bash
npm install
npm run build
npm run check
```

## License

MIT
