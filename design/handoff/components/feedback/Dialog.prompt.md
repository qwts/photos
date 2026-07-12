Modal dialog over a scrim. Positioned `absolute` — the nearest `position:relative` container (usually the app root) defines its bounds.

```jsx
<Dialog title="Export 12 photos" icon="share" onClose={close}
  footer={<><Button variant="ghost" onClick={close}>Cancel</Button><Button variant="primary">Export</Button></>}>
  …options…
</Dialog>
```
