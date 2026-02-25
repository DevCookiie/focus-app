# Focus — Todo + Pomodoro Timer

A modern desktop app built with **Electron + TypeScript** featuring a todo list and Pomodoro timer.

## Features
- Pomodoro timer (25 min work / 5 min break / 15 min long break)
- Visual ring countdown
- Auto-switches between Work → Break → Long Break after 4 sessions
- Sound notification when timer ends (Web Audio API — no files needed)
- Todo list with add / complete / delete tasks
- Link any task to the active Pomodoro session
- Filter tasks by All / Active / Done
- Tasks saved to `localStorage` (persist across sessions)
- Custom frameless window with dark UI

## Development

```bash
npm install       # install dependencies
npm run dev       # build + launch app
npm run build     # TypeScript compile only
npm start         # build + launch app (same as dev)
```

## Project Structure
```
Todo-app/
├── src/
│   ├── main.ts        # Electron main process
│   └── preload.ts     # Electron preload (window controls IPC)
├── renderer/
│   ├── index.html     # App UI
│   ├── styles.css     # Dark theme styles
│   └── app.js         # All UI logic (timer + todos)
├── dist/              # Compiled JS (auto-generated)
├── package.json
└── tsconfig.json
```
