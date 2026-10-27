(() => {
  'use strict';

  const profiles = [
    { id: 'madisonbeer', name: '@madisonbeer', platform: 'TikTok', url: 'https://www.tiktok.com/@madisonbeer' },
    { id: 'breckiehill', name: '@breckiehill', platform: 'TikTok', url: 'https://www.tiktok.com/@breckiehill' },
    { id: 'virtualtorii', name: '@virtualtorii', platform: 'X', url: 'https://x.com/virtualtorii' },
    { id: 'toriibunni', name: '@toriibunni', platform: 'X', url: 'https://x.com/toriibunni' },
    { id: 'haninoelle', name: '@haninoelle', platform: 'TikTok', url: 'https://www.tiktok.com/@haninoelle' },
    { id: 'kitten', name: '@kitten', platform: 'TikTok', url: 'https://www.tiktok.com/@kitten' },
  ];

  const state = { active: profiles[0], entries: [], filter: '' };
  const $ = (id) => document.getElementById(id);
  const esc = (value) => String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const sourceFor = (entry) => entry.src || entry.hls || '';

  function initials(name) { return name.replace('@', '').slice(0, 2).toUpperCase(); }

  function renderProfiles() {
    const query = state.filter.toLowerCase();
    const visible = profiles.filter((profile) => `${profile.name} ${profile.platform}`.toLowerCase().includes(query));
    $('profile-count').textContent = `${visible.length} profile${visible.length === 1 ? '' : 's'}`;
    $('profile-list').innerHTML = visible.length ? visible.map((profile) => `
      <button class="profile-card ${profile.id === state.active.id ? 'active' : ''}" type="button" data-profile="${profile.id}">
        <span class="avatar">${initials(profile.name)}</span>
        <span><strong class="profile-name">${esc(profile.name)}</strong><span class="profile-platform">${esc(profile.platform)}</span></span>
        <span class="profile-meta">${countFor(profile.id)} local</span>
      </button>`).join('') : '<div class="empty">No matching profiles.</div>';
    document.querySelectorAll('[data-profile]').forEach((button) => button.addEventListener('click', () => selectProfile(button.dataset.profile)));
  }

  function countFor(id) { return state.entries.filter((entry) => !entry.profile || entry.profile === id).length; }

  function renderLibrary() {
    const profile = state.active;
    $('active-platform').textContent = profile.platform.toUpperCase();
    $('active-title').textContent = profile.name;
    $('active-url').textContent = profile.url;
    $('open-source').href = profile.url;
    const entries = state.entries.filter((entry) => !entry.profile || entry.profile === profile.id);
    $('library-status').textContent = entries.length ? `${entries.length} local item${entries.length === 1 ? '' : 's'} available · manifest-driven` : 'No local items for this profile yet. Open the source, export authorized media, then add it to public/media/manifest.json with a profile field.';
    $('media-grid').innerHTML = entries.length ? entries.map(cardFor).join('') : `<div class="empty"><strong>No local media loaded</strong><br><span>Source: ${esc(profile.url)}</span><br><a class="button" href="${esc(profile.url)}" target="_blank" rel="noopener noreferrer">open profile ↗</a></div>`;
  }

  function cardFor(entry, index) {
    const src = sourceFor(entry);
    const title = entry.title || entry.slug || `item-${index + 1}`;
    const type = entry.type || (entry.hls ? 'video' : 'video');
    let preview = '<div class="media-placeholder">No preview available</div>';
    if (type === 'image' && src) preview = `<img src="${esc(src)}" alt="${esc(title)}" loading="lazy">`;
    if (type === 'video' && src) preview = `<video src="${esc(src)}" controls preload="metadata" playsinline></video>`;
    if (type === 'audio' && src) preview = `<audio src="${esc(src)}" controls preload="metadata"></audio>`;
    return `<article class="media-card" data-media-src="${esc(src)}"><div class="media-preview">${preview}</div><div class="media-info"><h3 class="media-title" title="${esc(title)}">${esc(title)}</h3><span class="media-type">${esc(type)}${entry.note ? ` · ${esc(entry.note)}` : ''}</span><div class="media-actions">${src ? `<a class="button" href="${esc(src)}" target="_blank" rel="noopener noreferrer">open</a><a class="button button-accent download-link" href="${esc(src)}" download>download</a>` : '<span class="muted">source unavailable</span>'}</div></div></article>`;
  }

  function selectProfile(id) {
    const profile = profiles.find((item) => item.id === id);
    if (!profile) return;
    state.active = profile;
    renderProfiles();
    renderLibrary();
  }

  async function loadManifest() {
    try {
      const response = await fetch('/media/manifest.json', { headers: { accept: 'application/json' } });
      if (!response.ok) throw new Error('manifest unavailable');
      const manifest = await response.json();
      state.entries = Array.isArray(manifest.entries) ? manifest.entries : [];
    } catch { state.entries = []; }
    renderProfiles();
    renderLibrary();
  }

  $('profile-filter').addEventListener('input', (event) => { state.filter = event.target.value; renderProfiles(); });
  $('refresh-library').addEventListener('click', loadManifest);
  $('download-visible').addEventListener('click', () => document.querySelectorAll('.download-link').forEach((link, index) => setTimeout(() => link.click(), index * 180)));
  loadManifest();
})();
