(() => {
  const requested = new URLSearchParams(window.location.search).get('theme');
  const theme = requested === 'light' ? 'light' : 'dark';
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
})();
