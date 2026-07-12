Library grid tile. Sized by its grid cell (`width/height: 100%`, `object-fit: cover`). Selection = inset cyan ring + slight image shrink (Apple-Photos-style); hover reveals the select check. Offloaded photos dim to 55%.

```jsx
<PhotoTile src="thumbs/t01.png" status="synced" selected={sel.has(id)}
  onClick={openLightbox} onToggleSelect={() => toggle(id)} />
```
