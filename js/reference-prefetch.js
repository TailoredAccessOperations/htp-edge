(() => {
  const urls = [
    'https://www.cia.gov/spy-kids/',
    'https://www.cia.gov/spy-kids/stories/',
    'https://www.cia.gov/spy-kids/spy-dogs/',
    'https://www.cia.gov/spy-kids/games/',
    'https://www.cia.gov/spy-kids/parents-teachers/',
    'https://www.cia.gov/about/',
    'https://www.cia.gov/legacy/museum/',
    'https://www.cia.gov/stories/',
  ];
  const warm = () => urls.forEach((href) => { const link = document.createElement('link'); link.rel = 'prefetch'; link.as = 'document'; link.href = href; document.head.appendChild(link); });
  if ('requestIdleCallback' in window) requestIdleCallback(warm, { timeout: 2500 });
  else setTimeout(warm, 1200);
})();
