# Setting up "Sign in with Google" (Drive sync)

ClassMap works without this. These steps turn on the optional **Sign in with Google** button,
which keeps a copy of each teacher's classes in their own Google Drive. It's free; there is
no server to run. Takes about 20 minutes.

## 1. Create a Google Cloud project
1. Go to <https://console.cloud.google.com/> and sign in with the Google account that will own ClassMap.
2. Top bar → project picker → **New project** → name it `ClassMap` → **Create**.

## 2. Turn on the Google Drive API
**APIs & Services → Library** → search **Google Drive API** → **Enable**.

## 3. Set up the sign-in screen (OAuth consent)
**APIs & Services → OAuth consent screen** (called **Google Auth Platform** in newer consoles):
1. **App name:** ClassMap · **User support email:** your email.
2. **Audience / User type:** **External**.
3. **Contact email:** your email.
4. **Branding:** app logo (`public/icons/icon-512.png`), **home page** = your site's address
   (`https://classmap.dev/`), **privacy policy** = `https://classmap.dev/privacy/`.
5. **Data access / Scopes → Add scopes:** choose
   - `.../auth/drive.file` — *See, edit, create and delete only the specific Google Drive files you use with this app*
   - `openid` and `.../auth/userinfo.email`
6. While the app is in **Testing**, only the accounts you add under **Test users** can sign in
   (up to 100). Add your own account and a few teacher friends.

## 4. Create the OAuth client ID
**APIs & Services → Credentials → Create credentials → OAuth client ID**
- **Application type:** Web application · **Name:** ClassMap web
- **Authorized JavaScript origins** (no paths, no trailing slash):
  - `http://localhost:5173` (for `npm run dev`)
  - `http://localhost:4173` (for `npm run preview`)
  - `https://YOURNAME.github.io` (your live site; later also your own domain, e.g. `https://classmap.example`)
- No redirect URIs are needed.
- **Create** → copy the **Client ID** (ends in `.apps.googleusercontent.com`).

## 5. Put the client ID in ClassMap
- **On your computer:** copy `.env.example` to `.env` and paste it after `VITE_GOOGLE_CLIENT_ID=`.
  Restart `npm run dev`. The home page now shows **Sign in with Google**.
- **On GitHub:** repo **Settings → Secrets and variables → Actions → Variables → New repository variable**
  - Name: `VITE_GOOGLE_CLIENT_ID` · Value: the client ID.
  The deploy workflow passes it to the build.

The client ID is not a secret (it's visible in every web app that uses Google sign-in);
Google only accepts it from the origins you listed in step 4.

## 6. Going public (verification)
In Testing mode only your test users can sign in. To let any teacher sign in:
1. Fill in the `TODO` contact email in `index.html` and `privacy/index.html`.
2. Verify your domain in Google Search Console (Google asks for this for the home page / privacy links).
   A custom domain is easiest; for `github.io` addresses follow Google's instructions for the property.
3. OAuth consent screen → **Publish app** → submit for verification.
   `drive.file`, `openid` and `email` are **non-sensitive** scopes, so this is the light review
   (brand check), not the full security assessment. It usually takes a few days.

## How it behaves
- Signing in uploads the classes on this device. Signing in on a second device merges both.
- Changes upload a few seconds after each save. Other devices pick them up when you return to the
  tab or go back to the home page.
- Google sign-ins last about an hour (there's no ClassMap server to renew them). After that the
  home page shows **Reconnect Google Drive** — one click, no password if you're still signed in to Google.
  Everything keeps saving on the device in the meantime.
