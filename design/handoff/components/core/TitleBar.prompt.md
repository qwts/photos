Frameless desktop window title bar — this is Electron/Tauri chrome, not a browser page header. There is no OS title bar to fall back on, so every window needs this at its very top, above the Toolbar.

On mac, create the BrowserWindow with `titleBarStyle: "hiddenInset"` and let the OS draw the real traffic lights; `<TitleBar platform="mac">` just reserves the space and marks the bar as a drag region (`-webkit-app-region: drag`), with `no-drag` carved out under any controls. On Windows/Linux there's no native chrome at all, so `<TitleBar platform="win">` draws its own minimize/maximize/close.

```jsx
<TitleBar platform="mac" />
<Toolbar ... />
```

Never place draggable chrome content the user would want to click (buttons, search) directly on the drag region — mark those `no-drag` explicitly, as `WinButton` does internally.
