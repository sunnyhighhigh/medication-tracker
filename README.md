# Medication Tracker (Starter Project)

This is a beginner-friendly web app to track your daily medicines.

## What this app does

- Lets you add medicines to your daily list.
- Shows each medicine with status:
  - `Pending`
  - `Taken`
- Includes a **Mark as Taken** button for each medicine.
- Saves your list in your browser using **localStorage**.
- Automatically resets all medicines back to **Pending** when a new day starts.
- Includes a **Reset Today** button (manual reset for the current day).

## Files

- `index.html` - page structure (form, list, buttons)
- `styles.css` - visual styling
- `script.js` - app logic (add medicine, render list, save/load, daily reset)

## How to run

1. Open the folder `medication-tracker-app` in VS Code.
2. Open `index.html` in your browser.
   - Easiest way in VS Code: right-click `index.html` and choose **Open with Live Server** (if installed),
   - or double-click `index.html` from File Explorer.

## Notes (beginner friendly)

- **localStorage** means the data stays in *this browser on this device*.
- If you clear browser data or use a different browser/computer, the list won’t be there.

## Next beginner improvements (optional)

- Add “time of day” (morning/afternoon/night) for each medicine.
- Add edit/delete for medicines.
- Add a history view (what was taken on previous dates).

## Private Cloud Sync (PC + iPhone)

This project can sync your medicine list across devices **privately** using Google sign-in + a database.

- Your GitHub Pages site stays public (it only hosts the app files).
- Your medication data is stored in your private account in Firestore.

Setup instructions: see `FIREBASE_SETUP.md`.

## Export/Import (optional backup)

Even with cloud sync, Export/Import can be useful as a backup.

