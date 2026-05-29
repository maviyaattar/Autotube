# Autotube

Autotube is a YouTube Shorts automation SaaS backend. It handles user authentication, YouTube OAuth connection, video generation via Cloudinary, and scheduled uploads.

## Setup

1. Copy `.env.example` to `.env` and fill in the required values (see below).
2. `npm install`
3. `npm start`

## Environment Variables

| Variable | Description |
|---|---|
| `MONGO_URI` | MongoDB connection string |
| `JWT_SECRET` | Secret for signing JWT tokens |
| `GOOGLE_CLIENT_ID` | Google OAuth2 client ID |
| `GOOGLE_CLIENT_SECRET` | Google OAuth2 client secret |
| `YT_OAUTH_REDIRECT` | OAuth redirect URI (must match Google Console) |
| `CLOUDINARY_CLOUD_NAME` | Cloudinary cloud name |
| `CLOUDINARY_API_KEY` | Cloudinary API key |
| `CLOUDINARY_API_SECRET` | Cloudinary API secret |

## YouTube OAuth Scopes

The application requests the following Google OAuth scopes when a user connects their YouTube account:

- `https://www.googleapis.com/auth/youtube` – Full YouTube account access, required for listing channels (`channels.list`) and uploading videos (`videos.insert`).
- `https://www.googleapis.com/auth/userinfo.email` – Retrieve the account email address.
- `https://www.googleapis.com/auth/userinfo.profile` – Retrieve basic profile information.

> **Why `youtube` and not just `youtube.upload`?**  
> `youtube.upload` only covers video uploads. Listing the user's own channel (`channels.list` with `mine: true`) requires the broader `youtube` scope. Using only `youtube.upload` causes an *"Insufficient Permission"* error during account connection.

## Re-authentication for Existing Users

If a user connected their YouTube account before this fix was applied, their stored token does **not** include the `youtube` scope. They must disconnect and reconnect:

1. Go to **Settings → YouTube Accounts**.
2. Click **Disconnect** next to the affected account.
3. Click **Connect YouTube** and complete the OAuth flow again.

The backend will automatically set `needsReconnect: true` on an account whenever a job fails due to insufficient permissions, which frontends can use to display a reconnect prompt.