# Private Cloud Sync Setup (Firebase + Google Sign-In)

This app can sync your medicines across PC + iPhone **privately** using Firebase Authentication (Google) + Firestore.

Your medication data is stored in Firestore under your user ID and protected by Firestore security rules.

## 1) Create Firebase project

- Go to Firebase Console and create a new project.

## 2) Add a Web App and copy config

- Project settings → **Your apps** → **Web app** → Register.
- Copy the config values into `firebase-config.js`.

## 3) Enable Google sign-in

- Build → Authentication → **Sign-in method** → Enable **Google**.
- Authentication → Settings → **Authorized domains**:
  - Add your GitHub Pages domain, e.g. `sunnyhighhigh.github.io`.

## 4) Create Firestore database

- Build → Firestore Database → Create database (Production mode is fine).

## 5) Set Firestore security rules (important)

Firestore → Rules:

```txt
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{userId} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
  }
}
```

This makes each user’s document readable/writable only by that signed-in user.

## 6) Deploy/update GitHub Pages

Commit and push your changes. Then open your GitHub Pages URL.

If you see an older version:
- Refresh twice, or
- On iPhone: Settings → Safari → Advanced → Website Data → delete your site → reload.

## Notes about privacy

- Your GitHub repo (and JavaScript code) can be public, but your **data** stays in Firestore.
- Firebase config values are not secret; privacy comes from **sign-in + Firestore rules**.
